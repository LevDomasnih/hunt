#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "mcp>=1.12,<3",
#   "playwright==1.60.0",
# ]
# ///
"""Hunt headless browser MCP server (hunt-browser).

WhatsApp Web, Facebook Messenger and Instagram DMs in dedicated headless Chromium profiles
that run in the background, keep their sessions and never take the hunter's screen.

Profiles: ~/.config/hunt/browser/<channel>-<account>/   (chmod 700, one Chromium per profile)
QR codes: ~/.config/hunt/browser/qr-<account>.png (+ qr-<account>.html that auto-refreshes)
Pacing:   ~/.config/hunt/browser/pacing.json (shared by all Hunt processes, file-locked)
Config:   ~/.config/hunt/config.json, optional "browser" section:
          {"browser": {"quiet_hours": "21:00-08:00", "timezone": "Asia/Makassar", "locale": "en-US",
                       "executable": "/path/to/chrome",
                       "pacing": {"whatsapp": {"min_interval_s": 20, "min_interval_new_s": 150,
                                               "daily_new_cap": 15}}}}

Chromium: reuses the browser Playwright already installed (ms-playwright cache, chromium-1223 for
playwright 1.60). Never downloads browsers; if none is found the tools say how to install one.
Env overrides: HUNT_CONFIG_DIR, HUNT_CHROMIUM (browser executable), PLAYWRIGHT_BROWSERS_PATH.

Rules baked in: the chat is always opened by id and its header checked before sending; a send whose
outcome is unclear is reported as "unknown, check before resending" and never retried; passwords and
the Messenger end-to-end PIN are typed by the human in a visible window (fb_login / ig_login), never
by this server. Never prints to stdout outside the MCP protocol.
"""
from __future__ import annotations

import asyncio
import base64
import contextlib
import json
import os
import re
import sys
import tempfile
import time
import unicodedata
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from urllib.parse import quote
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

try:  # mcp 1.x
    from mcp.server.fastmcp import FastMCP
    from mcp.server.fastmcp.exceptions import ToolError
except ImportError:  # mcp 2.x renamed FastMCP to MCPServer
    from mcp.server.mcpserver import MCPServer as FastMCP
    from mcp.server.mcpserver.exceptions import ToolError

try:
    import fcntl
except ImportError:  # Windows: no file locking
    fcntl = None  # type: ignore[assignment]

from playwright.async_api import BrowserContext, Page, async_playwright
from playwright.async_api import Error as PWError
from playwright.async_api import TimeoutError as PWTimeout

CHANNELS = ("whatsapp", "messenger", "instagram")
WA = "https://web.whatsapp.com"
FB = "https://www.facebook.com"
IG = "https://www.instagram.com"
IG_APP_ID = "936619743392459"  # public id the instagram.com web app sends with its own API calls
UNKNOWN = "unknown, check before resending"

mcp = FastMCP(
    "hunt-browser",
    instructions=(
        "Headless WhatsApp Web, Facebook Messenger and Instagram DMs for Hunt. Each channel+account has "
        "its own background Chromium profile. Connect once: wa_login (QR PNG for the hunter to scan), "
        "fb_login / ig_login (a window opens, the hunter logs in themselves). Then *_status, *_inbox, "
        "*_history, *_media, *_send, *_resolve. Before sending read the history; pick the language from "
        "messages with dir='in' only. If a send returns status 'unknown', read the history before doing "
        "anything else; never resend blindly."
    ),
)


# ---------------------------------------------------------------- paths & config

def config_dir() -> Path:
    return Path(os.environ.get("HUNT_CONFIG_DIR") or (Path.home() / ".config" / "hunt")).expanduser()


def browser_dir() -> Path:
    d = config_dir() / "browser"
    d.mkdir(parents=True, exist_ok=True)
    with contextlib.suppress(OSError):
        os.chmod(config_dir(), 0o700)
        os.chmod(d, 0o700)
    return d


def load_config() -> dict[str, Any]:
    p = config_dir() / "config.json"
    try:
        return json.loads(p.read_text(encoding="utf-8") or "{}")
    except (OSError, json.JSONDecodeError):
        return {}


def browser_config() -> dict[str, Any]:
    cfg = load_config()
    b = cfg.get("browser") if isinstance(cfg.get("browser"), dict) else {}
    out = dict(b)
    out.setdefault("timezone", cfg.get("timezone"))
    return out


_ACCOUNT_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,31}$")


def check_account(account: str) -> str:
    a = (account or "main").strip().lower()
    if not _ACCOUNT_RE.match(a):
        raise ToolError("account must be 1-32 chars: lowercase letters, digits, '-' or '_' (e.g. 'main', 'hunt').")
    return a


def profile_dir(channel: str, account: str) -> Path:
    d = browser_dir() / f"{channel}-{account}"
    d.mkdir(parents=True, exist_ok=True)
    with contextlib.suppress(OSError):
        os.chmod(d, 0o700)
    return d


def _write_private(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if config_dir() in path.parents:  # our own folders (screens/, media/) stay private too
        with contextlib.suppress(OSError):
            os.chmod(path.parent, 0o700)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".tmp.", suffix=path.suffix)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        os.chmod(tmp, 0o600)
        os.replace(tmp, path)
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(tmp)
        raise


# ---------------------------------------------------------------- Chromium lookup (never downloads)

def playwright_browsers_root() -> Path:
    env = os.environ.get("PLAYWRIGHT_BROWSERS_PATH")
    if env and env != "0":
        return Path(env).expanduser()
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Caches" / "ms-playwright"
    if sys.platform.startswith("win"):
        return Path(os.environ.get("LOCALAPPDATA", Path.home())) / "ms-playwright"
    return Path.home() / ".cache" / "ms-playwright"


def _expected_revision() -> tuple[str | None, str | None]:
    """(chromium revision, browser version) the installed playwright package expects."""
    try:
        import playwright

        p = Path(playwright.__file__).parent / "driver" / "package" / "browsers.json"
        for b in json.loads(p.read_text())["browsers"]:
            if b.get("name") == "chromium":
                return str(b.get("revision")), b.get("browserVersion")
    except Exception:
        pass
    return None, None


_FULL_EXE = (
    "chrome-mac*/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    "chrome-mac*/Chromium.app/Contents/MacOS/Chromium",
    "chrome-linux*/chrome",
    "chrome-win*/chrome.exe",
)
_SHELL_EXE = (
    "chrome-headless-shell-*/chrome-headless-shell",
    "chrome-headless-shell-*/chrome-headless-shell.exe",
)


def find_chromium(root: Path | None = None) -> dict[str, Any]:
    """Locate an installed Chromium. Returns {full, shell, revision, version}; paths may be None."""
    root = root or playwright_browsers_root()
    want, version = _expected_revision()
    found: dict[str, Any] = {"full": None, "shell": None, "revision": None, "version": version, "root": str(root)}
    override = os.environ.get("HUNT_CHROMIUM") or browser_config().get("executable")
    if override and Path(override).exists():
        found["full"] = str(override)
        return found

    def scan(prefix: str, patterns: tuple[str, ...]) -> tuple[str | None, str | None]:
        if not root.is_dir():
            return None, None
        dirs = []
        for d in root.glob(f"{prefix}-*"):
            rev = d.name.rsplit("-", 1)[-1]
            if rev.isdigit() and (d / "INSTALLATION_COMPLETE").exists():
                dirs.append((rev == want, int(rev), d))
        for _, rev, d in sorted(dirs, reverse=True):  # expected revision first, then newest
            for pat in patterns:
                for exe in d.glob(pat):
                    if exe.is_file():
                        return str(exe), str(rev)
        return None, None

    found["full"], rev_full = scan("chromium", _FULL_EXE)
    found["shell"], rev_shell = scan("chromium_headless_shell", _SHELL_EXE)
    found["revision"] = rev_full or rev_shell
    if found["revision"] and found["revision"] != want:
        found["version"] = None  # version string belongs to another revision
    return found


def chromium_missing_message(root: str) -> str:
    want, _ = _expected_revision()
    return (
        f"No Chromium found under {root} (expected chromium-{want or '?'}). hunt-browser never downloads "
        "browsers by itself. Install it once (~250 MB): `uvx --from playwright==1.60.0 playwright install "
        "chromium`, or point HUNT_CHROMIUM (or config.json browser.executable) at an existing Chrome/Chromium."
    )


def user_agent(version: str | None) -> str:
    major = (version or "148").split(".")[0]
    if sys.platform == "darwin":
        os_part = "Macintosh; Intel Mac OS X 10_15_7"
    elif sys.platform.startswith("win"):
        os_part = "Windows NT 10.0; Win64; x64"
    else:
        os_part = "X11; Linux x86_64"
    return f"Mozilla/5.0 ({os_part}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{major}.0.0.0 Safari/537.36"


# ---------------------------------------------------------------- pure helpers (unit-tested)

_PHONE_URL = re.compile(r"(?:wa\.me/|phone=)(\+?\d[\d\s\-().]*)")


def phone_digits(peer: str) -> str | None:
    """Digits of a phone number / wa.me link / JID, or None if peer is a name."""
    s = (peer or "").strip()
    m = _PHONE_URL.search(s)
    if m:
        s = m.group(1)
    s = re.sub(r"@(s\.whatsapp\.net|c\.us)$", "", s)
    if not re.fullmatch(r"\+?[\d\s\-().]+", s):
        return None
    d = re.sub(r"\D", "", s)
    return d if 7 <= len(d) <= 15 else None


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKC", s or "")
    s = re.sub(r"[​-‏‪-‮⁠-⁤︎️]", "", s)
    return re.sub(r"\s+", " ", s).strip().casefold()


def _alnum(s: str) -> str:
    return re.sub(r"[\W_]+", "", _norm(s))


def same_text(shown: str, sent: str) -> bool:
    """True if the message as rendered (with time, ticks, 'Edited'...) contains the text we sent."""
    a, b = _norm(shown), _norm(sent)
    if not b:
        return False
    if b in a or (len(b) > 200 and b[:200] in a):
        return True
    aa, bb = _alnum(shown), _alnum(sent)
    return bool(bb) and (bb in aa or (len(bb) > 150 and bb[:150] in aa))


def display_matches(title: str, expect: str) -> bool:
    t, e = _alnum(title), _alnum(expect)
    if len(e) >= 3:
        return e in t
    return bool(_norm(expect)) and _norm(expect) == _norm(title)


def header_check(title: str, header_all: str, digits: str | None, expect_display: str | None) -> dict:
    """Is the open chat the one we meant? Number digits in the header title, or the stored display name."""
    if digits:
        for text in (title, header_all):
            hd = re.sub(r"\D", "", text or "")
            if hd and digits in hd:
                return {"ok": True, "by": "number"}
    if expect_display and (display_matches(title, expect_display) or display_matches(header_all, expect_display)):
        return {"ok": True, "by": "display"}
    why = "header shows neither the number"
    why += " nor the expected display name" if expect_display else " (pass expect_display = the name stored in the CRM for business/saved contacts)"
    return {"ok": False, "by": None, "reason": why, "header": title or header_all}


def parse_quiet_hours(spec: Any) -> tuple[int, int] | None:
    """'21:00-08:00' or {'start': '21:00', 'end': '08:00'} -> (start_min, end_min); None/'off' -> None."""
    if spec in (None, "", False, "off", "none"):
        return None
    if isinstance(spec, dict):
        spec = f"{spec.get('start', '')}-{spec.get('end', '')}"
    m = re.fullmatch(r"\s*(\d{1,2})(?::(\d{2}))?\s*-\s*(\d{1,2})(?::(\d{2}))?\s*", str(spec))
    if not m:
        return None
    a = int(m.group(1)) * 60 + int(m.group(2) or 0)
    b = int(m.group(3)) * 60 + int(m.group(4) or 0)
    return (a % 1440, b % 1440)


def in_quiet_hours(now_local: datetime, qh: tuple[int, int] | None) -> bool:
    if not qh:
        return False
    a, b = qh
    m = now_local.hour * 60 + now_local.minute
    return (a <= m < b) if a < b else (m >= a or m < b)


def quiet_end(now_local: datetime, qh: tuple[int, int]) -> datetime:
    end = now_local.replace(hour=qh[1] // 60, minute=qh[1] % 60, second=0, microsecond=0)
    return end if end > now_local else end + timedelta(days=1)


# ---------------------------------------------------------------- pacing

DEFAULT_PACING = {
    # min_interval_s: between any two sends on this account; min_interval_new_s: between first
    # messages to new people; daily_new_cap: first messages per local day.
    "whatsapp": {"min_interval_s": 20, "min_interval_new_s": 150, "daily_new_cap": 15},
    "messenger": {"min_interval_s": 30, "min_interval_new_s": 240, "daily_new_cap": 10},
    "instagram": {"min_interval_s": 30, "min_interval_new_s": 300, "daily_new_cap": 8},
}
DEFAULT_QUIET = "21:00-08:00"
MAX_INLINE_WAIT_S = 30


class Paced(Exception):
    def __init__(self, reason: str, retry_after: datetime | None):
        super().__init__(reason)
        self.reason = reason
        self.retry_after = retry_after

    def result(self) -> dict:
        return {"status": "paced", "sent": False, "reason": self.reason,
                "retry_after": self.retry_after.isoformat(timespec="minutes") if self.retry_after else None}


class Pacer:
    """Per channel+account send guard. State in browser/pacing.json, shared across processes."""

    def __init__(self, channel: str, account: str, state_path: Path | None = None, now=None):
        self.channel, self.account = channel, account
        self.key = f"{channel}-{account}"
        self.path = state_path or (browser_dir() / "pacing.json")
        self._now = now
        bc = browser_config()
        self.limits = dict(DEFAULT_PACING[channel])
        self.limits.update((bc.get("pacing") or {}).get(channel) or {})
        # browser.quiet_hours, else the Telegram server's quiet_hours (same config file), else 21:00-08:00
        tg = load_config().get("telegram") or {}
        qspec = bc["quiet_hours"] if "quiet_hours" in bc else (tg.get("quiet_hours") or DEFAULT_QUIET)
        self.qh = parse_quiet_hours(qspec)
        tzname = (qspec.get("tz") if isinstance(qspec, dict) else None) or bc.get("timezone")
        try:
            self.tz = ZoneInfo(tzname) if tzname else None
        except (ZoneInfoNotFoundError, ValueError):
            self.tz = None

    def now(self) -> datetime:
        n = self._now() if self._now else datetime.now().astimezone()
        return n.astimezone(self.tz) if self.tz else n.astimezone()

    @contextlib.contextmanager
    def _state(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        lock = open(self.path.with_suffix(".lock"), "a+")
        try:
            if fcntl:
                fcntl.flock(lock, fcntl.LOCK_EX)
            try:
                data = json.loads(self.path.read_text() or "{}")
            except (OSError, json.JSONDecodeError):
                data = {}
            st = data.setdefault(self.key, {})
            yield st
            _write_private(self.path, json.dumps(data, ensure_ascii=False, indent=1).encode())
        finally:
            if fcntl:
                fcntl.flock(lock, fcntl.LOCK_UN)
            lock.close()

    def _today(self, now: datetime) -> str:
        return now.date().isoformat()

    async def check(self, new_chat: bool | None) -> None:
        """Raise Paced if we must not send now. Short waits (<=30 s) are slept out instead."""
        now = self.now()
        with self._state() as st:
            blocked = st.get("blocked_until")
            if blocked and datetime.fromisoformat(blocked) > now:
                raise Paced(f"{self.channel} showed a limit warning earlier ({st.get('blocked_reason', '')}); "
                            "paused for this account", datetime.fromisoformat(blocked))
            if in_quiet_hours(now, self.qh):
                raise Paced("quiet hours (config browser.quiet_hours, default 21:00-08:00 local)",
                            quiet_end(now, self.qh))
            last = st.get("last_send_ts")
            wait = 0.0
            if last:
                wait = max(wait, float(self.limits["min_interval_s"]) - (now.timestamp() - last))
            if new_chat:
                day = st.get("new_chats", {}).get(self._today(now), [])
                if len(day) >= int(self.limits["daily_new_cap"]):
                    tomorrow = (now + timedelta(days=1)).replace(hour=self.qh[1] // 60 if self.qh else 9,
                                                                 minute=0, second=0, microsecond=0)
                    raise Paced(f"daily cap of {self.limits['daily_new_cap']} new chats reached", tomorrow)
                last_new = st.get("last_new_ts")
                if last_new:
                    wait = max(wait, float(self.limits["min_interval_new_s"]) - (now.timestamp() - last_new))
        if wait > MAX_INLINE_WAIT_S:
            raise Paced(f"too soon after the previous {'new chat' if new_chat else 'message'}",
                        now + timedelta(seconds=wait))
        if wait > 0:
            await asyncio.sleep(wait)

    def record(self, peer: str, new_chat: bool) -> None:
        now = self.now()
        with self._state() as st:
            st["last_send_ts"] = now.timestamp()
            if new_chat:
                st["last_new_ts"] = now.timestamp()
                nc = st.setdefault("new_chats", {})
                nc.setdefault(self._today(now), []).append(peer)
                for d in sorted(nc)[:-7]:  # keep a week
                    nc.pop(d, None)

    def block(self, reason: str, hours: int = 24) -> None:
        with self._state() as st:
            st["blocked_until"] = (self.now() + timedelta(hours=hours)).isoformat()
            st["blocked_reason"] = reason[:200]

    def summary(self) -> dict:
        now = self.now()
        with self._state() as st:
            return {"limits": self.limits, "quiet_hours": self.qh and f"{self.qh[0]//60:02d}:{self.qh[0]%60:02d}-{self.qh[1]//60:02d}:{self.qh[1]%60:02d}",
                    "new_chats_today": len(st.get("new_chats", {}).get(self._today(now), [])),
                    "blocked_until": st.get("blocked_until")}


LIMIT_RE = re.compile(
    r"approaching (the |your )?limit|temporarily (blocked|restricted|limited)|account (is )?restricted|"
    r"try again later|you.re temporarily|we limit how often|limit reached|too many messages|"
    r"временно (заблок|огранич)|попробуйте позже|лимит", re.I)


# ---------------------------------------------------------------- browser sessions

_PW = None
_PW_LOCK = asyncio.Lock()


async def playwright_instance():
    global _PW
    async with _PW_LOCK:
        if _PW is None:
            _PW = await async_playwright().start()
        return _PW


class LoginNeeded(Exception):
    pass


class Session:
    """One persistent Chromium profile (channel+account), kept open between calls."""

    def __init__(self, channel: str, account: str):
        self.channel, self.account = channel, account
        self.ctx: BrowserContext | None = None
        self._page: Page | None = None
        self.headed = False
        self.lock = asyncio.Lock()
        self.crashed = False
        self.login_task: asyncio.Task | None = None
        self.login: dict[str, Any] = {}

    @property
    def dir(self) -> Path:
        return profile_dir(self.channel, self.account)

    def alive(self) -> bool:
        return self.ctx is not None

    async def start(self, headed: bool = False) -> BrowserContext:
        if self.ctx is not None and self.headed == headed:
            return self.ctx
        await self.close()
        found = find_chromium()
        exe = found["full"] or (found["shell"] if not headed else None)
        if not exe:
            raise ToolError(chromium_missing_message(found["root"]))
        bc = browser_config()
        locale = bc.get("locale") or "en-US"  # English UI keeps the selectors' text checks stable
        kw: dict[str, Any] = dict(
            executable_path=exe,
            headless=not headed,
            locale=locale,
            user_agent=user_agent(found["version"]),
            accept_downloads=True,
            color_scheme="light",
            args=["--disable-blink-features=AutomationControlled", f"--lang={locale}",
                  "--no-first-run", "--no-default-browser-check"],
            ignore_default_args=["--enable-automation"],
        )
        if bc.get("timezone"):
            kw["timezone_id"] = bc["timezone"]
        if headed:
            kw["no_viewport"] = True
        else:
            kw["viewport"] = {"width": 1280, "height": 1000}
        pw = await playwright_instance()
        try:
            ctx = await pw.chromium.launch_persistent_context(str(self.dir), **kw)
        except PWError as e:
            msg = str(e)
            if "ProcessSingleton" in msg or "SingletonLock" in msg or "already in use" in msg:
                raise ToolError(f"Profile {self.dir} is in use by another browser (another Hunt session?). "
                                "Close it, or wait for it to finish, then retry.") from e
            raise ToolError(f"Could not start Chromium for {self.channel}/{self.account}: {msg.splitlines()[0]}") from e
        self.ctx, self.headed, self.crashed = ctx, headed, False
        ctx.on("close", lambda *_: self._on_close(ctx))
        return ctx

    def _on_close(self, ctx) -> None:
        if self.ctx is ctx:
            self.ctx, self._page = None, None

    async def page(self) -> Page:
        """The session's single page; relaunches the browser or reopens the page after a crash."""
        if self.ctx is None:
            await self.start(headed=False)
        assert self.ctx is not None
        p = self._page
        if p is None or p.is_closed() or self.crashed:
            if p is not None and not p.is_closed():
                with contextlib.suppress(Exception):
                    await p.close()
            pages = [x for x in self.ctx.pages if not x.is_closed()]
            p = pages[0] if pages else await self.ctx.new_page()
            for extra in pages[1:]:  # one tab per profile (WhatsApp complains about two)
                with contextlib.suppress(Exception):
                    await extra.close()
            self.crashed = False
            p.on("crash", lambda *_: setattr(self, "crashed", True))
            p.set_default_timeout(15000)
            self._page = p
        return p

    async def close(self) -> None:
        ctx, self.ctx, self._page = self.ctx, None, None
        if ctx is not None:
            with contextlib.suppress(Exception):
                await ctx.close()

    async def cookies(self, url: str) -> dict[str, str]:
        if self.ctx is None:
            return {}
        return {c["name"]: c["value"] for c in await self.ctx.cookies(url)}


SESSIONS: dict[tuple[str, str], Session] = {}


def session(channel: str, account: str) -> Session:
    key = (channel, check_account(account))
    if key not in SESSIONS:
        SESSIONS[key] = Session(*key)
    return SESSIONS[key]


async def safe_eval(page: Page, js: str, arg: Any = None, default: Any = None) -> Any:
    """page.evaluate that survives navigations/reloads (returns default instead of raising)."""
    try:
        return await page.evaluate(js, arg)
    except PWError:
        return default


# ---------------------------------------------------------------- shared JS

TEXT_OF = r"""
function textOf(root) {
  if (!root) return '';
  let out = '';
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  while (w.nextNode()) {
    const n = w.currentNode;
    if (n.nodeType === 3) out += n.nodeValue;
    else if (n.tagName === 'IMG' && n.alt) out += n.alt;
    else if (n.tagName === 'BR') out += '\n';
  }
  return out;
}
"""

SCROLL_UP_JS = r"""
(sel) => {
  const first = document.querySelector(sel);
  if (!first) return {ok: false, why: 'no rows'};
  let el = first.parentElement;
  while (el && el !== document.body) {
    const cs = getComputedStyle(el);
    if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 5) break;
    el = el.parentElement;
  }
  if (!el || el === document.body) return {ok: false, why: 'no scroller'};
  const before = el.scrollTop;
  el.scrollTop = 0;
  const r = el.getBoundingClientRect();
  return {ok: true, before, height: el.scrollHeight, x: r.left + r.width / 2, y: r.top + Math.min(r.height / 2, 200)};
}
"""

PASTE_JS = r"""
([sel, text]) => {
  const boxes = [...document.querySelectorAll(sel)];
  const box = boxes[boxes.length - 1];
  if (!box) return false;
  box.focus();
  const dt = new DataTransfer();
  dt.setData('text/plain', text);
  box.dispatchEvent(new ClipboardEvent('paste', {clipboardData: dt, bubbles: true, cancelable: true}));
  return true;
}
"""

BOX_TEXT_JS = "(sel) => { " + TEXT_OF + """
  const boxes = [...document.querySelectorAll(sel)];
  const box = boxes[boxes.length - 1];
  return box ? textOf(box) : null;
}"""

LARGEST_IMG_JS = r"""
() => {
  let best = null, area = 0;
  for (const i of document.images) {
    const a = (i.naturalWidth || 0) * (i.naturalHeight || 0);
    if (a > area && i.src && !i.src.startsWith('data:')) { best = i; area = a; }
  }
  return best ? {src: best.src, w: best.naturalWidth, h: best.naturalHeight} : null;
}
"""

BLOB_B64_JS = r"""
async (src) => {
  const r = await fetch(src);
  const b = new Uint8Array(await r.arrayBuffer());
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return {type: r.headers.get('content-type') || '', data: btoa(s)};
}
"""

DIALOG_TEXT_JS = r"""
() => [...document.querySelectorAll('[role="dialog"], [role="alertdialog"], [role="alert"], [data-animate-modal-popup="true"]')]
  .map(d => (d.innerText || '').trim()).filter(Boolean).join('\n---\n').slice(0, 2000)
"""


async def scroll_up(page: Page, row_sel: str) -> None:
    """Jump the message list to the top; if it already was there, nudge with a real wheel event so the
    site's 'load older messages' handler fires."""
    r = await safe_eval(page, SCROLL_UP_JS, row_sel)
    if r and r.get("ok") and r.get("before", 1) < 5:
        with contextlib.suppress(PWError):
            await page.mouse.move(r["x"], r["y"])
            await page.mouse.wheel(0, -2500)


def _ext_for(content_type: str, url: str = "") -> str:
    ct = (content_type or "").lower()
    for k, v in (("png", ".png"), ("webp", ".webp"), ("gif", ".gif"), ("mp4", ".mp4"), ("jpeg", ".jpg"), ("jpg", ".jpg")):
        if k in ct:
            return v
    m = re.search(r"\.(jpe?g|png|webp|gif|mp4)(?:\?|$)", url, re.I)
    return f".{m.group(1).lower().replace('jpeg', 'jpg')}" if m else ".jpg"


def _safe_name(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", s)[:60] or "peer"


def media_dir(channel: str, account: str, peer: str, out_dir: str | None) -> Path:
    d = Path(out_dir).expanduser() if out_dir else browser_dir() / "media" / f"{channel}-{account}" / _safe_name(peer)
    d.mkdir(parents=True, exist_ok=True, mode=0o700)
    return d


async def _fill_box(page: Page, sel: str, text: str, paste_first: bool) -> bool:
    """Put text into a contenteditable composer. Returns True if the box now holds exactly the text."""
    box = page.locator(sel).last
    await box.click()
    current = await safe_eval(page, BOX_TEXT_JS, sel, "")
    if (current or "").strip():
        await page.keyboard.press("ControlOrMeta+A")
        await page.keyboard.press("Backspace")
    if paste_first:
        await safe_eval(page, PASTE_JS, [sel, text], False)
        await page.wait_for_timeout(700)
        if _alnum(await safe_eval(page, BOX_TEXT_JS, sel, "") or "") == _alnum(text):
            return True
        await page.keyboard.press("ControlOrMeta+A")
        await page.keyboard.press("Backspace")
    lines = text.split("\n")
    for i, line in enumerate(lines):
        if line:
            await page.keyboard.insert_text(line)
        if i < len(lines) - 1:
            await page.keyboard.press("Shift+Enter")
    await page.wait_for_timeout(400)
    return _alnum(await safe_eval(page, BOX_TEXT_JS, sel, "") or "") == _alnum(text)


async def _clear_box(page: Page, sel: str) -> None:
    with contextlib.suppress(Exception):
        await page.locator(sel).last.click()
        await page.keyboard.press("ControlOrMeta+A")
        await page.keyboard.press("Backspace")


async def _limit_warning(page: Page) -> str | None:
    t = await safe_eval(page, DIALOG_TEXT_JS, None, "") or ""
    return t if t and LIMIT_RE.search(t) else None


# ---------------------------------------------------------------- WhatsApp

WA_STATE_JS = r"""
() => {
  const q = s => document.querySelector(s);
  if (q('canvas[aria-label*="QR" i]') || q('[data-testid="link_device_qr_phone_number_shortcut_link"]')) {
    const reload = [...document.querySelectorAll('button, [role="button"]')]
      .some(b => /reload qr/i.test((b.innerText || '') + ' ' + (b.getAttribute('aria-label') || '')));
    return {state: reload ? 'qr_expired' : 'qr'};
  }
  const dlg = [...document.querySelectorAll('[role="dialog"], [data-animate-modal-popup="true"]')].map(d => d.innerText || '').join(' ');
  if (/invalid|isn.t on whatsapp|not on whatsapp|недействител|не зарегистр/i.test(dlg)) return {state: 'invalid', text: dlg.slice(0, 300)};
  if (/use here|open in another window|открыт в другом окне/i.test(dlg)) return {state: 'conflict', text: dlg.slice(0, 300)};
  const h = q('#main header');
  if (h) {
    const t = h.querySelector('span[dir="auto"], span[title]');
    return {state: 'chat', title: (t && (t.getAttribute('title') || t.innerText) || '').trim(), header: h.innerText};
  }
  if (q('#pane-side') || q('#side')) return {state: 'app'};
  if (/update (google )?chrome|works with google chrome/i.test(document.body ? document.body.innerText : '')) return {state: 'unsupported'};
  const prog = q('progress');
  return {state: 'loading', text: (document.body ? document.body.innerText : '').slice(0, 120), progress: prog ? prog.value : null};
}
"""

WA_ROWS_JS = "(limit) => { " + TEXT_OF + r"""
  const rows = [...document.querySelectorAll('#main [role="row"]')];
  const out = [];
  for (const r of rows) {
    const idEl = r.querySelector('[data-id]');
    const id = idEl ? idEl.getAttribute('data-id') : null;
    const bubble = r.querySelector('.message-in, .message-out');
    const icons = [...new Set([...r.querySelectorAll('[data-icon]')].map(e => e.getAttribute('data-icon')))];
    if (!id && !bubble) {
      const t = (r.innerText || '').trim();
      if (t) out.push({dir: 'system', text: t});
      continue;
    }
    const isOut = (id && id.startsWith('true_')) || !!r.querySelector('.message-out');
    const preEl = r.querySelector('[data-pre-plain-text]');
    const pre = preEl ? preEl.getAttribute('data-pre-plain-text') : '';
    const spans = [...r.querySelectorAll('span.selectable-text, [data-testid="selectable-text"]')]
      .filter(s => !(s.parentElement && s.parentElement.closest('span.selectable-text')));
    const quotedSel = '[aria-label*="uoted" i], [data-testid="quoted-message"], .quoted-mention';
    const main = spans.filter(s => !s.closest(quotedSel));
    const quoted = spans.filter(s => s.closest(quotedSel)).map(textOf).join(' ').trim();
    let text = main.map(textOf).join('\n').trim();
    const media = [];
    const imgs = [...r.querySelectorAll('img')].filter(i => /^blob:|whatsapp\.net/.test(i.src || '') && (i.naturalWidth || i.width) >= 60);
    if (imgs.length) media.push({type: 'image', count: imgs.length});
    if (r.querySelector('video') || icons.some(n => /video|media-play|media-gif/.test(n))) media.push({type: 'video'});
    if (r.querySelector('audio') || icons.some(n => /audio|ptt/.test(n))) media.push({type: 'voice'});
    if (icons.some(n => /^doc|document|pdf|xls|ppt/.test(n))) {
      const t = r.querySelector('[title]');
      media.push({type: 'document', name: t ? t.getAttribute('title') : null});
    }
    const loc = r.querySelector('a[href*="maps.google"], a[href*="google.com/maps"], a[href*="maps.app.goo.gl"]');
    if (loc) media.push({type: 'location', url: loc.href});
    if (icons.some(n => /vcard|contact/.test(n))) media.push({type: 'contact'});
    if (icons.some(n => /miss/.test(n))) media.push({type: 'missed_call'});
    if (r.querySelector('img[alt*="sticker" i]')) media.push({type: 'sticker'});
    let time = null, sender = null;
    const m = pre && pre.match(/^\[([^\]]+)\]\s*(.*?):\s*$/);
    if (m) { time = m[1]; sender = m[2]; }
    if (!time) { const tm = (r.innerText || '').match(/(\d{1,2}:\d{2}(?:\s?[AP]M)?)\s*$/i); if (tm) time = tm[1]; }
    if (!text && !media.length) text = (r.innerText || '').trim();
    const st = icons.find(n => /^msg-(time|check|dblcheck)/.test(n)) || null;
    const item = {dir: isOut ? 'out' : 'in', id, time, text, media};
    if (sender) item.sender = sender;
    if (quoted) item.quoted = quoted;
    if (isOut) item.status = st;
    if (!text && !media.length) item.icons = icons;
    out.push(item);
  }
  return out.slice(-limit);
}"""

WA_CHATLIST_JS = r"""
() => {
  const UNREAD = /unread|непрочитан|no le[íi]d|n[ãa]o lid|belum dibaca|ยังไม่ได้อ่าน|оқылмаған|non lett|ungelesen|non lu/i;
  const cands = [...document.querySelectorAll('#pane-side [role="listitem"], #pane-side [role="row"]')];
  const rows = cands.filter(c => !cands.some(o => o !== c && c.contains(o)));
  return rows.map(r => {
    const titles = [...r.querySelectorAll('span[title]')].map(s => s.getAttribute('title')).filter(Boolean);
    const lines = (r.innerText || '').split('\n').map(s => s.trim()).filter(Boolean);
    let unread = 0;
    for (const el of [r, ...r.querySelectorAll('[aria-label]')]) {
      const a = el.getAttribute('aria-label') || '';
      if (UNREAD.test(a)) { const n = parseInt((a.match(/\d+/) || ['1'])[0], 10); unread = isNaN(n) ? 1 : n; break; }
    }
    const icons = [...r.querySelectorAll('[data-icon]')].map(e => e.getAttribute('data-icon'));
    const missed = icons.some(n => /miss/.test(n)) || /missed (voice|video) call|пропущенн/i.test(r.innerText || '');
    const timeLine = lines.find(l => /^(\d{1,2}:\d{2}(\s?[AP]M)?|yesterday|today|\d{1,2}[./]\d{1,2}[./]\d{2,4}|mon|tue|wed|thu|fri|sat|sun)/i.test(l)) || null;
    return {name: titles[0] || lines[0] || '', preview: titles[1] || lines.filter(l => l !== timeLine).slice(1).join(' ') || '',
            time: timeLine, unread, missed_call: missed, muted: icons.some(n => /mute/.test(n))};
  });
}
"""

WA_PANE_SCROLL_JS = r"""
(step) => { const p = document.querySelector('#pane-side'); if (!p) return null;
  if (step === 0) { p.scrollTop = 0; return {top: 0, end: false}; }
  const before = p.scrollTop; p.scrollTop = before + p.clientHeight * 0.9;
  return {top: p.scrollTop, end: p.scrollTop === before}; }
"""

WA_OWN_JS = r"""
() => { for (const k of ['last-wid-md', 'last-wid']) { const v = localStorage.getItem(k); if (v) return v; } return null; }
"""

WA_BOX = '#main footer div[contenteditable="true"][role="textbox"], #main footer div[contenteditable="true"]'
WA_SEARCH = '#side div[contenteditable="true"][role="textbox"], #side input[type="text"], #side div[contenteditable="true"]'


class WhatsApp:
    channel = "whatsapp"

    def __init__(self, base: str = WA):
        self.base = base

    async def wait_state(self, page: Page, want: set[str], timeout: float = 60.0) -> dict:
        deadline = time.monotonic() + timeout
        st: dict = {"state": "loading"}
        while time.monotonic() < deadline:
            st = await safe_eval(page, WA_STATE_JS, None, {"state": "loading"}) or {"state": "loading"}
            if st["state"] == "conflict":
                with contextlib.suppress(Exception):
                    await page.get_by_role("button", name=re.compile("use here", re.I)).click(timeout=3000)
            elif st["state"] in want or st["state"] in ("invalid", "unsupported"):
                return st
            await page.wait_for_timeout(500)
        return st

    async def ensure_app(self, page: Page, timeout: float = 60.0) -> dict:
        if not page.url.startswith(self.base):
            await page.goto(self.base + "/", wait_until="domcontentloaded")
        st = await self.wait_state(page, {"app", "chat", "qr", "qr_expired"}, timeout)
        if st["state"] in ("qr", "qr_expired"):
            raise LoginNeeded("WhatsApp is not linked: call wa_login and have the hunter scan the QR "
                              "(WhatsApp on the hunting phone → Linked devices → Link a device).")
        if st["state"] == "unsupported":
            raise ToolError("WhatsApp Web says this browser is unsupported; check the Chromium install.")
        if st["state"] not in ("app", "chat"):
            raise ToolError(f"WhatsApp Web did not finish loading ({st.get('text') or st['state']}). Retry in a minute.")
        return st

    async def own_number(self, page: Page) -> str | None:
        v = await safe_eval(page, WA_OWN_JS, None, None)
        if not v:
            return None
        m = re.search(r"(\d{6,15})", v)
        return m.group(1) if m else None

    async def open_chat(self, page: Page, peer: str, expect_display: str | None) -> dict:
        """Open the chat by number (deep link) or by exact name; returns header check result."""
        digits = phone_digits(peer)
        if digits:
            await page.goto(f"{self.base}/send?phone={digits}", wait_until="domcontentloaded")
            st = await self.wait_state(page, {"chat", "qr", "qr_expired"}, timeout=45)
            if st["state"] in ("qr", "qr_expired"):
                raise LoginNeeded("WhatsApp is not linked: call wa_login.")
            if st["state"] == "invalid":
                return {"ok": False, "status": "no_chat", "reason": f"number {digits} is not on WhatsApp", "dialog": st.get("text")}
            if st["state"] != "chat":
                return {"ok": False, "status": "no_chat", "reason": f"chat did not open ({st['state']})"}
            await page.wait_for_timeout(800)  # header may still be swapping after the reload
            st = await safe_eval(page, WA_STATE_JS, None, st) or st
        else:
            await self.ensure_app(page)
            hits = await self._search(page, peer)
            exact = [h for h in hits if _norm(h["name"]) == _norm(peer)]
            if len(exact) != 1:
                await self._clear_search(page)
                return {"ok": False, "status": "no_chat",
                        "reason": f"{len(exact)} chats named exactly {peer!r}; use the phone number",
                        "candidates": [h["name"] for h in hits[:10]]}
            await page.locator('#pane-side [role="listitem"], #pane-side [role="row"]').filter(
                has=page.get_by_title(exact[0]["name"], exact=True)).first.click()
            st = await self.wait_state(page, {"chat"}, timeout=15)
            expect_display = expect_display or peer
        if st.get("state") != "chat":
            return {"ok": False, "status": "no_chat", "reason": "chat did not open"}
        chk = header_check(st.get("title", ""), st.get("header", ""), digits, expect_display)
        chk.update(title=st.get("title"), digits=digits)
        if not chk["ok"]:
            chk["status"] = "wrong_chat"
        return chk

    async def _search(self, page: Page, query: str) -> list[dict]:
        box = page.locator(WA_SEARCH).first
        await box.click()
        await page.keyboard.press("ControlOrMeta+A")
        await page.keyboard.press("Backspace")
        await page.keyboard.insert_text(query)
        await page.wait_for_timeout(1800)
        return await safe_eval(page, WA_CHATLIST_JS, None, []) or []

    async def _clear_search(self, page: Page) -> None:
        with contextlib.suppress(Exception):
            await page.keyboard.press("Escape")

    async def rows(self, page: Page, limit: int = 10000) -> list[dict]:
        return await safe_eval(page, WA_ROWS_JS, limit, []) or []

    async def scroll_history(self, page: Page, limit: int) -> bool:
        """Scroll up until `limit` messages are loaded or the start is reached. Returns True if complete."""
        stable = 0
        prev = -1
        for _ in range(60):
            rows = await self.rows(page)
            n = len([r for r in rows if r["dir"] != "system"])
            if n >= limit:
                return False
            if any(re.search(r"end-to-end encrypted|сквозным шифрованием", r.get("text", ""), re.I)
                   for r in rows[:3] if r["dir"] == "system"):
                return True
            if n == prev:
                stable += 1
                if stable >= 3:
                    return True
            else:
                stable = 0
            prev = n
            with contextlib.suppress(Exception):
                older = page.get_by_role("button", name=re.compile(r"older messages|более ранние", re.I))
                if await older.count():
                    await older.first.click(timeout=2000)
            await scroll_up(page, '#main [role="row"]')
            await page.wait_for_timeout(1200)
        return False

    # --- public operations (page already belongs to the session)

    async def status(self, page: Page) -> dict:
        try:
            await self.ensure_app(page, timeout=45)
        except LoginNeeded as e:
            return {"logged_in": False, "how": str(e)}
        return {"logged_in": True, "number": await self.own_number(page)}

    async def inbox(self, page: Page, limit: int = 30, all_chats: bool = False) -> dict:
        await self.ensure_app(page)
        seen: dict[str, dict] = {}
        await safe_eval(page, WA_PANE_SCROLL_JS, 0)
        await page.wait_for_timeout(500)
        for _ in range(10):
            for c in await safe_eval(page, WA_CHATLIST_JS, None, []) or []:
                seen.setdefault(c["name"] + "|" + c["preview"][:40], c)
            want = [c for c in seen.values() if all_chats or c["unread"] or c["missed_call"]]
            if len(want) >= limit:
                break
            sc = await safe_eval(page, WA_PANE_SCROLL_JS, 1)
            if not sc or sc.get("end"):
                break
            await page.wait_for_timeout(700)
        await safe_eval(page, WA_PANE_SCROLL_JS, 0)
        chats = []
        for c in seen.values():
            if not (all_chats or c["unread"] or c["missed_call"]):
                continue
            d = phone_digits(c["name"])
            if d:
                c["number"] = d
            chats.append(c)
        return {"chats": chats[:limit], "unread_total": sum(c["unread"] for c in chats),
                "missed_calls": [c["name"] for c in chats if c["missed_call"]],
                "note": "Names are numbers for unsaved contacts; business/saved contacts show a name."}

    async def history(self, page: Page, peer: str, limit: int = 200, expect_display: str | None = None) -> dict:
        chk = await self.open_chat(page, peer, expect_display)
        if chk.get("status") == "no_chat":
            return {"status": "no_chat", "reason": chk["reason"], "messages": []}
        complete = await self.scroll_history(page, limit)
        rows = await self.rows(page)
        msgs = rows[-limit:] if limit else rows
        return {"status": "ok", "header": chk.get("title"), "verified": chk["ok"], "verified_by": chk.get("by"),
                "verify_note": None if chk["ok"] else chk.get("reason"),
                "complete": complete, "count": len(msgs), "messages": msgs}

    async def media(self, page: Page, peer: str, out: Path, limit: int = 20, expect_display: str | None = None) -> dict:
        chk = await self.open_chat(page, peer, expect_display)
        if chk.get("status") == "no_chat":
            return {"status": "no_chat", "reason": chk["reason"], "files": []}
        await self.scroll_history(page, 400)
        thumbs = page.locator('#main [role="row"] img[src^="blob:"]')
        n = await thumbs.count()
        files, skipped = [], 0
        for i in reversed(range(n)):
            if len(files) >= limit:
                break
            t = thumbs.nth(i)
            try:
                box = await t.bounding_box()
                if not box or box["width"] < 60:
                    continue
                thumb_src = await t.get_attribute("src")
                await t.scroll_into_view_if_needed(timeout=3000)
                await t.click(timeout=3000)
                await page.wait_for_timeout(1500)
                big = await safe_eval(page, LARGEST_IMG_JS)
                src, suffix = (big["src"], "") if big and big["src"] != thumb_src else (thumb_src, "_thumb")
                blob = await safe_eval(page, BLOB_B64_JS, src)
                await page.keyboard.press("Escape")
                await page.wait_for_timeout(400)
                if not blob or not blob.get("data"):
                    skipped += 1
                    continue
                path = out / f"wa_{len(files) + 1:03d}{suffix}{_ext_for(blob['type'])}"
                _write_private(path, base64.b64decode(blob["data"]))
                files.append(str(path))
            except Exception:
                skipped += 1
                with contextlib.suppress(Exception):
                    await page.keyboard.press("Escape")
        rows = await self.rows(page)
        videos = sum(1 for r in rows for m in r.get("media", []) if m["type"] == "video")
        return {"status": "ok", "verified": chk["ok"], "files": files, "skipped": skipped,
                "videos_in_chat": videos, "dir": str(out),
                "note": "Newest first. '_thumb' = full-size viewer did not open, thumbnail saved. Videos are not saved."}

    async def send(self, page: Page, peer: str, text: str, expect_display: str | None = None,
                   pacer: Pacer | None = None, allow_repeat: bool = False) -> dict:
        if pacer:
            await pacer.check(new_chat=None)
        chk = await self.open_chat(page, peer, expect_display)
        if not chk["ok"]:
            return {"status": chk.get("status", "wrong_chat"), "sent": False, "reason": chk.get("reason"),
                    "header": chk.get("header") or chk.get("title"), "candidates": chk.get("candidates")}
        before = await self.rows(page)
        msgs = [r for r in before if r["dir"] != "system"]
        new_chat = not msgs
        last_out = next((r for r in reversed(msgs) if r["dir"] == "out"), None)
        if last_out and not allow_repeat and same_text(last_out.get("text", ""), text):
            return {"status": "already_sent", "sent": False, "header": chk.get("title"),
                    "reason": "the last outgoing message already has this text (pass allow_repeat=true to send again)"}
        if pacer:
            await pacer.check(new_chat=new_chat)
        try:
            await page.locator(WA_BOX).last.wait_for(timeout=10000)
        except PWTimeout:
            return {"status": "not_sent", "sent": False, "reason": "message box not found (blocked contact or group you left?)"}
        if not await _fill_box(page, WA_BOX, text, paste_first=True):
            await _clear_box(page, WA_BOX)
            return {"status": "not_sent", "sent": False, "reason": "could not put the text into the message box"}
        before_ids = {r.get("id") for r in before if r.get("id")}
        if pacer:
            pacer.record(peer, new_chat)
        try:
            await page.keyboard.press("Enter")
        except PWError:
            return {"status": "unknown", "sent": None, "reason": UNKNOWN}
        return await self._verify_sent(page, text, before_ids, chk, pacer, new_chat)

    async def _verify_sent(self, page, text, before_ids, chk, pacer, new_chat) -> dict:
        deadline = time.monotonic() + 20
        reloaded = False
        while time.monotonic() < deadline:
            await page.wait_for_timeout(1000)
            st = await safe_eval(page, WA_STATE_JS, None, None)
            if st is None or st.get("state") != "chat":
                reloaded = True  # page reloads right after a send sometimes; wait for it to settle
                continue
            rows = await self.rows(page, 30)
            for r in reversed(rows):
                if r["dir"] != "out":
                    continue
                if r.get("id") in before_ids:
                    break
                if same_text(r.get("text", ""), text):
                    warn = await _limit_warning(page)
                    if warn and pacer:
                        pacer.block(warn)
                    pending = bool(r.get("status") and "time" in r["status"])
                    return {"status": "sent_pending" if pending else "sent", "sent": True,
                            "header": chk.get("title"), "verified_by": chk.get("by"), "new_chat": new_chat,
                            "message_id": r.get("id"), "tick": r.get("status"),
                            "limit_warning": warn,
                            "note": "clock icon: queued on WhatsApp's side, do not resend" if pending else None}
                break
        warn = await _limit_warning(page)
        if warn and pacer:
            pacer.block(warn)
        return {"status": "unknown", "sent": None, "reason": UNKNOWN, "page_reloaded": reloaded,
                "limit_warning": warn, "next": "call wa_history for this peer and look at the last outgoing message"}

    async def resolve(self, page: Page, query: str) -> dict:
        digits = phone_digits(query)
        if digits:
            chk = await self.open_chat(page, digits, None)
            if chk.get("status") == "no_chat":
                return {"query": query, "on_whatsapp": False, "reason": chk.get("reason")}
            rows = await self.rows(page)
            return {"query": query, "on_whatsapp": True, "number": digits, "header": chk.get("title"),
                    "header_is_number": chk.get("by") == "number",
                    "has_history": any(r["dir"] != "system" for r in rows)}
        await self.ensure_app(page)
        hits = await self._search(page, query)
        await self._clear_search(page)
        for h in hits:
            d = phone_digits(h["name"])
            if d:
                h["number"] = d
        return {"query": query, "matches": hits[:20]}

    # --- login

    async def qr_snapshot(self, page: Page, path: Path) -> bool:
        canvas = page.locator('canvas[aria-label*="QR" i]').first
        try:
            await canvas.wait_for(timeout=5000)
            box = await canvas.bounding_box()
        except (PWTimeout, PWError):
            return False
        if not box:
            return False
        pad = 24
        clip = {"x": max(box["x"] - pad, 0), "y": max(box["y"] - pad, 0),
                "width": box["width"] + 2 * pad, "height": box["height"] + 2 * pad}
        png = await page.screenshot(clip=clip)
        _write_private(path, png)
        return True


def qr_paths(account: str) -> tuple[Path, Path]:
    d = browser_dir()
    return d / f"qr-{account}.png", d / f"qr-{account}.html"


def write_qr_html(html_path: Path, png_name: str) -> None:
    html = f"""<!doctype html><meta charset="utf-8"><title>Hunt: link WhatsApp</title>
<style>body{{font:16px system-ui;background:#fff;text-align:center;padding:24px}}img{{width:320px;image-rendering:pixelated}}</style>
<h2>Link WhatsApp to Hunt</h2><p>WhatsApp on the hunting phone → Settings → Linked devices → Link a device → scan.</p>
<img id="q" src="{png_name}"><p><small>Refreshes by itself every 3 s.</small></p>
<script>setInterval(()=>{{document.getElementById('q').src='{png_name}?'+Date.now()}},3000)</script>"""
    _write_private(html_path, html.encode())


async def wa_login_watch(sess: Session, wa: WhatsApp, account: str, minutes: float = 6.0) -> None:
    """Background: keep qr-<account>.png fresh (WA rotates/expires the code) until linked or timeout."""
    png, _ = qr_paths(account)
    deadline = time.monotonic() + minutes * 60
    last_ref, reloads = None, 0
    try:
        while time.monotonic() < deadline:
            async with sess.lock:
                page = await sess.page()
                st = await safe_eval(page, WA_STATE_JS, None, {"state": "loading"}) or {"state": "loading"}
                sess.login["state"] = st["state"]
                if st["state"] in ("app", "chat"):
                    sess.login.update(state="linked", linked_at=datetime.now().isoformat(timespec="seconds"))
                    with contextlib.suppress(OSError):
                        png.unlink()
                    return
                if st["state"] == "qr_expired":
                    if reloads >= 3:
                        sess.login["state"] = "expired"
                        with contextlib.suppress(OSError):
                            png.unlink()
                        return
                    reloads += 1
                    with contextlib.suppress(Exception):
                        await page.get_by_role("button", name=re.compile("reload qr", re.I)).first.click(timeout=3000)
                        await page.wait_for_timeout(1500)
                    last_ref = None
                elif st["state"] == "qr":
                    ref = await safe_eval(page, "() => document.querySelector('canvas[aria-label*=\"QR\" i]')?.closest('[data-ref]')?.getAttribute('data-ref') || null")
                    if ref != last_ref or not png.exists():
                        if await wa.qr_snapshot(page, png):
                            last_ref = ref
                            sess.login["qr_updated"] = datetime.now().isoformat(timespec="seconds")
            await asyncio.sleep(2)
        sess.login["state"] = "expired"
        with contextlib.suppress(OSError):  # don't leave a dead code around for someone to scan
            png.unlink()
    except Exception as e:  # never let the watcher die silently
        sess.login.update(state="error", error=str(e)[:300])


# ---------------------------------------------------------------- Messenger (facebook.com)

FB_THREADS_JS = r"""
() => {
  const as = [...document.querySelectorAll('a[href*="/messages/t/"], a[href*="/messages/e2ee/t/"]')];
  const seen = new Set(); const out = [];
  for (const a of as) {
    const m = (a.getAttribute('href') || '').match(/\/messages\/(e2ee\/)?t\/([^/?#]+)/);
    if (!m || seen.has(m[2])) continue;
    seen.add(m[2]);
    const row = a.closest('[role="row"], [role="listitem"], [role="gridcell"]') || a;
    const text = row.innerText || '';
    const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
    if (!lines.length) continue;
    const labels = [row, a, ...row.querySelectorAll('[aria-label]')].map(e => (e.getAttribute && e.getAttribute('aria-label')) || '').join(' | ');
    const unread = /\bunread\b|непрочитан/i.test(text + ' ' + labels) || !!row.querySelector('[aria-label*="Mark as read" i]');
    out.push({thread_id: m[2], e2ee: !!m[1], name: lines[0], preview: lines.slice(1).join(' · ').slice(0, 300), unread});
  }
  return out;
}
"""

FB_ROWS_JS = r"""
(limit) => {
  const main = document.querySelector('[role="main"]');
  if (!main) return [];
  let rows = [...main.querySelectorAll('[role="row"]')];
  if (!rows.length) rows = [...main.querySelectorAll('[role="gridcell"]')];
  const mr = main.getBoundingClientRect();
  const mid = mr.left + mr.width / 2;
  const out = [];
  for (const r of rows.slice(-limit)) {
    const raw = (r.innerText || '').trim();
    if (!raw && !r.querySelector('img, video')) continue;
    const leaves = [...r.querySelectorAll('div[dir="auto"], span[dir="auto"]')].filter(e => !e.querySelector('[dir="auto"]'));
    const text = leaves.map(e => (e.innerText || '').trim()).filter(Boolean).join('\n') || raw;
    let dir = 'unknown';
    if (/^(you sent|вы отправили)/im.test(raw)) dir = 'out';
    else {
      const el = leaves[0] || r.querySelector('img') || r;
      const rr = el.getBoundingClientRect();
      if (rr.width > 0) dir = (rr.left + rr.width / 2) > mid ? 'out' : 'in';
    }
    const media = [...r.querySelectorAll('img')]
      .filter(i => /fbcdn|scontent/.test(i.src || '') && (i.naturalWidth || i.width) >= 80 && !/emoji|static\.xx/.test(i.src))
      .map(i => ({type: 'image', src: i.src}));
    if (r.querySelector('video')) media.push({type: 'video'});
    const link = r.querySelector('a[href*="l.facebook.com"], a[href*="/marketplace/item/"]');
    if (link) media.push({type: 'link', url: link.href});
    const failed = /couldn.t send|failed to send|not sent|не удалось отправить|не отправлено/i.test(raw);
    out.push({dir, text, media, failed});
  }
  return out;
}
"""

FB_STATE_JS = r"""
() => {
  const body = document.body ? document.body.innerText : '';
  if (/\/checkpoint\//.test(location.pathname)) return {state: 'checkpoint'};
  if (/\/login/.test(location.pathname) || document.querySelector('input[name="email"]') && document.querySelector('input[name="pass"]')) return {state: 'login'};
  const dlg = [...document.querySelectorAll('[role="dialog"]')].map(d => d.innerText || '').join(' ');
  if (/\bPIN\b|restore (your )?(chat|message) history|enter your pin|введите pin|восстанов/i.test(dlg)) return {state: 'pin', text: dlg.slice(0, 300)};
  const main = document.querySelector('[role="main"]');
  const head = main && [...main.querySelectorAll('h1, h2')].map(h => (h.innerText || '').trim()).filter(Boolean);
  return {state: 'ok', headings: head || [], box: !!document.querySelector('[role="main"] [contenteditable="true"][role="textbox"]')};
}
"""

FB_BOX = '[role="main"] div[contenteditable="true"][role="textbox"]'


def fb_thread_id(peer: str) -> tuple[str | None, bool]:
    s = (peer or "").strip()
    m = re.search(r"/messages/(e2ee/)?t/([^/?#]+)", s)
    if m:
        return m.group(2), bool(m.group(1))
    m = re.search(r"m\.me/([^/?#]+)", s)
    if m:
        return m.group(1), False
    if re.fullmatch(r"[A-Za-z0-9.]{3,64}", s):
        return s, False
    return None, False


class Messenger:
    channel = "messenger"
    cookie = "c_user"

    def __init__(self, base: str = FB):
        self.base = base

    async def state(self, page: Page) -> dict:
        return await safe_eval(page, FB_STATE_JS, None, {"state": "loading"}) or {"state": "loading"}

    def _login_error(self, st: dict) -> None:
        if st["state"] == "login":
            raise LoginNeeded("Facebook session missing or expired: call fb_login (a window opens; the hunter logs in).")
        if st["state"] == "checkpoint":
            raise LoginNeeded("Facebook wants a security check: call fb_login so the hunter can pass it in the window.")
        if st["state"] == "pin":
            raise LoginNeeded("Messenger asks for the end-to-end encryption PIN to restore chats. The hunter must type it: "
                              "call fb_login, enter the PIN in the window, then close it. Never guess or store the PIN.")

    async def goto(self, page: Page, url: str) -> dict:
        await page.goto(url, wait_until="domcontentloaded")
        await page.wait_for_timeout(2500)
        st = await self.state(page)
        self._login_error(st)
        return st

    async def status(self, page: Page, sess: Session) -> dict:
        if not page.url.startswith(self.base):
            await page.goto(self.base + "/messages/t/", wait_until="domcontentloaded")
            await page.wait_for_timeout(2500)
        ck = await sess.cookies(self.base)
        st = await self.state(page)
        res = {"logged_in": bool(ck.get(self.cookie)) and st["state"] not in ("login", "checkpoint"),
               "user_id": ck.get(self.cookie), "page_state": st["state"]}
        if st["state"] == "pin":
            res["how"] = "Messenger wants the e2ee PIN: call fb_login so the hunter types it in the window."
        elif not res["logged_in"]:
            res["how"] = "call fb_login (window opens, the hunter logs in) or fb_login(cookies_file=...)"
        return res

    async def inbox(self, page: Page, limit: int = 30, all_chats: bool = False) -> dict:
        await self.goto(page, self.base + "/messages/t/")
        threads: dict[str, dict] = {}
        for _ in range(6):
            for t in await safe_eval(page, FB_THREADS_JS, None, []) or []:
                threads.setdefault(t["thread_id"], t)
            if len([t for t in threads.values() if all_chats or t["unread"]]) >= limit:
                break
            await page.mouse.move(200, 500)
            await page.mouse.wheel(0, 2500)
            await page.wait_for_timeout(1200)
        chats = [t for t in threads.values() if all_chats or t["unread"]][:limit]
        return {"chats": chats, "unread_total": sum(1 for t in chats if t["unread"]),
                "note": "Unread detection on facebook.com is heuristic; pass all_chats=true to see the latest threads."}

    async def open_thread(self, page: Page, peer: str, expect_display: str | None) -> dict:
        tid, e2ee = fb_thread_id(peer)
        if not tid:
            raise ToolError("Messenger peer must be a thread id, a facebook.com/messages/t/<id> URL or an m.me/<name> link.")
        url = f"{self.base}/messages/{'e2ee/' if e2ee else ''}t/{tid}/"
        st = await self.goto(page, url)
        for _ in range(16):
            if st.get("box") or await page.locator('[role="main"] [role="row"]').count():
                break
            await page.wait_for_timeout(750)
            st = await self.state(page)
            self._login_error(st)
        on_thread = f"/t/{tid}" in page.url
        heads = st.get("headings") or []
        title = heads[0] if heads else ""
        res = {"thread_id": tid, "url": page.url, "title": title, "box": st.get("box")}
        if not on_thread:
            return {**res, "ok": False, "status": "no_chat", "reason": f"facebook redirected away from thread {tid}"}
        if expect_display:
            if any(display_matches(h, expect_display) for h in heads) or display_matches(
                    await safe_eval(page, "() => document.title", None, "") or "", expect_display):
                return {**res, "ok": True, "by": "thread_id+display"}
            return {**res, "ok": False, "status": "wrong_chat", "reason": f"thread header {heads[:2]} does not show {expect_display!r}"}
        return {**res, "ok": True, "by": "thread_id"}

    async def rows(self, page: Page, limit: int = 10000) -> list[dict]:
        return await safe_eval(page, FB_ROWS_JS, limit, []) or []

    async def scroll_history(self, page: Page, limit: int) -> bool:
        prev, stable = -1, 0
        for _ in range(40):
            n = len(await self.rows(page))
            if n >= limit:
                return False
            stable = stable + 1 if n == prev else 0
            if stable >= 3:
                return True
            prev = n
            await scroll_up(page, '[role="main"] [role="row"]')
            await page.wait_for_timeout(1500)
        return False

    async def history(self, page: Page, peer: str, limit: int = 200, expect_display: str | None = None) -> dict:
        chk = await self.open_thread(page, peer, expect_display)
        if chk.get("status") == "no_chat":
            return {"status": "no_chat", "reason": chk["reason"], "messages": []}
        complete = await self.scroll_history(page, limit)
        msgs = (await self.rows(page))[-limit:]
        return {"status": "ok", "thread_id": chk["thread_id"], "header": chk["title"], "verified": chk["ok"],
                "verified_by": chk.get("by"), "verify_note": chk.get("reason"), "complete": complete,
                "count": len(msgs), "messages": msgs,
                "note": "dir is inferred from bubble position; 'unknown' when it could not tell."}

    async def media(self, page: Page, peer: str, out: Path, limit: int = 20, expect_display: str | None = None,
                    sess: Session | None = None) -> dict:
        chk = await self.open_thread(page, peer, expect_display)
        if chk.get("status") == "no_chat":
            return {"status": "no_chat", "reason": chk["reason"], "files": []}
        await self.scroll_history(page, 300)
        thread_url = page.url
        imgs = page.locator('[role="main"] [role="row"] img')
        n = await imgs.count()
        files, skipped = [], 0
        for i in reversed(range(n)):
            if len(files) >= limit:
                break
            img = imgs.nth(i)
            try:
                src = await img.get_attribute("src") or ""
                box = await img.bounding_box()
                if not re.search(r"fbcdn|scontent", src) or not box or box["width"] < 80:
                    continue
                await img.scroll_into_view_if_needed(timeout=3000)
                await img.click(timeout=3000)
                await page.wait_for_timeout(2000)
                big = await safe_eval(page, LARGEST_IMG_JS)
                url = big["src"] if big and re.search(r"fbcdn|scontent", big["src"]) else src
                suffix = "" if url != src else "_thumb"
                resp = await page.context.request.get(url)
                if resp.ok:
                    path = out / f"fb_{len(files) + 1:03d}{suffix}{_ext_for(resp.headers.get('content-type', ''), url)}"
                    _write_private(path, await resp.body())
                    files.append(str(path))
                else:
                    skipped += 1
            except Exception:
                skipped += 1
            finally:
                with contextlib.suppress(Exception):
                    await page.keyboard.press("Escape")
                    await page.wait_for_timeout(500)
                    if page.url != thread_url:
                        await page.goto(thread_url, wait_until="domcontentloaded")
                        await page.wait_for_timeout(2500)
                        imgs = page.locator('[role="main"] [role="row"] img')
        return {"status": "ok", "verified": chk["ok"], "files": files, "skipped": skipped, "dir": str(out),
                "note": "Newest first; '_thumb' = the photo viewer did not give a larger image."}

    async def send(self, page: Page, peer: str, text: str, expect_display: str | None = None,
                   pacer: Pacer | None = None, allow_repeat: bool = False) -> dict:
        if pacer:
            await pacer.check(new_chat=None)
        chk = await self.open_thread(page, peer, expect_display)
        if not chk["ok"]:
            return {"status": chk.get("status", "wrong_chat"), "sent": False, "reason": chk.get("reason"), "header": chk.get("title")}
        rows = await self.rows(page)
        new_chat = not rows
        outs = [r for r in rows if r["dir"] == "out"]
        if outs and not allow_repeat and rows and rows[-1]["dir"] == "out" and same_text(rows[-1]["text"], text):
            return {"status": "already_sent", "sent": False, "reason": "the last message is ours with this text (allow_repeat=true to send again)"}
        if pacer:
            await pacer.check(new_chat=new_chat)
        try:
            await page.locator(FB_BOX).last.wait_for(timeout=10000)
        except PWTimeout:
            return {"status": "not_sent", "sent": False, "reason": "message box not found (thread closed, blocked, or PIN prompt?)"}
        before = sum(1 for r in rows if same_text(r["text"], text))
        if not await _fill_box(page, FB_BOX, text, paste_first=False):
            await _clear_box(page, FB_BOX)
            return {"status": "not_sent", "sent": False, "reason": "could not put the text into the message box"}
        if pacer:
            pacer.record(chk["thread_id"], new_chat)
        try:
            await page.keyboard.press("Enter")
        except PWError:
            return {"status": "unknown", "sent": None, "reason": UNKNOWN}
        return await verify_by_count(page, self.rows, text, before, pacer, chk, new_chat, "fb_history")


async def verify_by_count(page: Page, rows_fn, text: str, before: int, pacer: Pacer | None, chk: dict,
                          new_chat: bool, history_tool: str, timeout: float = 15) -> dict:
    """Sent = a row with our text appeared (count went up) and it is not marked failed."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        await page.wait_for_timeout(1000)
        rows = await rows_fn(page)
        matches = [r for r in rows if same_text(r.get("text", ""), text)]
        if len(matches) > before:
            warn = await _limit_warning(page)
            if warn and pacer:
                pacer.block(warn)
            if matches[-1].get("failed"):
                return {"status": "failed_visible", "sent": False, "reason": "the message shows 'not sent'; check the thread before retrying",
                        "limit_warning": warn}
            return {"status": "sent", "sent": True, "header": chk.get("title"), "verified_by": chk.get("by"),
                    "new_chat": new_chat, "limit_warning": warn}
    warn = await _limit_warning(page)
    if warn and pacer:
        pacer.block(warn)
    return {"status": "unknown", "sent": None, "reason": UNKNOWN, "limit_warning": warn,
            "next": f"call {history_tool} for this peer and look at the last messages"}


# ---------------------------------------------------------------- Instagram

IG_API_JS = r"""
async ([path, method, form]) => {
  const csrf = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1] || '';
  const opts = {method: method || 'GET', credentials: 'include', headers: {
    'X-IG-App-ID': '""" + IG_APP_ID + r"""', 'X-CSRFToken': csrf, 'X-Requested-With': 'XMLHttpRequest',
    'X-IG-WWW-Claim': sessionStorage.getItem('www-claim-v2') || '0'}};
  if (form) { opts.headers['Content-Type'] = 'application/x-www-form-urlencoded'; opts.body = form; }
  const r = await fetch(path, opts);
  return {status: r.status, body: await r.text()};
}
"""

IG_BOX = 'div[role="textbox"][contenteditable="true"], textarea[placeholder*="essage"]'


def _ig_time(ts: Any) -> str | None:
    try:
        v = int(ts)
    except (TypeError, ValueError):
        return None
    if v > 10**14:
        v //= 1_000_000
    elif v > 10**11:
        v //= 1000
    return datetime.fromtimestamp(v).astimezone().isoformat(timespec="minutes")


def ig_item(item: dict, viewer_id: str) -> dict:
    """Instagram direct item -> Hunt message dict (text + media descriptors)."""
    t = item.get("item_type") or "unknown"
    out: dict[str, Any] = {"id": item.get("item_id"), "dir": "out" if str(item.get("user_id")) == str(viewer_id) else "in",
                           "time": _ig_time(item.get("timestamp")), "type": t, "text": item.get("text") or "", "media": []}

    def best_image(m: dict) -> str | None:
        c = ((m or {}).get("image_versions2") or {}).get("candidates") or []
        return max(c, key=lambda x: x.get("width", 0) * x.get("height", 0)).get("url") if c else None

    def media_desc(m: dict, kind: str) -> dict:
        d: dict[str, Any] = {"type": kind}
        if m.get("video_versions"):
            d["type"] = "video"
            d["url"] = m["video_versions"][0].get("url")
        img = best_image(m)
        if img:
            d["image_url"] = img
        if m.get("code"):
            d["post"] = f"https://www.instagram.com/p/{m['code']}/"
        cap = (m.get("caption") or {}).get("text") if isinstance(m.get("caption"), dict) else None
        if cap:
            d["caption"] = cap
        return d

    if t == "media":
        m = item.get("media") or {}
        out["media"].append(media_desc(m, "image"))
    elif t in ("media_share", "clip", "felix_share", "story_share", "reel_share"):
        m = item.get(t) or {}
        inner = m.get("media") or m.get("clip") or m
        out["media"].append(media_desc(inner, t))
        if m.get("text"):
            out["text"] = out["text"] or m["text"]
    elif t == "link":
        ln = item.get("link") or {}
        out["text"] = ln.get("text") or out["text"]
        url = (ln.get("link_context") or {}).get("link_url")
        if url:
            out["media"].append({"type": "link", "url": url})
    elif t == "voice_media":
        out["media"].append({"type": "voice"})
    elif t == "animated_media":
        out["media"].append({"type": "gif"})
    elif t == "like":
        out["text"] = out["text"] or item.get("like") or "❤️"
    elif t == "action_log":
        out["dir"] = "system"
        out["text"] = (item.get("action_log") or {}).get("description") or ""
    elif t.startswith("xma"):
        for x in item.get(t) or []:
            out["media"].append({"type": "link", "url": x.get("target_url"), "title": x.get("title_text")})
    elif t == "raven_media" or t == "visual_media":
        out["media"].append({"type": "disappearing_media"})
    elif t == "placeholder":
        out["text"] = out["text"] or ((item.get("placeholder") or {}).get("message") or "")
    return out


def ig_peer(peer: str) -> tuple[str | None, str | None]:
    """(thread_id, username) from a thread URL/id or @username/profile URL."""
    s = (peer or "").strip()
    m = re.search(r"/direct/t/(\d+)", s)
    if m:
        return m.group(1), None
    if re.fullmatch(r"\d{15,}", s):
        return s, None
    m = re.search(r"instagram\.com/([A-Za-z0-9._]+)/?", s)
    if m and m.group(1) not in ("direct", "p", "reel", "stories"):
        return None, m.group(1)
    s = s.lstrip("@")
    if re.fullmatch(r"[A-Za-z0-9._]{1,30}", s):
        return None, s
    return None, None


class Instagram:
    channel = "instagram"
    cookie = "sessionid"

    def __init__(self, base: str = IG):
        self.base = base

    async def ensure_origin(self, page: Page, sess: Session) -> None:
        ck = await sess.cookies(self.base)
        if not ck.get(self.cookie):
            raise LoginNeeded("Instagram is not logged in: call ig_login (a window opens; the hunter logs in).")
        if not page.url.startswith(self.base):
            await page.goto(self.base + "/direct/inbox/", wait_until="domcontentloaded")
            await page.wait_for_timeout(2500)
        if "/accounts/login" in page.url or "/challenge" in page.url:
            raise LoginNeeded("Instagram wants the hunter to log in again or pass a check: call ig_login.")

    async def api(self, page: Page, path: str, method: str = "GET", form: str | None = None) -> dict:
        r = await safe_eval(page, IG_API_JS, [path, method, form], None)
        if not r:
            raise ToolError("Instagram API call failed (page navigated?); retry.")
        if r["status"] in (401, 403) or '"require_login"' in r["body"][:500]:
            raise LoginNeeded("Instagram session expired: call ig_login.")
        if r["status"] == 429:
            raise ToolError("Instagram says 'please wait a few minutes' (429). Stop Instagram for now.")
        try:
            data = json.loads(r["body"])
        except json.JSONDecodeError:
            raise ToolError(f"Instagram API {path.split('?')[0]} returned {r['status']} (not JSON).")
        if r["status"] >= 400:
            raise ToolError(f"Instagram API {path.split('?')[0]} -> {r['status']}: {str(data.get('message', ''))[:200]}")
        return data

    async def status(self, page: Page, sess: Session) -> dict:
        try:
            await self.ensure_origin(page, sess)
            me = await self.api(page, "/api/v1/accounts/current_user/?edit=true")
        except LoginNeeded as e:
            return {"logged_in": False, "how": str(e)}
        u = me.get("user") or {}
        return {"logged_in": True, "user_id": str(u.get("pk") or u.get("pk_id") or ""), "username": u.get("username"),
                "full_name": u.get("full_name")}

    def _thread_summary(self, t: dict, viewer: str, request: bool = False) -> dict:
        users = [{"user_id": str(u.get("pk")), "username": u.get("username"), "full_name": u.get("full_name")}
                 for u in t.get("users") or []]
        items = t.get("items") or []
        last = ig_item(items[0], viewer) if items else None
        seen = (t.get("last_seen_at") or {}).get(str(viewer), {}).get("item_id")
        unread = bool(t.get("read_state")) or (last is not None and last["dir"] == "in" and seen and seen != last["id"])
        return {"thread_id": t.get("thread_id"), "thread_v2_id": t.get("thread_v2_id"),
                "title": t.get("thread_title"), "users": users, "unread": bool(unread), "request": request,
                "last": last and {"dir": last["dir"], "time": last["time"], "text": last["text"][:300], "media": last["media"]}}

    async def inbox(self, page: Page, sess: Session, limit: int = 30, all_chats: bool = False, requests: bool = True) -> dict:
        await self.ensure_origin(page, sess)
        data = await self.api(page, f"/api/v1/direct_v2/inbox/?persistentBadging=true&folder=&limit={min(max(limit, 10), 50)}&thread_message_limit=1")
        viewer = str((data.get("viewer") or {}).get("pk") or (await sess.cookies(self.base)).get("ds_user_id") or "")
        threads = [self._thread_summary(t, viewer) for t in (data.get("inbox") or {}).get("threads") or []]
        if requests:
            with contextlib.suppress(ToolError):
                pend = await self.api(page, "/api/v1/direct_v2/pending_inbox/?persistentBadging=true&limit=20")
                threads += [self._thread_summary(t, viewer, request=True) for t in (pend.get("inbox") or {}).get("threads") or []]
        chats = [t for t in threads if all_chats or t["unread"] or t["request"]][:limit]
        return {"chats": chats, "unread_total": sum(1 for t in chats if t["unread"]),
                "note": "request=true: message requests from people you don't follow; replying accepts the request."}

    async def thread_by_username(self, page: Page, username: str) -> tuple[str | None, dict | None]:
        prof = await self.api(page, f"/api/v1/users/web_profile_info/?username={quote(username)}")
        u = (prof.get("data") or {}).get("user") or {}
        pk = u.get("id")
        if not pk:
            return None, None
        user = {"user_id": str(pk), "username": u.get("username"), "full_name": u.get("full_name")}
        with contextlib.suppress(ToolError):
            t = await self.api(page, f"/api/v1/direct_v2/threads/get_by_participants/?recipient_users=%5B{pk}%5D")
            tid = (t.get("thread") or {}).get("thread_id")
            if tid:
                return str(tid), user
        return None, user

    async def fetch_thread(self, page: Page, tid: str, limit: int) -> tuple[dict, list[dict]]:
        items: list[dict] = []
        cursor, thread = None, {}
        for _ in range(40):
            q = f"/api/v1/direct_v2/threads/{tid}/?limit=20" + (f"&cursor={quote(cursor)}" if cursor else "")
            data = await self.api(page, q)
            thread = data.get("thread") or {}
            items += thread.get("items") or []
            if len(items) >= limit or not thread.get("has_older"):
                break
            cursor = thread.get("oldest_cursor")
            if not cursor:
                break
            await asyncio.sleep(0.8)
        return thread, items[:limit]

    async def resolve_peer(self, page: Page, sess: Session, peer: str) -> dict:
        await self.ensure_origin(page, sess)
        tid, username = ig_peer(peer)
        if not tid and not username:
            raise ToolError("Instagram peer must be a thread id / instagram.com/direct/t/<id> URL or a username.")
        user = None
        if username:
            tid, user = await self.thread_by_username(page, username)
            if not user:
                return {"ok": False, "status": "no_chat", "reason": f"no Instagram user {username!r}"}
        return {"ok": True, "thread_id": tid, "user": user, "username": username}

    def _verify_users(self, thread: dict, expect_display: str | None, username: str | None) -> dict:
        users = thread.get("users") or []
        names = [f"{u.get('username', '')} {u.get('full_name', '')}" for u in users] + [thread.get("thread_title") or ""]
        if username and any((u.get("username") or "").lower() == username.lower() for u in users):
            return {"ok": True, "by": "username"}
        if expect_display and any(display_matches(n, expect_display) for n in names):
            return {"ok": True, "by": "display"}
        if not username and not expect_display:
            return {"ok": True, "by": "thread_id"}
        return {"ok": False, "status": "wrong_chat", "reason": f"thread participants {names[:3]} do not match"}

    async def history(self, page: Page, sess: Session, peer: str, limit: int = 200, expect_display: str | None = None) -> dict:
        r = await self.resolve_peer(page, sess, peer)
        if not r["ok"]:
            return {"status": "no_chat", "reason": r["reason"], "messages": []}
        if not r["thread_id"]:
            return {"status": "no_chat", "reason": "no conversation with this user yet", "user": r["user"], "messages": []}
        viewer = (await sess.cookies(self.base)).get("ds_user_id", "")
        thread, items = await self.fetch_thread(page, r["thread_id"], limit)
        v = self._verify_users(thread, expect_display, r.get("username"))
        msgs = [ig_item(i, viewer) for i in reversed(items)]
        return {"status": "ok", "thread_id": r["thread_id"], "header": thread.get("thread_title"),
                "users": [{"username": u.get("username"), "full_name": u.get("full_name")} for u in thread.get("users") or []],
                "verified": v["ok"], "verified_by": v.get("by"), "verify_note": v.get("reason"),
                "complete": not thread.get("has_older") or len(items) < limit, "count": len(msgs), "messages": msgs}

    async def media(self, page: Page, sess: Session, peer: str, out: Path, limit: int = 20, expect_display: str | None = None) -> dict:
        h = await self.history(page, sess, peer, 300, expect_display)
        if h["status"] != "ok":
            return {**h, "files": []}
        files, skipped = [], 0
        for m in reversed(h["messages"]):
            for d in m["media"]:
                url = d.get("image_url") if d["type"] in ("image", "media_share", "clip", "story_share", "reel_share", "felix_share", "video") else None
                if not url or len(files) >= limit:
                    continue
                try:
                    resp = await page.context.request.get(url)
                    if not resp.ok:
                        skipped += 1
                        continue
                    path = out / f"ig_{len(files) + 1:03d}{'' if d['type'] == 'image' else '_' + d['type']}{_ext_for(resp.headers.get('content-type', ''), url)}"
                    _write_private(path, await resp.body())
                    files.append(str(path))
                except PWError:
                    skipped += 1
        return {"status": "ok", "verified": h["verified"], "files": files, "skipped": skipped, "dir": str(out),
                "note": "Newest first, full-size images (videos: cover image only)."}

    async def send(self, page: Page, sess: Session, peer: str, text: str, expect_display: str | None = None,
                   pacer: Pacer | None = None, allow_repeat: bool = False) -> dict:
        if pacer:
            await pacer.check(new_chat=None)
        r = await self.resolve_peer(page, sess, peer)
        if not r["ok"]:
            return {"status": "no_chat", "sent": False, "reason": r["reason"]}
        viewer = (await sess.cookies(self.base)).get("ds_user_id", "")
        tid = r["thread_id"]
        thread, items = ({}, [])
        if tid:
            thread, items = await self.fetch_thread(page, tid, 20)
            v = self._verify_users(thread, expect_display, r.get("username"))
            if not v["ok"]:
                return {"status": "wrong_chat", "sent": False, "reason": v["reason"]}
            last_out = next((ig_item(i, viewer) for i in items if str(i.get("user_id")) == str(viewer)), None)
            if last_out and not allow_repeat and items and str(items[0].get("user_id")) == str(viewer) and same_text(last_out["text"], text):
                return {"status": "already_sent", "sent": False, "reason": "the last message is ours with this text (allow_repeat=true to send again)"}
        new_chat = not items
        if pacer:
            await pacer.check(new_chat=new_chat)
        if tid:
            await page.goto(f"{self.base}/direct/t/{tid}/", wait_until="domcontentloaded")
        else:  # no conversation yet: profile → "Message" opens an empty thread (nothing is sent)
            await page.goto(f"{self.base}/{r['username']}/", wait_until="domcontentloaded")
            await page.wait_for_timeout(2500)
            btn = page.get_by_role("button", name=re.compile(r"^\s*message\s*$", re.I))
            if not await btn.count():
                btn = page.get_by_text(re.compile(r"^\s*Message\s*$"))
            try:
                await btn.first.click(timeout=5000)
                await page.wait_for_url(re.compile(r"/direct/t/\d+"), timeout=15000)
            except (PWTimeout, PWError):
                return {"status": "not_sent", "sent": False, "reason": "could not open a new conversation (no Message button: private account or DMs closed?)"}
            tid = re.search(r"/direct/t/(\d+)", page.url).group(1)
        await page.wait_for_timeout(2500)
        with contextlib.suppress(Exception):  # "Turn on notifications?" → Not now
            nn = page.get_by_role("button", name=re.compile(r"not now", re.I))
            if await nn.count():
                await nn.first.click(timeout=2000)
        if f"/direct/t/{tid}" not in page.url:
            return {"status": "not_sent", "sent": False, "reason": "Instagram did not open the thread"}
        try:
            await page.locator(IG_BOX).last.wait_for(timeout=10000)
        except PWTimeout:
            return {"status": "not_sent", "sent": False, "reason": "message box not found"}
        before_ts = int(items[0].get("timestamp", 0)) if items else 0
        if not await _fill_box(page, IG_BOX, text, paste_first=False):
            await _clear_box(page, IG_BOX)
            return {"status": "not_sent", "sent": False, "reason": "could not put the text into the message box"}
        if pacer:
            pacer.record(tid, new_chat)
        try:
            await page.keyboard.press("Enter")
        except PWError:
            return {"status": "unknown", "sent": None, "reason": UNKNOWN}
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            await asyncio.sleep(2)
            with contextlib.suppress(ToolError, LoginNeeded):
                _, latest = await self.fetch_thread(page, tid, 5)
                for it in latest:
                    if str(it.get("user_id")) == str(viewer) and int(it.get("timestamp", 0)) > before_ts and same_text(it.get("text") or "", text):
                        warn = await _limit_warning(page)
                        if warn and pacer:
                            pacer.block(warn)
                        return {"status": "sent", "sent": True, "thread_id": tid, "message_id": it.get("item_id"),
                                "verified_by": "api", "new_chat": new_chat, "limit_warning": warn,
                                "note": "first message to a non-follower lands in their Requests; one message until they accept" if new_chat else None}
        warn = await _limit_warning(page)
        if warn and pacer:
            pacer.block(warn)
        return {"status": "unknown", "sent": None, "reason": UNKNOWN, "thread_id": tid, "limit_warning": warn,
                "next": "call ig_history for this peer and look at the last messages"}

    async def resolve(self, page: Page, sess: Session, query: str) -> dict:
        await self.ensure_origin(page, sess)
        tid, username = ig_peer(query)
        if tid:
            thread, _ = await self.fetch_thread(page, tid, 1)
            return {"query": query, "thread_id": tid, "title": thread.get("thread_title"),
                    "users": [{"user_id": str(u.get("pk")), "username": u.get("username"), "full_name": u.get("full_name")} for u in thread.get("users") or []]}
        res: dict[str, Any] = {"query": query, "matches": []}
        if username:
            with contextlib.suppress(ToolError):
                t, user = await self.thread_by_username(page, username)
                if user:
                    res["matches"].append({**user, "thread_id": t})
        if not res["matches"]:
            with contextlib.suppress(ToolError):
                data = await self.api(page, f"/api/v1/direct_v2/ranked_recipients/?mode=raven&show_threads=true&query={quote(query)}")
                for rr in data.get("ranked_recipients") or []:
                    if rr.get("thread"):
                        t = rr["thread"]
                        res["matches"].append({"thread_id": t.get("thread_id"), "title": t.get("thread_title")})
                    elif rr.get("user"):
                        u = rr["user"]
                        res["matches"].append({"user_id": str(u.get("pk")), "username": u.get("username"), "full_name": u.get("full_name")})
        return res


# ---------------------------------------------------------------- headed login for Messenger / Instagram

LOGIN_URLS = {"messenger": FB + "/messages/t/", "instagram": IG + "/accounts/login/"}
LOGIN_COOKIES = {"messenger": (FB, "c_user"), "instagram": (IG, "sessionid")}
COOKIE_DOMAINS = {"messenger": ("facebook.com", "messenger.com"), "instagram": ("instagram.com",)}


async def headed_login_watch(sess: Session, minutes: float = 15.0) -> None:
    """Background: wait for the session cookie in the visible window, then close it (headless next time).
    For Messenger the window also stays usable for the e2ee PIN: it closes once the cookie exists AND
    the hunter closes the window, or after the cookie appears and no PIN prompt is visible."""
    url, name = LOGIN_COOKIES[sess.channel]
    deadline = time.monotonic() + minutes * 60
    try:
        while time.monotonic() < deadline:
            await asyncio.sleep(2)
            if sess.ctx is None or not sess.headed:
                sess.login["state"] = "window_closed" if sess.login.get("state") != "logged_in" else "logged_in"
                return
            ck = await sess.cookies(url)
            if not [p for p in sess.ctx.pages if not p.is_closed()]:  # hunter closed the window
                sess.login["state"] = "logged_in" if ck.get(name) else "window_closed"
                async with sess.lock:
                    await sess.close()
                return
            if ck.get(name):
                await asyncio.sleep(6)  # a PIN / checkpoint prompt can show up a few seconds after login
                pin = False
                for pg in [p for p in (sess.ctx.pages if sess.ctx else []) if not p.is_closed()]:
                    st = await safe_eval(pg, FB_STATE_JS, None, {"state": "ok"}) or {"state": "ok"}
                    pin = pin or st["state"] in ("pin", "checkpoint", "login")
                if pin or "/challenge" in (sess._page.url if sess._page and not sess._page.is_closed() else ""):
                    sess.login["state"] = "waiting_for_pin_or_check"
                    continue
                sess.login.update(state="logged_in", user_id=ck.get(name) if name == "c_user" else ck.get("ds_user_id"))
                async with sess.lock:
                    await sess.close()
                return
            sess.login["state"] = "waiting_for_login"
        sess.login["state"] = "timeout"
        async with sess.lock:
            await sess.close()
    except Exception as e:
        sess.login.update(state="error", error=str(e)[:300])


def convert_cookies(raw: Any, channel: str) -> list[dict]:
    """Cookie-Editor / EditThisCookie export or Playwright storage_state → Playwright cookies (channel domains only)."""
    items = raw.get("cookies") if isinstance(raw, dict) else raw
    if not isinstance(items, list):
        raise ToolError("cookies file must be a JSON list of cookies (Cookie-Editor export) or a storage_state with 'cookies'.")
    same = {"no_restriction": "None", "none": "None", "lax": "Lax", "strict": "Strict"}
    out = []
    for c in items:
        if not isinstance(c, dict) or not c.get("name") or "value" not in c:
            continue
        dom = str(c.get("domain") or "")
        if not any(dom.lstrip(".").endswith(d) for d in COOKIE_DOMAINS[channel]):
            continue
        ck: dict[str, Any] = {"name": c["name"], "value": str(c["value"]), "domain": dom, "path": c.get("path") or "/",
                              "httpOnly": bool(c.get("httpOnly")), "secure": bool(c.get("secure", True))}
        exp = c.get("expires", c.get("expirationDate"))
        if isinstance(exp, (int, float)) and exp > 0 and not c.get("session"):
            ck["expires"] = float(exp)
        ss = same.get(str(c.get("sameSite", "")).lower())
        if ss:
            ck["sameSite"] = ss
            if ss == "None":
                ck["secure"] = True
        out.append(ck)
    return out


# ---------------------------------------------------------------- tool plumbing

WAPP, MSGR, INSTA = WhatsApp(), Messenger(), Instagram()


async def run(channel: str, account: str, fn, *, need_lock: bool = True):
    """Run fn(sess, page) on the session page; login/crash errors become clear tool errors."""
    sess = session(channel, account)
    if sess.headed:
        raise ToolError(f"A login window for {channel}/{sess.account} is open. Finish logging in there (or close it), "
                        f"then retry. Check with {channel[:2] if channel != 'messenger' else 'fb'}_login_status.")
    for attempt in (1, 2):
        try:
            async with (sess.lock if need_lock else contextlib.nullcontext()):
                page = await sess.page()
                return await fn(sess, page)
        except LoginNeeded as e:
            raise ToolError(f"login needed: {e}") from e
        except Paced as p:
            return p.result()
        except PWError as e:
            msg = str(e)
            closed = "closed" in msg.lower() or "crash" in msg.lower() or "Target" in msg
            if closed and attempt == 1 and not getattr(fn, "is_send", False):
                await sess.close()  # browser/page died: relaunch once for read-only work
                continue
            if closed:
                await sess.close()
            raise ToolError(f"{channel} browser error: {msg.splitlines()[0][:300]}") from e


def send_fn(fn):
    fn.is_send = True  # never auto-retried
    return fn


def _limit(n: int, lo: int = 1, hi: int = 2000) -> int:
    return max(lo, min(int(n or lo), hi))


def _text_arg(text: str) -> str:
    if not (text or "").strip():
        raise ToolError("text is empty")
    if len(text) > 4000:
        raise ToolError("text is longer than 4000 characters; split it")
    return text


# ---------------------------------------------------------------- WhatsApp tools

@mcp.tool()
async def wa_login(account: str = "main") -> dict:
    """Link WhatsApp Web (headless) to the hunting WhatsApp account. Saves the QR code as
    ~/.config/hunt/browser/qr-<account>.png (and qr-<account>.html, which auto-refreshes) and keeps it
    fresh in the background for ~6 minutes. Show the PNG to the hunter: WhatsApp on the hunting phone →
    Settings → Linked devices → Link a device → scan. Then poll wa_login_status until linked."""
    acct = check_account(account)
    sess = session("whatsapp", acct)
    png, html = qr_paths(acct)

    async def go(s: Session, page: Page):
        if not page.url.startswith(WA):
            await page.goto(WA + "/", wait_until="domcontentloaded")
        st = await WAPP.wait_state(page, {"app", "chat", "qr", "qr_expired"}, timeout=60)
        if st["state"] in ("app", "chat"):
            return {"status": "already_linked", "number": await WAPP.own_number(page)}
        if st["state"] == "qr_expired":
            with contextlib.suppress(Exception):
                await page.get_by_role("button", name=re.compile("reload qr", re.I)).first.click(timeout=3000)
                await page.wait_for_timeout(2000)
        if st["state"] not in ("qr", "qr_expired"):
            return {"status": "not_ready", "state": st["state"], "detail": st.get("text")}
        with contextlib.suppress(Exception):  # keep "Stay logged in on this browser" ticked
            cb = page.get_by_role("checkbox")
            if await cb.count() and not await cb.first.is_checked():
                await cb.first.check(timeout=2000)
        if not await WAPP.qr_snapshot(page, png):
            return {"status": "not_ready", "state": "qr canvas not found"}
        write_qr_html(html, png.name)
        return {"status": "qr", "qr_png": str(png), "qr_page": str(html)}

    res = await run("whatsapp", acct, go)
    if res.get("status") == "qr":
        sess.login = {"state": "qr", "qr_updated": datetime.now().isoformat(timespec="seconds")}
        if sess.login_task is None or sess.login_task.done():
            sess.login_task = asyncio.create_task(wa_login_watch(sess, WAPP, acct))
        res["next"] = ("Show the QR to the hunter (Read the PNG to display it, or they open qr_page in a browser). "
                       "It rotates and expires; the file is refreshed for ~6 min. Then call wa_login_status(wait_s=60).")
    return res


@mcp.tool()
async def wa_login_status(account: str = "main", wait_s: int = 0) -> dict:
    """Is WhatsApp linked yet? wait_s (0-120) polls until the chat list appears. Returns the QR path
    while still waiting, 'syncing' while chats load after the scan, 'linked' with the own number when done."""
    acct = check_account(account)
    sess = session("whatsapp", acct)
    png, html = qr_paths(acct)
    deadline = time.monotonic() + max(0, min(int(wait_s or 0), 120))
    while True:
        st = await run("whatsapp", acct, lambda s, p: safe_eval(p, WA_STATE_JS, None, {"state": "loading"}))
        st = st or {"state": "loading"}
        if st["state"] in ("app", "chat"):
            num = await run("whatsapp", acct, lambda s, p: WAPP.own_number(p))
            return {"status": "linked", "number": num}
        if time.monotonic() >= deadline:
            break
        await asyncio.sleep(3)
    state = st["state"]
    if state in ("qr", "qr_expired"):
        watcher = sess.login_task is not None and not sess.login_task.done()
        if not watcher:
            return {"status": "qr_expired", "next": "the QR is no longer refreshed: call wa_login again for a fresh one"}
        return {"status": "waiting_for_scan", "qr_png": str(png), "qr_page": str(html),
                "qr_updated": sess.login.get("qr_updated")}
    if state == "loading":
        return {"status": "syncing", "detail": st.get("text"), "next": "linked, chats are loading; retry in 30-60 s"}
    return {"status": state, "detail": st.get("text")}


@mcp.tool()
async def wa_status(account: str = "main") -> dict:
    """WhatsApp: linked? own number? plus today's pacing counters."""
    acct = check_account(account)
    res = await run("whatsapp", acct, lambda s, p: WAPP.status(p))
    res["pacing"] = Pacer("whatsapp", acct).summary()
    return res


@mcp.tool()
async def wa_inbox(account: str = "main", limit: int = 30, all_chats: bool = False) -> dict:
    """WhatsApp chats with unread messages or missed calls (name or number, last message preview, unread
    count, time). all_chats=true lists recent chats regardless of unread state. Opening a chat later
    (wa_history) marks it read on the hunter's phone too."""
    return await run("whatsapp", account, lambda s, p: WAPP.inbox(p, _limit(limit, 1, 200), all_chats))


@mcp.tool()
async def wa_history(account: str = "main", peer: str = "", limit: int = 200, expect_display: str | None = None) -> dict:
    """Full WhatsApp thread with one contact, oldest first (scrolls up to `limit` messages). peer = phone
    number (any format, opened via /send?phone=) or an exact chat name. Each message: dir in/out/system,
    time, text (captions included), media descriptors (image/video/voice/document/location/contact/
    missed_call), tick status for ours. verified=false means the header shows neither the number nor
    expect_display: check before trusting it. Decide the language from dir='in' messages only."""
    if not peer:
        raise ToolError("peer is required (phone number or exact chat name)")
    return await run("whatsapp", account, lambda s, p: WAPP.history(p, peer, _limit(limit), expect_display))


@mcp.tool()
async def wa_media(account: str = "main", peer: str = "", out_dir: str | None = None, limit: int = 20,
                   expect_display: str | None = None) -> dict:
    """Save photos from a WhatsApp chat as files (full size via the photo viewer; newest first).
    Default folder: ~/.config/hunt/browser/media/whatsapp-<account>/<peer>/. Videos are only counted."""
    if not peer:
        raise ToolError("peer is required")
    acct = check_account(account)
    out = media_dir("whatsapp", acct, peer, out_dir)
    return await run("whatsapp", acct, lambda s, p: WAPP.media(p, peer, out, _limit(limit, 1, 200), expect_display))


@mcp.tool()
async def wa_send(account: str = "main", peer: str = "", text: str = "", expect_display: str | None = None,
                  allow_repeat: bool = False) -> dict:
    """Send one WhatsApp message. Opens the chat by number (/send?phone=digits), checks the header shows
    that number — or expect_display (the display name stored in the CRM; needed for saved contacts and
    business accounts, which show a name) — pastes the text, presses Enter and verifies the new outgoing
    message. Status: sent | sent_pending (clock icon; do not resend) | unknown (check before resending:
    read wa_history first, NEVER resend blindly) | not_sent (safe to retry) | wrong_chat | no_chat |
    already_sent | paced (quiet hours / interval / daily new-chat cap; retry_after given).
    Multi-line text is fine. One message per call."""
    if not peer:
        raise ToolError("peer is required (phone number)")
    text = _text_arg(text)
    acct = check_account(account)
    pacer = Pacer("whatsapp", acct)
    return await run("whatsapp", acct, send_fn(lambda s, p: WAPP.send(p, peer, text, expect_display, pacer, allow_repeat)))


@mcp.tool()
async def wa_resolve(account: str = "main", query: str = "") -> dict:
    """Is this number on WhatsApp, and what does the chat header show (number or business/saved name)?
    For a name: searches the chat list and returns matching chats. Sends nothing."""
    if not query:
        raise ToolError("query is required")
    return await run("whatsapp", account, lambda s, p: WAPP.resolve(p, query))


# ---------------------------------------------------------------- Messenger & Instagram login tools

async def _headed_login(channel: str, account: str, cookies_file: str | None) -> dict:
    acct = check_account(account)
    sess = session(channel, acct)
    url, name = LOGIN_COOKIES[channel]
    if cookies_file:
        p = Path(cookies_file).expanduser()
        try:
            raw = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as e:
            raise ToolError(f"cannot read cookies file {p}: {e}")
        cookies = convert_cookies(raw, channel)
        if not any(c["name"] == name for c in cookies):
            raise ToolError(f"the file has no '{name}' cookie for {COOKIE_DOMAINS[channel][0]}; export cookies while logged in.")

        async def imp(s: Session, page: Page):
            await s.ctx.add_cookies(cookies)
            return {"status": "imported", "cookies": len(cookies)}

        res = await run(channel, acct, imp)
        st = await (fb_status(acct) if channel == "messenger" else ig_status(acct))
        res.update(session=st, reminder=f"Delete {p} now: it is a login token for the hunter's account.")
        return res
    async with sess.lock:
        await sess.close()
        await sess.start(headed=True)
        page = await sess.page()
        page.set_default_timeout(30000)
        with contextlib.suppress(PWError):
            await page.goto(LOGIN_URLS[channel], wait_until="domcontentloaded")
    sess.login = {"state": "waiting_for_login", "opened": datetime.now().isoformat(timespec="seconds")}
    if sess.login_task is None or sess.login_task.done():
        sess.login_task = asyncio.create_task(headed_login_watch(sess))
    who = "Facebook" if channel == "messenger" else "Instagram"
    return {"status": "window_open", "profile": str(sess.dir),
            "tell_hunter": (f"A separate Chromium window with {who} opened (Hunt's own profile, not your Chrome). "
                            f"Log in there yourself{' and enter the Messenger PIN if asked' if channel == 'messenger' else ''}. "
                            "The window closes by itself once you're in. Hunt never sees your password."),
            "next": f"poll {'fb' if channel == 'messenger' else 'ig'}_login_status(wait_s=60)"}


async def _headed_login_status(channel: str, account: str, wait_s: int) -> dict:
    acct = check_account(account)
    sess = session(channel, acct)
    deadline = time.monotonic() + max(0, min(int(wait_s or 0), 120))
    while sess.headed and sess.ctx is not None and time.monotonic() < deadline:
        await asyncio.sleep(2)
    if sess.headed and sess.ctx is not None:
        return {"status": sess.login.get("state", "waiting_for_login"), "window": "open"}
    st = await (fb_status(acct) if channel == "messenger" else ig_status(acct))
    return {"status": "logged_in" if st.get("logged_in") else sess.login.get("state", "not_logged_in"), "session": st}


@mcp.tool()
async def fb_login(account: str = "main", cookies_file: str | None = None) -> dict:
    """Connect Facebook Messenger. Default: opens a VISIBLE Chromium window of Hunt's own profile so the
    hunter logs in themselves (and types the Messenger end-to-end PIN if asked); it closes by itself
    once the c_user session cookie appears, then everything runs headless. Never type passwords or PINs
    for the hunter. Alternative: cookies_file = JSON exported from a logged-in browser (Cookie-Editor)."""
    return await _headed_login("messenger", account, cookies_file)


@mcp.tool()
async def fb_login_status(account: str = "main", wait_s: int = 0) -> dict:
    """Has the hunter finished logging in to Facebook in the window? wait_s (0-120) waits for it."""
    return await _headed_login_status("messenger", account, wait_s)


@mcp.tool()
async def ig_login(account: str = "main", cookies_file: str | None = None) -> dict:
    """Connect Instagram DMs. Opens a VISIBLE Chromium window of Hunt's own profile at the Instagram login
    page; the hunter logs in themselves (use the hunting account, not the personal one). Closes by
    itself once the sessionid cookie appears. Alternative: cookies_file (Cookie-Editor JSON export)."""
    return await _headed_login("instagram", account, cookies_file)


@mcp.tool()
async def ig_login_status(account: str = "main", wait_s: int = 0) -> dict:
    """Has the hunter finished logging in to Instagram in the window? wait_s (0-120) waits for it."""
    return await _headed_login_status("instagram", account, wait_s)


# ---------------------------------------------------------------- Messenger tools

@mcp.tool()
async def fb_status(account: str = "main") -> dict:
    """Facebook Messenger: logged in? user id; flags a pending e2ee PIN prompt or security checkpoint."""
    acct = check_account(account)
    res = await run("messenger", acct, lambda s, p: MSGR.status(p, s))
    res["pacing"] = Pacer("messenger", acct).summary()
    return res


@mcp.tool()
async def fb_inbox(account: str = "main", limit: int = 30, all_chats: bool = False) -> dict:
    """Messenger threads with unread messages (thread_id, name, preview). Marketplace threads are included.
    all_chats=true lists the latest threads regardless of unread state (unread detection is heuristic)."""
    return await run("messenger", account, lambda s, p: MSGR.inbox(p, _limit(limit, 1, 200), all_chats))


@mcp.tool()
async def fb_history(account: str = "main", peer: str = "", limit: int = 200, expect_display: str | None = None) -> dict:
    """Messenger thread, oldest first. peer = thread id, facebook.com/messages/t/<id> (or /e2ee/t/) URL or
    m.me/<name>. Always opened on www.facebook.com. Messages: dir in/out (from bubble position), text,
    image/video/link descriptors, failed flag. Language: use dir='in' messages only."""
    if not peer:
        raise ToolError("peer is required (thread id or URL)")
    return await run("messenger", account, lambda s, p: MSGR.history(p, peer, _limit(limit), expect_display))


@mcp.tool()
async def fb_media(account: str = "main", peer: str = "", out_dir: str | None = None, limit: int = 20,
                   expect_display: str | None = None) -> dict:
    """Save photos from a Messenger thread (opens each in the viewer for the large version; newest first)."""
    if not peer:
        raise ToolError("peer is required")
    acct = check_account(account)
    out = media_dir("messenger", acct, fb_thread_id(peer)[0] or peer, out_dir)
    return await run("messenger", acct, lambda s, p: MSGR.media(p, peer, out, _limit(limit, 1, 200), expect_display, s))


@mcp.tool()
async def fb_send(account: str = "main", peer: str = "", text: str = "", expect_display: str | None = None,
                  allow_repeat: bool = False) -> dict:
    """Send one Messenger message in an existing thread (peer = thread id / URL). Checks the browser really
    is on that thread (and that the header shows expect_display when given), types, presses Enter and
    verifies the message appeared. Status as in wa_send: sent | unknown (read fb_history before anything
    else, never resend blindly) | not_sent | wrong_chat | no_chat | already_sent | failed_visible | paced.
    If Messenger asks for the e2ee PIN you get 'login needed': the hunter types it via fb_login."""
    if not peer:
        raise ToolError("peer is required (thread id or URL)")
    text = _text_arg(text)
    acct = check_account(account)
    pacer = Pacer("messenger", acct)
    return await run("messenger", acct, send_fn(lambda s, p: MSGR.send(p, peer, text, expect_display, pacer, allow_repeat)))


@mcp.tool()
async def fb_resolve(account: str = "main", query: str = "") -> dict:
    """Find Messenger threads: a thread id/URL → its header name; a name → matching recent threads."""
    if not query:
        raise ToolError("query is required")

    async def go(s: Session, page: Page):
        tid, _ = fb_thread_id(query)
        if tid and (re.search(r"/t/|m\.me/", query) or tid.isdigit()):
            chk = await MSGR.open_thread(page, query, None)
            return {"query": query, "thread_id": tid, "opened": chk.get("ok"), "header": chk.get("title"), "url": chk.get("url")}
        inbox = await MSGR.inbox(page, 200, True)
        return {"query": query, "matches": [t for t in inbox["chats"] if display_matches(t["name"], query)][:20]}

    return await run("messenger", account, go)


# ---------------------------------------------------------------- Instagram tools

@mcp.tool()
async def ig_status(account: str = "main") -> dict:
    """Instagram: logged in? username, user id, plus pacing counters."""
    acct = check_account(account)
    res = await run("instagram", acct, lambda s, p: INSTA.status(p, s))
    res["pacing"] = Pacer("instagram", acct).summary()
    return res


@mcp.tool()
async def ig_inbox(account: str = "main", limit: int = 30, all_chats: bool = False, requests: bool = True) -> dict:
    """Instagram DM threads that are unread, plus message requests (request=true). Each: thread_id, users,
    last message. all_chats=true lists the latest threads."""
    return await run("instagram", account, lambda s, p: INSTA.inbox(p, s, _limit(limit, 1, 100), all_chats, requests))


@mcp.tool()
async def ig_history(account: str = "main", peer: str = "", limit: int = 200, expect_display: str | None = None) -> dict:
    """Instagram DM thread, oldest first. peer = thread id, instagram.com/direct/t/<id> URL or @username.
    Messages: dir, time, text, media (image_url full size, video, shared post/reel with caption, link,
    voice). Language: use dir='in' only."""
    if not peer:
        raise ToolError("peer is required (thread id, URL or username)")
    return await run("instagram", account, lambda s, p: INSTA.history(p, s, peer, _limit(limit), expect_display))


@mcp.tool()
async def ig_media(account: str = "main", peer: str = "", out_dir: str | None = None, limit: int = 20,
                   expect_display: str | None = None) -> dict:
    """Save full-size photos (and covers of shared posts/videos) from an Instagram DM thread."""
    if not peer:
        raise ToolError("peer is required")
    acct = check_account(account)
    out = media_dir("instagram", acct, peer.lstrip("@"), out_dir)
    return await run("instagram", acct, lambda s, p: INSTA.media(p, s, peer, out, _limit(limit, 1, 200), expect_display))


@mcp.tool()
async def ig_send(account: str = "main", peer: str = "", text: str = "", expect_display: str | None = None,
                  allow_repeat: bool = False) -> dict:
    """Send one Instagram DM. peer = thread id/URL or @username (a new conversation is opened from the
    profile's Message button if none exists). Checks participants (username / expect_display), types,
    presses Enter and verifies through Instagram's own thread data. Non-followers get one message until
    they accept. Status: sent | unknown (read ig_history first, never resend blindly) | not_sent |
    wrong_chat | no_chat | already_sent | paced."""
    if not peer:
        raise ToolError("peer is required")
    text = _text_arg(text)
    acct = check_account(account)
    pacer = Pacer("instagram", acct)
    return await run("instagram", acct, send_fn(lambda s, p: INSTA.send(p, s, peer, text, expect_display, pacer, allow_repeat)))


@mcp.tool()
async def ig_resolve(account: str = "main", query: str = "") -> dict:
    """Find an Instagram user/thread: @username → user id + existing thread id; free text → DM search."""
    if not query:
        raise ToolError("query is required")
    return await run("instagram", account, lambda s, p: INSTA.resolve(p, s, query))


# ---------------------------------------------------------------- debugging / housekeeping

@mcp.tool()
async def browser_screenshot(channel: str, account: str = "main", full_page: bool = False) -> dict:
    """Screenshot of what the headless browser of channel/account shows now (debugging). Saved under
    ~/.config/hunt/browser/screens/ (mode 600; may contain private chats — delete when done)."""
    if channel not in CHANNELS:
        raise ToolError(f"channel must be one of {', '.join(CHANNELS)}")
    acct = check_account(account)

    async def go(s: Session, page: Page):
        path = browser_dir() / "screens" / f"{channel}-{acct}-{datetime.now():%Y%m%d-%H%M%S}.png"
        _write_private(path, await page.screenshot(full_page=full_page))
        return {"path": str(path), "url": page.url, "title": await page.title()}

    return await run(channel, acct, go)


@mcp.tool()
async def browser_sessions() -> dict:
    """Running browser sessions in this server and the profiles on disk, plus the Chromium in use."""
    running = [{"channel": c, "account": a, "headed": s.headed, "alive": s.alive(),
                "url": s._page.url if s._page and not s._page.is_closed() else None, "login": s.login or None}
               for (c, a), s in SESSIONS.items()]
    d = browser_dir()
    profiles = sorted(p.name for p in d.iterdir() if p.is_dir() and any(p.name.startswith(c + "-") for c in CHANNELS))
    found = find_chromium()
    return {"running": running, "profiles": profiles, "chromium": found,
            "chromium_ok": bool(found["full"] or found["shell"]),
            "chromium_help": None if (found["full"] or found["shell"]) else chromium_missing_message(found["root"])}


@mcp.tool()
async def browser_close(channel: str, account: str = "main") -> dict:
    """Close the background browser of channel/account (frees memory). The login stays in the profile;
    the next call starts it again. WhatsApp unlinks devices unused for ~30 days, so open it now and then."""
    if channel not in CHANNELS:
        raise ToolError(f"channel must be one of {', '.join(CHANNELS)}")
    sess = session(channel, account)
    async with sess.lock:
        await sess.close()
    return {"closed": True, "channel": channel, "account": sess.account}


if __name__ == "__main__":
    mcp.run()
