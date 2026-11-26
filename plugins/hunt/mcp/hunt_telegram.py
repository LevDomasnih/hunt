#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "mcp>=1.12,<3",
#   "telethon>=1.36,<2",
#   "keyring>=24",
#   "qrcode>=7.4",
#   "pypng>=0.20220715",
# ]
# ///
"""Hunt Telegram MCP server (Telethon, user account).

One TelegramClient per account label lives inside this process, so tools never open the same
SQLite session twice ("database is locked"). A lock file also stops a second Hunt process from
opening the same account.

Files:    ~/.config/hunt/telegram/<label>.session (mode 600), <label>.lock, state.json
Secrets:  api_id/api_hash in the OS keychain (keyring service "hunt-telegram", username = label,
          falling back to "default"). Passwords are never stored or passed through the agent:
          2FA is typed by the user into a one-time page served on 127.0.0.1.
Settings: "telegram" section of ~/.config/hunt/config.json (see tg_settings).
"""
from __future__ import annotations

import asyncio
import contextlib
import functools
import html
import io
import json
import logging
import os
import platform
import re
import secrets
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import keyring
from telethon import TelegramClient, errors, utils
from telethon.tl import functions, types

try:  # mcp 1.x
    from mcp.server.fastmcp import FastMCP
    from mcp.server.fastmcp.exceptions import ToolError
except ImportError:  # mcp 2.x renamed FastMCP to MCPServer
    from mcp.server.mcpserver import MCPServer as FastMCP
    from mcp.server.mcpserver.exceptions import ToolError

try:
    import fcntl
except ImportError:  # Windows
    fcntl = None  # type: ignore[assignment]

KEYRING_SERVICE = "hunt-telegram"
logging.getLogger("telethon").setLevel(logging.WARNING)
SERVICE_USER_IDS = {777000, 42777}  # Telegram service notifications (login codes): never read or write
DEFAULT_SETTINGS: dict[str, Any] = {
    "min_send_interval_s": 20,       # between any two sends from one account
    "new_chat_interval_s": 120,      # between two first messages to new people
    "max_new_chats_per_day": 20,     # rolling 24 h
    "quiet_hours": None,             # {"start": "21:00", "end": "08:00", "tz": "Asia/Makassar"}
    "folder_auto": False,            # add every new chat opened by tg_send to the folder
    "folder_title": "Hunt",
    "read_scope": "non_contacts",    # tg_inbox: "non_contacts" | "folder" (personal account mode)
    "duplicate_window_h": 6,         # refuse to resend the same text to the same chat within this window
    "media_max_mb": 50,              # tg_media skips bigger files
}
MAX_AUTO_WAIT_S = 90

mcp = FastMCP(
    "hunt-telegram",
    instructions=(
        "Telegram user-account tools for Hunt. Read the whole thread (tg_history) before writing. "
        "Only send texts the owner approved (Hunt drafts). On a STOP message (FLOOD_WAIT, PEER_FLOOD, frozen) "
        "stop all outreach on that account and tell the user."
    ),
)


# ---------------------------------------------------------------- files & settings

def config_dir() -> Path:
    return Path(os.environ.get("HUNT_CONFIG_DIR") or (Path.home() / ".config" / "hunt")).expanduser()


def tg_dir() -> Path:
    d = config_dir() / "telegram"
    d.mkdir(parents=True, exist_ok=True)
    with contextlib.suppress(OSError):
        os.chmod(config_dir(), 0o700)
        os.chmod(d, 0o700)
    return d


def _read_json(p: Path) -> dict:
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text(encoding="utf-8") or "{}")
    except json.JSONDecodeError as e:
        raise ToolError(f"{p} is not valid JSON ({e}).")


@contextlib.contextmanager
def _flock(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    if fcntl is None:
        yield
        return
    with open(path, "a+") as lf:
        fcntl.flock(lf, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lf, fcntl.LOCK_UN)


def _write_json(p: Path, data: dict) -> None:
    fd, tmp = tempfile.mkstemp(dir=p.parent, prefix=f".{p.stem}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.chmod(tmp, 0o600)
        os.replace(tmp, p)
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(tmp)
        raise


def update_json(p: Path, lock: Path, mutate) -> dict:
    with _flock(lock):
        data = _read_json(p)
        mutate(data)
        _write_json(p, data)
        return data


def settings_for(label: str, cfg: dict | None = None) -> dict:
    cfg = cfg if cfg is not None else _read_json(config_dir() / "config.json")
    tg = cfg.get("telegram") or {}
    out = dict(DEFAULT_SETTINGS)
    out.update({k: v for k, v in tg.items() if k in DEFAULT_SETTINGS})
    out.update({k: v for k, v in ((tg.get("accounts") or {}).get(label) or {}).items() if k in DEFAULT_SETTINGS})
    return out


def state_path() -> Path:
    return tg_dir() / "state.json"


def load_state(label: str) -> dict:
    return (_read_json(state_path()).get(label)) or {}


def update_state(label: str, mutate) -> dict:
    def m(all_: dict) -> None:
        st = all_.setdefault(label, {})
        mutate(st)
    return update_json(state_path(), tg_dir() / ".state.lock", m).get(label, {})


def _label(account: str) -> str:
    a = (account or "hunt").strip().lower()
    if not re.match(r"^[a-z0-9_-]{1,32}$", a):
        raise ToolError("account label must be 1-32 chars of a-z, 0-9, _ or - (e.g. 'hunt', 'personal').")
    return a


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def parse_since(s: str | None) -> datetime | None:
    """ISO date/datetime → aware UTC datetime. Naive values are UTC. Also '24h', '3d', '90m'."""
    if not s:
        return None
    s = s.strip()
    m = re.fullmatch(r"(\d+)\s*([mhd])", s)
    if m:
        n, u = int(m.group(1)), m.group(2)
        unit = {"m": "minutes", "h": "hours", "d": "days"}[u]
        return _now() - timedelta(**{unit: n})
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        raise ToolError(f"Bad since {s!r}: use ISO like 2026-11-18T09:00:00+08:00, 2026-11-18, or 24h / 3d.")
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


# ---------------------------------------------------------------- keychain

def api_creds(label: str) -> tuple[int, str]:
    for user in (label, "default"):
        try:
            raw = keyring.get_password(KEYRING_SERVICE, user)
        except Exception as e:
            raise ToolError(f"Cannot read the OS keychain ({type(e).__name__}: {e}).")
        if raw:
            try:
                d = json.loads(raw)
                return int(d["api_id"]), str(d["api_hash"])
            except (ValueError, KeyError, TypeError):
                raise ToolError(f"Keychain entry hunt-telegram/{user} is damaged; call tg_setup_api again.")
    raise ToolError(
        "No Telegram API credentials. The user creates them at https://my.telegram.org → API development tools "
        "(app title e.g. 'Hunt'), then call tg_setup_api(api_id, api_hash, account)."
    )


# ---------------------------------------------------------------- clients

class Account:
    def __init__(self, label: str, client: TelegramClient, lockfile):
        self.label = label
        self.client = client
        self.lockfile = lockfile
        self.send_lock = asyncio.Lock()
        self.me: Any = None
        self.login: dict[str, Any] = {}


_accounts: dict[str, Account] = {}
_create_lock: asyncio.Lock | None = None


def session_path(label: str) -> Path:
    return tg_dir() / f"{label}.session"


def _secure_session(label: str) -> None:
    for suffix in ("", "-journal", "-wal", "-shm"):
        p = Path(str(session_path(label)) + suffix)
        if p.exists():
            with contextlib.suppress(OSError):
                os.chmod(p, 0o600)


def _take_process_lock(label: str):
    path = tg_dir() / f"{label}.lock"
    f = open(path, "a+")
    if fcntl is not None:
        try:
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            f.seek(0)
            other = f.read().strip()
            f.close()
            raise ToolError(
                f"Telegram account '{label}' is already open in another Hunt process"
                f"{' (pid ' + other + ')' if other else ''}, probably another Claude Code session. "
                "Use one session at a time, or close the other one."
            )
    f.seek(0)
    f.truncate()
    f.write(str(os.getpid()))
    f.flush()
    return f


async def get_account(account: str) -> Account:
    global _create_lock
    label = _label(account)
    if _create_lock is None:
        _create_lock = asyncio.Lock()
    async with _create_lock:
        acc = _accounts.get(label)
        if acc is None:
            api_id, api_hash = api_creds(label)
            lockfile = _take_process_lock(label)
            sp = session_path(label)
            if not sp.exists():
                os.close(os.open(sp, os.O_CREAT | os.O_WRONLY, 0o600))  # sqlite accepts an empty file
            client = TelegramClient(
                str(sp), api_id, api_hash,
                device_model="Hunt (Claude Code)",
                system_version=f"{platform.system()} {platform.release()}",
                app_version="hunt 0.1",
                flood_sleep_threshold=15,
            )
            acc = Account(label, client, lockfile)
            _accounts[label] = acc
        if not acc.client.is_connected():
            try:
                await acc.client.connect()
            except (OSError, ConnectionError) as e:
                raise ToolError(f"Cannot reach Telegram ({type(e).__name__}: {e}). Check the network/VPN.")
        _secure_session(label)
        return acc


async def authed(account: str) -> Account:
    acc = await get_account(account)
    if not await acc.client.is_user_authorized():
        raise ToolError(f"Telegram account '{acc.label}' is not logged in. Call tg_login_qr(account='{acc.label}').")
    if acc.me is None:
        acc.me = await acc.client.get_me()
    return acc


# ---------------------------------------------------------------- errors

def _stop(msg: str) -> ToolError:
    return ToolError("STOP: " + msg)


def tg_errors(fn):
    """Turn Telethon/network exceptions into short readable ToolErrors."""
    @functools.wraps(fn)
    async def wrapper(*a, **kw):
        try:
            return await fn(*a, **kw)
        except ToolError:
            raise
        except errors.FloodWaitError as e:
            raise _stop(f"Telegram rate limit (FLOOD_WAIT {e.seconds}s). Do not retry before "
                        f"{_iso(_now() + timedelta(seconds=e.seconds))}.")
        except errors.FrozenMethodInvalidError:
            raise _stop("this Telegram account is frozen (can only message @SpamBot). Stop all outreach and tell the user.")
        except (errors.AuthKeyUnregisteredError, errors.SessionRevokedError, errors.UserDeactivatedBanError,
                errors.AuthKeyDuplicatedError) as e:
            raise ToolError(f"The Telegram session is no longer valid ({type(e).__name__}): it was logged out, "
                            "revoked or the account is banned. Log in again with tg_login_qr.")
        except errors.RPCError as e:
            raise ToolError(f"Telegram error {type(e).__name__}: {getattr(e, 'message', e)}")
        except (ConnectionError, OSError, asyncio.TimeoutError) as e:
            raise ToolError(f"Network problem talking to Telegram ({type(e).__name__}: {e}). Retry later.")
    return wrapper


# ---------------------------------------------------------------- entities & messages

def _mask_phone(p: str | None) -> str | None:
    if not p:
        return None
    p = p if p.startswith("+") else "+" + p
    return p[:4] + "*" * max(len(p) - 7, 0) + p[-3:]


def summarize(e: Any, mask_phone: bool = False) -> dict:
    if isinstance(e, types.User):
        name = " ".join(x for x in (e.first_name, e.last_name) if x) or None
        usernames = [u.username for u in (getattr(e, "usernames", None) or []) if getattr(u, "active", True)]
        uname = e.username or (usernames[0] if usernames else None)
        return {
            "id": e.id, "type": "bot" if e.bot else "user", "name": name, "username": uname,
            "phone": (_mask_phone(e.phone) if mask_phone else ("+" + e.phone if e.phone else None)),
            "is_contact": bool(e.contact), "mutual_contact": bool(e.mutual_contact),
            "verified": bool(e.verified), "scam": bool(e.scam), "fake": bool(e.fake), "premium": bool(e.premium),
            "deleted": bool(e.deleted), "lang_code": getattr(e, "lang_code", None),
            "peer": f"@{uname}" if uname else str(e.id),
        }
    if isinstance(e, (types.Chat, types.ChatForbidden)):
        return {"id": utils.get_peer_id(e), "type": "group", "title": getattr(e, "title", None),
                "peer": str(utils.get_peer_id(e))}
    if isinstance(e, (types.Channel, types.ChannelForbidden)):
        uname = getattr(e, "username", None)
        return {"id": utils.get_peer_id(e), "type": "supergroup" if getattr(e, "megagroup", False) else "channel",
                "title": getattr(e, "title", None), "username": uname, "scam": bool(getattr(e, "scam", False)),
                "fake": bool(getattr(e, "fake", False)), "peer": f"@{uname}" if uname else str(utils.get_peer_id(e))}
    return {"repr": type(e).__name__}


def parse_peer(peer: str | int) -> tuple[str, Any]:
    """→ ('id', int) | ('phone', '+digits') | ('username', 'name')."""
    if isinstance(peer, int):
        return "id", peer
    s = str(peer).strip()
    m = re.match(r"^(?:https?://)?(?:t\.me|telegram\.me)/(?:\+)?([A-Za-z0-9_]{3,})/?$", s)
    if m:
        return "username", m.group(1)
    if re.fullmatch(r"-?\d{5,}", s):
        return "id", int(s)
    digits = re.sub(r"[\s().-]", "", s)
    if re.fullmatch(r"\+\d{7,15}", digits):
        return "phone", digits
    s = s.lstrip("@")
    if re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{3,31}", s):
        return "username", s
    raise ToolError(f"Cannot understand peer {peer!r}: use @username, t.me/username, +phone or a numeric id.")


async def resolve_entity(c: TelegramClient, peer: str | int) -> Any:
    kind, val = parse_peer(peer)
    if kind == "id" and abs(val) in SERVICE_USER_IDS:
        raise ToolError("Hunt does not read or write Telegram service chats.")
    try:
        if kind == "phone":
            try:
                return await c.get_entity(val)
            except (ValueError, TypeError):
                r = await c(functions.contacts.ResolvePhoneRequest(phone=val.lstrip("+")))
                if r.users:
                    return r.users[0]
                raise ToolError(f"No Telegram account found for {val}.")
        if kind == "id":
            try:
                return await c.get_entity(val)
            except ValueError:
                async for _ in c.iter_dialogs(limit=300):  # fills the entity cache
                    pass
                try:
                    return await c.get_entity(val)
                except ValueError:
                    raise ToolError(f"Unknown id {val}: Telegram only resolves ids we have talked to. Use @username or +phone.")
        return await c.get_entity(val)
    except errors.PhoneNotOccupiedError:
        raise ToolError(f"No Telegram account for {val} (or its owner hides the number from strangers).")
    except (errors.UsernameNotOccupiedError, errors.UsernameInvalidError):
        raise ToolError(f"No Telegram user @{val}.")
    except ValueError as ex:
        raise ToolError(f"Cannot find {peer!r} on Telegram ({ex}).")


def _media_kind(m: Any) -> str | None:
    if m.media is None or isinstance(m.media, types.MessageMediaEmpty):
        return None
    if m.photo:
        return "photo"
    if getattr(m, "video_note", None):
        return "video_note"
    if getattr(m, "gif", None):
        return "gif"
    if m.video:
        return "video"
    if m.voice:
        return "voice"
    if m.audio:
        return "audio"
    if m.sticker:
        return "sticker"
    if m.document:
        return "document"
    if isinstance(m.media, (types.MessageMediaGeo, types.MessageMediaVenue, types.MessageMediaGeoLive)):
        return "location"
    if isinstance(m.media, types.MessageMediaContact):
        return "contact"
    if isinstance(m.media, types.MessageMediaWebPage):
        return "webpage"
    if isinstance(m.media, types.MessageMediaPoll):
        return "poll"
    return "other"


def media_info(m: Any) -> dict | None:
    kind = _media_kind(m)
    if not kind:
        return None
    d: dict[str, Any] = {"type": kind}
    f = getattr(m, "file", None)
    if kind in ("photo", "video", "video_note", "gif", "voice", "audio", "sticker", "document") and f is not None:
        for k in ("name", "mime_type", "size", "duration", "width", "height"):
            v = getattr(f, k, None)
            if v:
                d["filename" if k == "name" else k] = v
    if kind == "location":
        g = getattr(m.media, "geo", None)
        if g is not None and hasattr(g, "lat"):
            d.update(lat=g.lat, lng=g.long, map_url=f"https://www.google.com/maps/search/?api=1&query={g.lat},{g.long}")
        if isinstance(m.media, types.MessageMediaVenue):
            d.update(title=m.media.title, address=m.media.address)
        if isinstance(m.media, types.MessageMediaGeoLive):
            d["live"] = True
    elif kind == "contact":
        mc = m.media
        d.update(name=" ".join(x for x in (mc.first_name, mc.last_name) if x) or None,
                 phone=("+" + mc.phone_number.lstrip("+")) if mc.phone_number else None, user_id=mc.user_id or None)
    elif kind == "webpage":
        wp = getattr(m.media, "webpage", None)
        d.update(url=getattr(wp, "url", None), title=getattr(wp, "title", None), site=getattr(wp, "site_name", None))
    elif kind == "poll":
        d["question"] = str(getattr(getattr(m.media.poll, "question", None), "text", m.media.poll.question))
    return d


def describe(m: Any, me_id: int | None, peer_id: int) -> dict:
    d: dict[str, Any] = {
        "id": m.id,
        "date": _iso(m.date),
        "direction": "out" if m.out else "in",
        "text": m.message or "",
        "external_id": f"tg:{me_id}:{peer_id}:{m.id}",
    }
    rt = getattr(m, "reply_to", None)
    if rt is not None and getattr(rt, "reply_to_msg_id", None):
        d["reply_to"] = rt.reply_to_msg_id
    if getattr(m, "fwd_from", None) is not None:
        d["forwarded"] = True
    if getattr(m, "edit_date", None):
        d["edited"] = _iso(m.edit_date)
    if getattr(m, "grouped_id", None):
        d["album"] = str(m.grouped_id)
    if isinstance(m, types.MessageService) or getattr(m, "action", None) is not None:
        d["service"] = type(m.action).__name__ if getattr(m, "action", None) else "service"
    mi = media_info(m)
    if mi:
        d["media"] = [mi]
        d["caption"] = m.message or ""
    return d


# ---------------------------------------------------------------- pacing (pure, unit-tested)

def _hm(s: str) -> tuple[int, int]:
    m = re.fullmatch(r"(\d{1,2}):(\d{2})", str(s).strip())
    if not m or int(m.group(1)) > 23 or int(m.group(2)) > 59:
        raise ToolError(f"Bad time {s!r}: use HH:MM.")
    return int(m.group(1)), int(m.group(2))


def in_quiet_hours(quiet: dict | None, now: datetime) -> tuple[bool, str | None]:
    if not quiet or not quiet.get("start") or not quiet.get("end"):
        return False, None
    try:
        tz = ZoneInfo(quiet.get("tz")) if quiet.get("tz") else None
    except (ZoneInfoNotFoundError, ValueError):
        raise ToolError(f"quiet_hours.tz {quiet.get('tz')!r} is not a valid IANA timezone.")
    local = now.astimezone(tz) if tz else now.astimezone()
    cur = local.hour * 60 + local.minute
    sh, sm = _hm(quiet["start"])
    eh, em = _hm(quiet["end"])
    s, e = sh * 60 + sm, eh * 60 + em
    inside = (s <= cur < e) if s < e else (cur >= s or cur < e)
    return inside, local.strftime("%H:%M %Z")


def pacing_check(state: dict, settings: dict, now: datetime, new_chat: bool) -> dict:
    """Decide whether a send may go now. Returns {ok, wait_s, reason}; wait_s>0 with ok=True means
    'sleep this long, then send'."""
    ts = now.timestamp()
    cd = state.get("cooldown_until") or 0
    if cd > ts:
        return {"ok": False, "reason": f"STOP: cooling down after {state.get('cooldown_reason', 'a Telegram limit')} "
                                        f"until {_iso(datetime.fromtimestamp(cd, timezone.utc))}. Do not send from this account until then."}
    if new_chat:
        ncd = state.get("new_chat_cooldown_until") or 0
        if ncd > ts:
            return {"ok": False, "reason": f"STOP: new chats are paused after {state.get('new_chat_cooldown_reason', 'PEER_FLOOD')} "
                                            f"until {_iso(datetime.fromtimestamp(ncd, timezone.utc))}. Existing chats still work."}
    quiet, local = in_quiet_hours(settings.get("quiet_hours"), now)
    if quiet:
        q = settings["quiet_hours"]
        return {"ok": False, "reason": f"Quiet hours ({q['start']}–{q['end']} {q.get('tz') or 'local'}, now {local}). "
                                        "Queue it and send after the quiet window."}
    if new_chat:
        recent = [x for x in state.get("new_chats", []) if x.get("ts", 0) > ts - 86400]
        cap = int(settings.get("max_new_chats_per_day") or 0)
        if cap and len(recent) >= cap:
            oldest = min(x["ts"] for x in recent)
            return {"ok": False, "reason": f"Daily limit of {cap} new chats reached (rolling 24 h). Next slot at "
                                            f"{_iso(datetime.fromtimestamp(oldest + 86400, timezone.utc))}. Continue live conversations instead."}
        gap = float(settings.get("new_chat_interval_s") or 0)
        last_new = max((x["ts"] for x in recent), default=0)
        if gap and ts - last_new < gap:
            return {"ok": False, "retry_after_s": int(gap - (ts - last_new)) + 1,
                    "reason": f"Too soon after the previous new chat (min {int(gap)} s between first messages). "
                              f"Retry in {int(gap - (ts - last_new)) + 1} s."}
    wait = float(settings.get("min_send_interval_s") or 0) - (ts - float(state.get("last_send_ts") or 0))
    if wait > MAX_AUTO_WAIT_S:
        return {"ok": False, "retry_after_s": int(wait) + 1, "reason": f"Too soon after the previous send; retry in {int(wait) + 1} s."}
    return {"ok": True, "wait_s": max(0.0, wait)}


# ---------------------------------------------------------------- folders (pure helpers unit-tested)

def _title_text(f: Any) -> str:
    t = getattr(f, "title", "")
    return getattr(t, "text", t) or ""


def make_title(title: str) -> Any:
    if hasattr(types, "TextWithEntities"):
        return types.TextWithEntities(text=title, entities=[])
    return title


def _pkey(ip: Any) -> str:
    if isinstance(ip, types.InputPeerSelf):
        return "self"
    try:
        return str(utils.get_peer_id(ip))
    except (TypeError, ValueError):
        return repr(ip)


def folder_limit(premium: bool) -> int:
    return 200 if premium else 100


def add_peer_to_filter(f: Any, ip: Any, premium: bool) -> str:
    """Append ip to f.include_peers. Returns 'added' | 'already'. Drops a lone self placeholder."""
    keys = {_pkey(p) for p in list(f.include_peers) + list(f.pinned_peers)}
    if _pkey(ip) in keys:
        return "already"
    inc = [p for p in f.include_peers if not isinstance(p, types.InputPeerSelf)]
    if len(inc) + len(f.pinned_peers) + 1 > folder_limit(premium):
        raise ToolError(
            f"Folder '{_title_text(f)}' is full ({folder_limit(premium)} chats max{'' if premium else ' without Premium'}). "
            "Remove dead leads with tg_folder_remove first."
        )
    f.include_peers = inc + [ip]
    return "added"


def remove_peer_from_filter(f: Any, ip: Any) -> str:
    k = _pkey(ip)
    before = len(f.include_peers) + len(f.pinned_peers)
    f.include_peers = [p for p in f.include_peers if _pkey(p) != k]
    f.pinned_peers = [p for p in f.pinned_peers if _pkey(p) != k]
    if len(f.include_peers) + len(f.pinned_peers) == before:
        return "absent"
    if not f.include_peers and not f.pinned_peers:
        f.include_peers = [types.InputPeerSelf()]  # a folder cannot be empty
    return "removed"


def free_filter_id(filters: list) -> int:
    used = {getattr(f, "id", None) for f in filters}
    i = 2  # 0 and 1 are reserved (All chats, Archive)
    while i in used:
        i += 1
    return i


async def _filters(c: TelegramClient) -> list:
    r = await c(functions.messages.GetDialogFiltersRequest())
    return list(getattr(r, "filters", r))


def _find_folder(filters: list, title: str) -> Any:
    for f in filters:
        if isinstance(f, types.DialogFilter) and _title_text(f).casefold() == title.casefold():
            return f
    return None


async def _ensure_folder(acc: Account, title: str, seed: list | None = None) -> tuple[Any, bool]:
    c = acc.client
    if not title or len(title) > 12:
        raise ToolError("Folder title must be 1-12 characters.")
    filters = await _filters(c)
    f = _find_folder(filters, title)
    if f is not None:
        return f, False
    premium = bool(getattr(acc.me, "premium", False))
    count = sum(1 for x in filters if isinstance(x, (types.DialogFilter, types.DialogFilterChatlist)))
    if count >= (30 if premium else 10):
        raise ToolError(f"This account already has {count} folders (limit {30 if premium else 10}). Delete one in Telegram first.")
    fid = free_filter_id(filters)
    f = types.DialogFilter(id=fid, title=make_title(title), pinned_peers=[],
                           include_peers=list(seed) if seed else [types.InputPeerSelf()], exclude_peers=[])
    await c(functions.messages.UpdateDialogFilterRequest(id=fid, filter=f))
    return f, True


async def folder_add(acc: Account, entity: Any, title: str) -> dict:
    ip = await acc.client.get_input_entity(entity)
    f, created = await _ensure_folder(acc, title, seed=[ip])
    if created:
        return {"folder": title, "folder_id": f.id, "result": "added", "created": True}
    res = add_peer_to_filter(f, ip, bool(getattr(acc.me, "premium", False)))
    if res == "added":
        await acc.client(functions.messages.UpdateDialogFilterRequest(id=f.id, filter=f))
    return {"folder": title, "folder_id": f.id, "result": res, "chats": len(f.include_peers) + len(f.pinned_peers)}


# ---------------------------------------------------------------- QR rendering

def render_qr(url: str, base: Path) -> dict:
    try:
        import qrcode
    except ImportError:
        return {"qr_note": "qrcode package missing; open the url on the phone instead"}
    q = qrcode.QRCode(border=2)
    q.add_data(url)
    q.make(fit=True)
    buf = io.StringIO()
    q.print_ascii(out=buf, invert=True)
    out: dict[str, Any] = {"qr_ascii": buf.getvalue()}
    try:
        from qrcode.image.pure import PyPNGImage
        png = base.with_suffix(".png")
        q.make_image(image_factory=PyPNGImage, box_size=8).save(str(png))
        os.chmod(png, 0o600)
        out["qr_png"] = str(png)
    except Exception:  # pypng missing: SVG needs nothing extra
        import qrcode.image.svg
        svg = base.with_suffix(".svg")
        q.make_image(image_factory=qrcode.image.svg.SvgImage).save(str(svg))
        out["qr_svg"] = str(svg)
    return out


# ---------------------------------------------------------------- 2FA page on 127.0.0.1

_PAGE = """<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Hunt · Telegram password</title>
<style>body{{font:16px system-ui;max-width:420px;margin:12vh auto;padding:0 16px;color:#222;background:#fafafa}}
input,button{{font:inherit;padding:10px;width:100%;box-sizing:border-box;margin-top:8px}}
.err{{color:#b00020}}.ok{{color:#0a7a2f}}small{{color:#666}}</style>
<h2>Telegram two-step password</h2>
<p>Account: <b>{label}</b>{hint}</p>{msg}
{form}
<p><small>This page runs only on your computer (127.0.0.1). The password goes straight to Telegram and is not saved
or shown to the agent.</small></p>"""
_FORM = """<form method="post"><input type="password" name="password" autocomplete="current-password" autofocus required
placeholder="Cloud password"><button>Log in</button></form>"""


async def _start_password_page(acc: Account) -> str:
    st = acc.login
    token = secrets.token_urlsafe(18)
    hint = ""
    with contextlib.suppress(Exception):
        pw = await acc.client(functions.account.GetPasswordRequest())
        if getattr(pw, "hint", None):
            hint = f" · hint: <i>{html.escape(pw.hint)}</i>"

    def page(msg: str = "", form: bool = True) -> bytes:
        return _PAGE.format(label=html.escape(acc.label), hint=hint, msg=msg, form=_FORM if form else "").encode()

    async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        status, body = "404 Not Found", b"not found"
        try:
            head = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 10)
            lines = head.decode("latin-1").split("\r\n")
            method, path, _ = (lines[0].split(" ") + ["", "", ""])[:3]
            hdrs = {k.strip().lower(): v.strip() for k, _, v in (ln.partition(":") for ln in lines[1:] if ln)}
            if path.split("?")[0] == f"/{token}":
                status = "200 OK"
                if st.get("state") == "done":
                    body = page('<p class="ok">Logged in. You can close this tab.</p>', form=False)
                elif method == "POST":
                    n = min(int(hdrs.get("content-length", "0") or 0), 4096)
                    raw = await asyncio.wait_for(reader.readexactly(n), 10) if n else b""
                    pw_ = (parse_qs(raw.decode("utf-8", "replace")).get("password") or [""])[0]
                    try:
                        user = await acc.client.sign_in(password=pw_)
                        acc.me = user
                        st.update(state="done", error=None)
                        body = page('<p class="ok">Logged in. You can close this tab and go back to Claude.</p>', form=False)
                    except errors.PasswordHashInvalidError:
                        body = page('<p class="err">Wrong password, try again.</p>')
                    except errors.FloodWaitError as e:
                        body = page(f'<p class="err">Too many attempts. Wait {e.seconds} s.</p>')
                    except Exception as e:  # noqa: BLE001
                        body = page(f'<p class="err">{html.escape(type(e).__name__)}</p>')
                    finally:
                        pw_ = ""  # drop the reference
                else:
                    body = page()
        except Exception:  # noqa: BLE001
            status, body = "400 Bad Request", b"bad request"
        writer.write(f"HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\n"
                     f"Referrer-Policy: no-referrer\r\nContent-Length: {len(body)}\r\nConnection: close\r\n\r\n".encode() + body)
        with contextlib.suppress(Exception):
            await writer.drain()
            writer.close()
        if st.get("state") == "done" and st.get("pw_server"):
            st["pw_server"].close()

    server = await asyncio.start_server(handle, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    st["pw_server"] = server

    async def expire() -> None:
        await asyncio.sleep(600)
        server.close()
        if st.get("state") == "password_needed":
            st.update(state="expired", error="The password page expired; start again with tg_login_qr.")
    st["pw_expire_task"] = asyncio.create_task(expire())
    return f"http://127.0.0.1:{port}/{token}"


# ---------------------------------------------------------------- tools: setup & login

@mcp.tool()
async def tg_setup_api(api_id: int, api_hash: str, account: str = "hunt") -> dict:
    """Store Telegram API credentials (from https://my.telegram.org → API development tools) in the OS
    keychain for an account label. The first stored pair also becomes the default for other labels.
    These identify the app, not the user; still never write them into files or chats."""
    label = _label(account)
    if not re.fullmatch(r"[0-9a-f]{32}", (api_hash or "").strip().lower()):
        raise ToolError("api_hash must be the 32-character hex string from my.telegram.org.")
    if int(api_id) <= 0:
        raise ToolError("api_id must be a positive number.")
    val = json.dumps({"api_id": int(api_id), "api_hash": api_hash.strip().lower()})
    try:
        keyring.set_password(KEYRING_SERVICE, label, val)
        default_set = False
        if not keyring.get_password(KEYRING_SERVICE, "default"):
            keyring.set_password(KEYRING_SERVICE, "default", val)
            default_set = True
    except Exception as e:
        raise ToolError(f"Cannot write to the OS keychain ({type(e).__name__}: {e}).")
    return {"ok": True, "account": label, "stored": f"keychain service '{KEYRING_SERVICE}'", "also_default": default_set,
            "next": f"tg_login_qr(account='{label}')"}


async def _qr_loop(acc: Account, qr: Any, deadline: float) -> None:
    st = acc.login
    try:
        while time.time() < deadline:
            try:
                left = (qr.expires - _now()).total_seconds()
                user = await qr.wait(timeout=max(3.0, min(left, deadline - time.time())))
                acc.me = user
                st.update(state="done", error=None)
                return
            except asyncio.TimeoutError:
                if time.time() >= deadline:
                    break
                await qr.recreate()
                st["url"] = qr.url
                st["expires"] = _iso(qr.expires)
                st.update(render_qr(qr.url, tg_dir() / f"{acc.label}-login"))
                st["generation"] = st.get("generation", 0) + 1
        st.update(state="expired", error="Nobody scanned the QR code in time. Call tg_login_qr again.")
    except errors.SessionPasswordNeededError:
        st["state"] = "password_needed"
        st["password_url"] = await _start_password_page(acc)
    except asyncio.CancelledError:
        raise
    except Exception as e:  # noqa: BLE001
        st.update(state="error", error=f"{type(e).__name__}: {e}")
    finally:
        _secure_session(acc.label)


def _login_view(acc: Account) -> dict:
    st = acc.login
    out: dict[str, Any] = {"account": acc.label, "state": st.get("state", "idle")}
    if st.get("state") == "waiting_scan":
        out.update({k: st[k] for k in ("url", "expires", "qr_png", "qr_svg", "qr_ascii") if k in st})
        out["instruction"] = ("On the phone logged into the account Hunt should use: Telegram → Settings → Devices → "
                              "Link Desktop Device, then scan the QR (show qr_ascii in a code block, or open qr_png). "
                              "The code refreshes about every 30 s; call tg_login_status to wait.")
    elif st.get("state") == "password_needed":
        out["password_url"] = st.get("password_url")
        out["instruction"] = ("This account has a two-step (cloud) password. Ask the user to open password_url in a browser "
                              "on this computer and type the password there. Do NOT ask for the password in the chat. "
                              "Then call tg_login_status.")
    elif st.get("state") == "done" and acc.me is not None:
        out["me"] = summarize(acc.me, mask_phone=True)
    if st.get("error"):
        out["error"] = st["error"]
    return out


@mcp.tool()
@tg_errors
async def tg_login_qr(account: str = "hunt") -> dict:
    """Start a QR login for an account label (default "hunt", the separate hunting account).
    Returns the tg://login url, an ASCII QR (qr_ascii) and a PNG path (qr_png). The user scans it from
    Telegram on their phone (Settings → Devices → Link Desktop Device). Then call tg_login_status.
    No phone number or SMS code is needed; passwords are never asked in the chat."""
    acc = await get_account(account)
    c = acc.client
    if await c.is_user_authorized():
        acc.me = await c.get_me()
        return {"account": acc.label, "state": "done", "already_logged_in": True, "me": summarize(acc.me, mask_phone=True)}
    old = acc.login.get("task")
    if old and not old.done():
        old.cancel()
    if acc.login.get("pw_server"):
        acc.login["pw_server"].close()
    qr = await c.qr_login()
    acc.login = {"state": "waiting_scan", "url": qr.url, "expires": _iso(qr.expires), "generation": 0}
    acc.login.update(render_qr(qr.url, tg_dir() / f"{acc.label}-login"))
    acc.login["task"] = asyncio.create_task(_qr_loop(acc, qr, time.time() + 300))
    return _login_view(acc)


@mcp.tool()
@tg_errors
async def tg_login_status(account: str = "hunt", wait_s: int = 25) -> dict:
    """Wait up to wait_s seconds for the QR login to progress and return its state:
    waiting_scan (with a fresh url/QR if it rotated), password_needed (with password_url: the user types
    the 2FA password on a local page, never in the chat), done (with `me`), expired or error."""
    acc = await get_account(account)
    st = acc.login
    if not st:
        if await acc.client.is_user_authorized():
            acc.me = acc.me or await acc.client.get_me()
            return {"account": acc.label, "state": "done", "me": summarize(acc.me, mask_phone=True)}
        return {"account": acc.label, "state": "idle", "next": "Call tg_login_qr first."}
    start_state, start_gen = st.get("state"), st.get("generation")
    end = time.time() + max(0, min(int(wait_s), 120))
    while time.time() < end and st.get("state") == start_state and st.get("generation") == start_gen:
        await asyncio.sleep(0.5)
    if st.get("state") == "done":
        _secure_session(acc.label)
        for k in ("qr_png", "qr_svg"):
            if st.get(k):
                with contextlib.suppress(OSError):
                    os.unlink(st[k])
    return _login_view(acc)


@mcp.tool()
@tg_errors
async def tg_status(account: str = "hunt") -> dict:
    """Who the account is logged in as (phone masked), Premium (affects folder limits), pacing state
    (sends, new chats in the last 24 h, cooldowns) and effective settings."""
    label = _label(account)
    out: dict[str, Any] = {"account": label, "session_file": str(session_path(label))}
    if not session_path(label).exists():
        out.update(logged_in=False, next=f"tg_setup_api then tg_login_qr(account='{label}')")
        return out
    acc = await get_account(label)
    ok = await acc.client.is_user_authorized()
    out["logged_in"] = ok
    if ok:
        acc.me = await acc.client.get_me()
        out["me"] = summarize(acc.me, mask_phone=True)
    st = load_state(label)
    ts = _now().timestamp()
    out["pacing"] = {
        "last_send": _iso(datetime.fromtimestamp(st["last_send_ts"], timezone.utc)) if st.get("last_send_ts") else None,
        "new_chats_24h": sum(1 for x in st.get("new_chats", []) if x.get("ts", 0) > ts - 86400),
        "cooldown_until": _iso(datetime.fromtimestamp(st["cooldown_until"], timezone.utc)) if (st.get("cooldown_until") or 0) > ts else None,
        "new_chat_cooldown_until": _iso(datetime.fromtimestamp(st["new_chat_cooldown_until"], timezone.utc)) if (st.get("new_chat_cooldown_until") or 0) > ts else None,
    }
    out["settings"] = settings_for(label)
    return out


@mcp.tool()
async def tg_settings(
    account: str | None = None,
    min_send_interval_s: int | None = None,
    new_chat_interval_s: int | None = None,
    max_new_chats_per_day: int | None = None,
    quiet_start: str | None = None,
    quiet_end: str | None = None,
    quiet_tz: str | None = None,
    quiet_off: bool = False,
    folder_auto: bool | None = None,
    folder_title: str | None = None,
    read_scope: str | None = None,
) -> dict:
    """Show or change Telegram pacing and folder settings (stored in ~/.config/hunt/config.json).
    With account=None changes apply to all accounts; with a label only to that account.
    Recommended: hunting account 20 new chats/day, 120 s between new chats; personal account (folder
    mode) max 10–15/day, 180–360 s, read_scope="folder", folder_auto=true. quiet_* in the destination
    timezone, e.g. 21:00 → 08:00 Asia/Makassar. Call with no changes to just read."""
    changes: dict[str, Any] = {}
    for k, v in (("min_send_interval_s", min_send_interval_s), ("new_chat_interval_s", new_chat_interval_s),
                 ("max_new_chats_per_day", max_new_chats_per_day), ("folder_auto", folder_auto),
                 ("folder_title", folder_title), ("read_scope", read_scope)):
        if v is not None:
            changes[k] = v
    if read_scope is not None and read_scope not in ("non_contacts", "folder"):
        raise ToolError("read_scope must be 'non_contacts' or 'folder'.")
    if folder_title is not None and not (1 <= len(folder_title) <= 12):
        raise ToolError("folder_title must be 1-12 characters.")
    if quiet_off:
        changes["quiet_hours"] = None
    elif quiet_start or quiet_end or quiet_tz:
        if not (quiet_start and quiet_end):
            raise ToolError("Give both quiet_start and quiet_end (HH:MM).")
        _hm(quiet_start), _hm(quiet_end)
        if quiet_tz:
            try:
                ZoneInfo(quiet_tz)
            except (ZoneInfoNotFoundError, ValueError):
                raise ToolError(f"Unknown timezone {quiet_tz!r}.")
        changes["quiet_hours"] = {"start": quiet_start, "end": quiet_end, "tz": quiet_tz}
    label = _label(account) if account else None
    if changes:
        def m(cfg: dict) -> None:
            tg = cfg.setdefault("telegram", {})
            tgt = tg.setdefault("accounts", {}).setdefault(label, {}) if label else tg
            tgt.update(changes)
        update_json(config_dir() / "config.json", config_dir() / ".config.lock", m)
    return {"account": label or "(all)", "changed": list(changes), "effective": settings_for(label or "hunt")}


# ---------------------------------------------------------------- tools: reading

async def _folder_peer_ids(acc: Account, title: str) -> set[int]:
    f = _find_folder(await _filters(acc.client), title)
    if f is None:
        return set()
    out = set()
    for p in list(f.include_peers) + list(f.pinned_peers):
        with contextlib.suppress(Exception):
            out.add(utils.get_peer_id(p))
    return out


@mcp.tool()
@tg_errors
async def tg_inbox(account: str = "hunt", since: str = "24h", include_contacts: bool = False,
                   limit_dialogs: int = 100, per_dialog: int = 50) -> dict:
    """Private chats with at least one INCOMING message since `since`, with all their messages since then
    (oldest first). Read-only: does not mark anything as read.

    Args:
        since: ISO datetime/date (naive = UTC) or relative like '24h', '3d'.
        include_contacts: also include people saved in the phone's contacts (friends/family are skipped by default).
        limit_dialogs: how many most recent dialogs to scan.
        per_dialog: max messages per chat (truncated=true if more).
    Each message: id, date, direction in|out, text (caption for media), media [{type, filename, mime_type,
    size, lat/lng for locations, ...}], external_id (pass to messages_log), reply_to, album.
    In read_scope="folder" mode only chats in the Hunt folder are returned. Service chats are never read.
    """
    acc = await authed(account)
    c = acc.client
    since_dt = parse_since(since) or (_now() - timedelta(days=1))
    sett = settings_for(acc.label)
    only: set[int] | None = None
    if sett.get("read_scope") == "folder":
        only = await _folder_peer_ids(acc, sett.get("folder_title") or "Hunt")
    chats = []
    scanned = 0
    async for d in c.iter_dialogs(limit=max(1, min(int(limit_dialogs), 500))):
        scanned += 1
        if not d.is_user:
            continue
        u = d.entity
        if u.bot or u.is_self or u.id in SERVICE_USER_IDS or getattr(u, "support", False):
            continue
        if not include_contacts and (u.contact or u.mutual_contact):
            continue
        if only is not None and u.id not in only:
            continue
        if d.date and d.date < since_dt:
            continue
        msgs = []
        truncated = False
        async for m in c.iter_messages(u, limit=max(1, min(int(per_dialog), 500)) + 1):
            if m.date < since_dt:
                break
            msgs.append(m)
        if len(msgs) > per_dialog:
            msgs, truncated = msgs[:per_dialog], True
        if not any(not m.out for m in msgs):
            continue
        msgs.reverse()
        chats.append({
            "peer": summarize(u), "unread": d.unread_count, "last_date": _iso(d.date), "truncated": truncated,
            "messages": [describe(m, acc.me.id, u.id) for m in msgs],
        })
    return {"account": acc.label, "since": _iso(since_dt), "dialogs_scanned": scanned, "chats": chats,
            "note": "truncated=true: call tg_history for the full thread before replying." if any(x["truncated"] for x in chats) else None}


@mcp.tool()
@tg_errors
async def tg_history(account: str = "hunt", peer: str = "", limit: int = 200, before_id: int | None = None) -> dict:
    """The whole thread with one person, oldest first: texts, captions, media descriptors, locations,
    forwarded/edited flags. Always read it completely before drafting a reply (they may have sent photos,
    a location or answers you already asked for). peer: @username, t.me link, +phone or numeric id.
    For older pages pass before_id = the smallest id you have. has_more=true means older messages exist."""
    acc = await authed(account)
    c = acc.client
    e = await resolve_entity(c, peer)
    if isinstance(e, types.User) and e.id in SERVICE_USER_IDS:
        raise ToolError("Hunt does not read Telegram service chats.")
    lim = max(1, min(int(limit), 1000))
    kw: dict[str, Any] = {"limit": lim}
    if before_id:
        kw["offset_id"] = int(before_id)
    msgs = [m async for m in c.iter_messages(e, **kw)]
    msgs.reverse()
    pid = utils.get_peer_id(e)
    return {"account": acc.label, "peer": summarize(e), "count": len(msgs), "has_more": len(msgs) == lim,
            "messages": [describe(m, acc.me.id, pid) for m in msgs]}


MEDIA_KINDS = ("photo", "video", "document", "voice", "audio", "video_note", "gif", "sticker")


@mcp.tool()
@tg_errors
async def tg_media(account: str = "hunt", peer: str = "", out_dir: str = "", since: str | None = None,
                   kinds: list[str] | None = None, max: int = 0, direction: str = "in") -> dict:
    """Download media from one chat into out_dir (all of it by default; never stop at the first few).
    Files are named <peer>_<message id>.<ext>; files already downloaded are skipped, so re-running is cheap.

    Args:
        out_dir: local folder (created if missing), e.g. the search's photos folder.
        since: only messages after this ISO time / '3d' (default: whole chat).
        kinds: subset of photo, video, document, voice, audio, video_note, gif, sticker (default photo, video, document).
        max: stop after this many files (0 = no limit).
        direction: "in" (what they sent, default), "out" or "any".
    Album captions are copied to every file of the album. Files over media_max_mb (setting, 50) are skipped.
    """
    if not out_dir:
        raise ToolError("out_dir is required.")
    kinds = kinds or ["photo", "video", "document"]
    bad = [k for k in kinds if k not in MEDIA_KINDS]
    if bad:
        raise ToolError(f"Unknown kinds {bad}; use {MEDIA_KINDS}.")
    if direction not in ("in", "out", "any"):
        raise ToolError("direction must be in, out or any.")
    acc = await authed(account)
    c = acc.client
    e = await resolve_entity(c, peer)
    since_dt = parse_since(since)
    od = Path(out_dir).expanduser()
    od.mkdir(parents=True, exist_ok=True)
    max_bytes = float(settings_for(acc.label).get("media_max_mb") or 50) * 1024 * 1024
    slug = re.sub(r"[^A-Za-z0-9_-]", "", (getattr(e, "username", None) or str(utils.get_peer_id(e))))[:40]
    picked = []
    album_caption: dict[int, str] = {}
    async for m in c.iter_messages(e, limit=None):
        if since_dt and m.date < since_dt:
            break
        if m.grouped_id and m.message:
            album_caption.setdefault(m.grouped_id, m.message)
        if direction == "in" and m.out or direction == "out" and not m.out:
            continue
        k = _media_kind(m)
        if k in kinds:
            picked.append((m, k))
    picked.reverse()
    files, skipped = [], []
    for m, k in picked:
        if max and len(files) >= max:
            break
        size = getattr(m.file, "size", 0) or 0
        if size > max_bytes:
            skipped.append({"message_id": m.id, "kind": k, "size": size, "why": "too big"})
            continue
        ext = getattr(m.file, "ext", None) or ""
        target = od / f"{slug}_{m.id}{ext}"
        existed = target.exists() and target.stat().st_size > 0
        if not existed:
            got = await c.download_media(m, file=str(target))
            target = Path(got) if got else target
        files.append({"message_id": m.id, "date": _iso(m.date), "kind": k, "path": str(target), "size": size or None,
                      "caption": m.message or album_caption.get(m.grouped_id or 0, ""), "album": str(m.grouped_id) if m.grouped_id else None,
                      "already_had": existed})
    return {"account": acc.label, "peer": summarize(e), "out_dir": str(od), "count": len(files), "files": files,
            "skipped": skipped, "more_available": bool(max) and len(picked) > len(files) + len(skipped)}


def parse_post_link(link: str) -> tuple[str | int, int]:
    """t.me/<username>/<id>, t.me/<username>/<topic>/<id>, t.me/c/<internal id>/<id> (+ ?single etc.) → (peer, message id)."""
    s = str(link or "").strip()
    m = re.match(r"^(?:https?://)?(?:t\.me|telegram\.me)/(?:s/)?(c/\d+|[A-Za-z][A-Za-z0-9_]{3,31})/(?:\d+/)?(\d+)/?(?:\?.*)?$", s)
    if not m:
        raise ToolError(f"Not a Telegram post link: {link!r}. Use https://t.me/<channel>/<id> or https://t.me/c/<id>/<msg>.")
    who, mid = m.group(1), int(m.group(2))
    return (int("-100" + who[2:]) if who.startswith("c/") else who), mid


def _who(e: Any) -> dict | None:
    if e is None:
        return None
    d = summarize(e)
    return {k: d.get(k) for k in ("id", "type", "name", "title", "username") if d.get(k) is not None}


@mcp.tool()
@tg_errors
async def tg_post_media(link: str, out_dir: str, account: str = "hunt", include_video_thumbs: bool = False) -> dict:
    """READ ONLY: download the photos of ONE Telegram post (and every photo of its album) into out_dir, e.g. to pick an
    event photo. link: https://t.me/<channel>/<id> (public channels/groups are read without joining) or
    https://t.me/c/<id>/<msg> (only chats the account is already in). Never joins, posts or reacts.

    Returns {peer, post: {id, date, text, author, forwarded_from, link}, files: [{message_id, path, width, height, size,
    kind}], skipped}. `author` is who posted it in the chat (a channel's own post, or a user in a group);
    `forwarded_from` the original channel/user of a repost. Use them to judge rights: only images published by the
    organizer or venue to promote that event or place are usable (credit + link to the post); skip random users' photos
    and stock. Images in documents (uncompressed) are included; videos are skipped (their thumbnail with
    include_video_thumbs=true)."""
    if not out_dir:
        raise ToolError("out_dir is required.")
    peer, mid = parse_post_link(link)
    acc = await authed(account)
    c = acc.client
    e = await resolve_entity(c, peer)
    first = await c.get_messages(e, ids=mid)
    if first is None:
        raise ToolError(f"Message {mid} not found in {summarize(e).get('peer')} (deleted, or the chat is not readable).")
    msgs = [first]
    if first.grouped_id:
        near = await c.get_messages(e, ids=list(range(max(1, mid - 10), mid + 11)))
        msgs = sorted([m for m in near if m is not None and m.grouped_id == first.grouped_id], key=lambda m: m.id)
    od = Path(out_dir).expanduser()
    od.mkdir(parents=True, exist_ok=True)
    max_bytes = float(settings_for(acc.label).get("media_max_mb") or 50) * 1024 * 1024
    slug = re.sub(r"[^A-Za-z0-9_-]", "", (getattr(e, "username", None) or str(utils.get_peer_id(e))))[:40]
    files, skipped = [], []
    for m in msgs:
        k = _media_kind(m)
        is_img_doc = k == "document" and str(getattr(m.file, "mime_type", "") or "").startswith("image/")
        if k not in ("photo",) and not is_img_doc and not (include_video_thumbs and k == "video"):
            if k:
                skipped.append({"message_id": m.id, "kind": k, "why": "not a photo"})
            continue
        size = getattr(m.file, "size", 0) or 0
        if size > max_bytes:
            skipped.append({"message_id": m.id, "kind": k, "size": size, "why": "too big"})
            continue
        if k == "video":
            target = od / f"{slug}_{m.id}_thumb.jpg"
            if not (target.exists() and target.stat().st_size > 0):
                got = await c.download_media(m, file=str(target), thumb=-1)
                target = Path(got) if got else target
        else:
            target = od / f"{slug}_{m.id}{getattr(m.file, 'ext', None) or '.jpg'}"
            if not (target.exists() and target.stat().st_size > 0):
                got = await c.download_media(m, file=str(target))
                target = Path(got) if got else target
        files.append({"message_id": m.id, "path": str(target), "kind": "video_thumb" if k == "video" else k,
                      "width": getattr(m.file, "width", None), "height": getattr(m.file, "height", None), "size": size or None})
    author = None
    with contextlib.suppress(Exception):
        author = _who(await first.get_sender()) if first.sender_id else _who(e)
    fwd = None
    ff = getattr(first, "fwd_from", None)
    if ff is not None:
        fwd = {"name": getattr(ff, "from_name", None), "post_id": getattr(ff, "channel_post", None)}
        if getattr(ff, "from_id", None) is not None:
            with contextlib.suppress(Exception):
                fwd.update(_who(await c.get_entity(ff.from_id)) or {})
        if fwd.get("username") and fwd.get("post_id"):
            fwd["link"] = f"https://t.me/{fwd['username']}/{fwd['post_id']}"
    text = next((m.message for m in msgs if m.message), "")
    uname = getattr(e, "username", None)
    return {"account": acc.label, "peer": summarize(e),
            "post": {"id": mid, "date": _iso(first.date), "text": text, "author": author, "forwarded_from": fwd,
                     "album": str(first.grouped_id) if first.grouped_id else None,
                     "link": f"https://t.me/{uname}/{mid}" if uname else str(link)},
            "out_dir": str(od), "count": len(files), "files": files, "skipped": skipped}


@mcp.tool()
@tg_errors
async def tg_resolve(account: str = "hunt", query: str = "") -> dict:
    """Look up a person/group by @username, t.me link, +phone or numeric id and summarize it:
    type, name, username, is_contact, scam/fake flags, and `peer` to use in other tools.
    Phone lookups only work if the owner allows being found by number; many lookups in a row can hit
    Telegram limits, so resolve only numbers you are about to contact."""
    acc = await authed(account)
    e = await resolve_entity(acc.client, query)
    out = summarize(e)
    with contextlib.suppress(Exception):
        last = [m async for m in acc.client.iter_messages(e, limit=1)]
        out["has_chat"] = bool(last)
        out["last_message_date"] = _iso(last[0].date) if last else None
    return out


# ---------------------------------------------------------------- tools: sending & folders

@mcp.tool()
@tg_errors
async def tg_send(account: str = "hunt", peer: str = "", text: str = "", reply_to: int | None = None,
                  allow_duplicate: bool = False) -> dict:
    """Send one message, with safety guards. Only send text the owner approved (draft final_text), then
    draft_mark the draft and messages_log the result.

    Guards: min seconds between sends (waits automatically up to 90 s), min gap between first messages
    to new people, max new chats per rolling 24 h, quiet hours, cooldowns after Telegram limits, and no
    identical resend to the same chat within duplicate_window_h. On FLOOD_WAIT / PEER_FLOOD / frozen
    the tool returns a STOP message and records a cooldown: stop outreach on this account and tell the user.
    New chats are added to the Hunt folder when folder_auto is on.
    Returns {sent, message_id, date, new_chat, external_id, folder?}.
    """
    if not text.strip():
        raise ToolError("text is empty.")
    if len(text) > 4096:
        raise ToolError("Telegram messages are limited to 4096 characters; split it.")
    acc = await authed(account)
    c = acc.client
    async with acc.send_lock:
        e = await resolve_entity(c, peer)
        if isinstance(e, types.User) and (e.id in SERVICE_USER_IDS or e.is_self):
            raise ToolError("Refusing to send to a service chat or to yourself.")
        sett = settings_for(acc.label)
        recent = [m async for m in c.iter_messages(e, limit=30)]
        new_chat = not recent
        win = float(sett.get("duplicate_window_h") or 0) * 3600
        if not allow_duplicate and win:
            for m in recent:
                if m.out and (m.message or "").strip() == text.strip() and (_now() - m.date).total_seconds() < win:
                    return {"sent": False, "duplicate": True, "message_id": m.id, "date": _iso(m.date),
                            "note": "The same text was already sent to this chat recently; not sent again."}
        decision = pacing_check(load_state(acc.label), sett, _now(), new_chat)
        if not decision["ok"]:
            raise ToolError(decision["reason"])
        if decision.get("wait_s"):
            await asyncio.sleep(decision["wait_s"])
        pid = utils.get_peer_id(e)
        try:
            msg = await c.send_message(e, text, reply_to=reply_to)
        except errors.FloodWaitError as ex:
            until = _now().timestamp() + ex.seconds
            update_state(acc.label, lambda s: s.update(cooldown_until=until, cooldown_reason=f"FLOOD_WAIT {ex.seconds}s"))
            raise _stop(f"Telegram rate limit (FLOOD_WAIT {ex.seconds}s). Nothing was sent. No sends from '{acc.label}' "
                        f"before {_iso(datetime.fromtimestamp(until, timezone.utc))}.")
        except errors.PeerFloodError:
            until = _now().timestamp() + 24 * 3600
            update_state(acc.label, lambda s: s.update(new_chat_cooldown_until=until, new_chat_cooldown_reason="PEER_FLOOD"))
            raise _stop("Telegram limited this account for messaging new people (PEER_FLOOD). Nothing was sent. "
                        "Stop all new outreach for 24-72 h, keep only existing chats, tell the user, and let them "
                        "check @SpamBot. Do not retry.")
        except errors.UserPrivacyRestrictedError:
            raise ToolError("This person's privacy settings do not allow messages from strangers. Use another channel.")
        except (errors.UserIsBlockedError, errors.YouBlockedUserError):
            raise ToolError("Blocked (by them or by you). Do not retry; use another channel if appropriate.")
        except errors.InputUserDeactivatedError:
            raise ToolError("This Telegram account was deleted.")
        except (errors.ChatWriteForbiddenError, errors.UserRestrictedError) as ex:
            raise ToolError(f"Cannot write here ({type(ex).__name__}).")
        now_ts = _now().timestamp()

        def rec(s: dict) -> None:
            s["last_send_ts"] = now_ts
            s["sends"] = [x for x in s.get("sends", []) if x > now_ts - 86400] + [now_ts]
            if new_chat:
                s["new_chats"] = [x for x in s.get("new_chats", []) if x.get("ts", 0) > now_ts - 86400] + [{"ts": now_ts, "peer": pid}]
        update_state(acc.label, rec)
        out: dict[str, Any] = {"sent": True, "message_id": msg.id, "date": _iso(msg.date), "peer": summarize(e),
                               "new_chat": new_chat, "external_id": f"tg:{acc.me.id}:{pid}:{msg.id}"}
        if decision.get("wait_s"):
            out["waited_s"] = round(decision["wait_s"], 1)
        if new_chat and sett.get("folder_auto"):
            try:
                out["folder"] = await folder_add(acc, e, sett.get("folder_title") or "Hunt")
            except Exception as ex:  # noqa: BLE001 - message was sent; folder is best effort
                out["folder_warning"] = f"Sent, but not added to the folder: {ex}"
        return out


@mcp.tool()
@tg_errors
async def tg_folder_ensure(account: str = "hunt", title: str = "Hunt") -> dict:
    """Make sure a chat folder (filter) with this title exists and return its id and size.
    A new folder must contain at least one chat, so it starts with Saved Messages as a placeholder that
    disappears when the first real chat is added. Limits: 10 folders / 100 chats per folder (Premium 30 / 200)."""
    acc = await authed(account)
    f, created = await _ensure_folder(acc, title)
    premium = bool(getattr(acc.me, "premium", False))
    n = len([p for p in f.include_peers if not isinstance(p, types.InputPeerSelf)]) + len(f.pinned_peers)
    return {"folder": _title_text(f), "folder_id": f.id, "created": created, "chats": n, "limit": folder_limit(premium)}


@mcp.tool()
@tg_errors
async def tg_folder_add(account: str = "hunt", peer: str = "", title: str = "Hunt") -> dict:
    """Add a chat to the folder (creates the folder if needed). Reads the folder, appends the peer and
    writes it back; respects the 100 (Premium 200) chats limit."""
    acc = await authed(account)
    e = await resolve_entity(acc.client, peer)
    return {**await folder_add(acc, e, title), "peer": summarize(e)}


@mcp.tool()
@tg_errors
async def tg_folder_remove(account: str = "hunt", peer: str = "", title: str = "Hunt") -> dict:
    """Remove a chat from the folder (for dead leads, to stay under the folder limit). The chat itself
    is not deleted or archived."""
    acc = await authed(account)
    e = await resolve_entity(acc.client, peer)
    f = _find_folder(await _filters(acc.client), title)
    if f is None:
        raise ToolError(f"No folder named {title!r}.")
    ip = await acc.client.get_input_entity(e)
    res = remove_peer_from_filter(f, ip)
    if res == "removed":
        await acc.client(functions.messages.UpdateDialogFilterRequest(id=f.id, filter=f))
    return {"folder": title, "folder_id": f.id, "result": res, "peer": summarize(e)}


if __name__ == "__main__":
    mcp.run()
