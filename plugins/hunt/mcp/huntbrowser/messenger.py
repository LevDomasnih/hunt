"""hunt_browser: messenger."""
from __future__ import annotations
import contextlib
import re
import time
from pathlib import Path
from huntbrowser.base import ToolError
from playwright.async_api import Page
from playwright.async_api import Error as PWError
from playwright.async_api import TimeoutError as PWTimeout
from huntbrowser import base as _base, helpers as _helpers, js as _js, pacing as _pacing, session as _session
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

    def __init__(self, base: str = _base.FB):
        self.base = base

    async def state(self, page: Page) -> dict:
        return await _session.safe_eval(page, FB_STATE_JS, None, {"state": "loading"}) or {"state": "loading"}

    def _login_error(self, st: dict) -> None:
        if st["state"] == "login":
            raise _session.LoginNeeded("Facebook session missing or expired: call fb_login (a window opens; the hunter logs in).")
        if st["state"] == "checkpoint":
            raise _session.LoginNeeded("Facebook wants a security check: call fb_login so the hunter can pass it in the window.")
        if st["state"] == "pin":
            raise _session.LoginNeeded("Messenger asks for the end-to-end encryption PIN to restore chats. The hunter must type it: "
                              "call fb_login, enter the PIN in the window, then close it. Never guess or store the PIN.")

    async def goto(self, page: Page, url: str) -> dict:
        await page.goto(url, wait_until="domcontentloaded")
        await page.wait_for_timeout(2500)
        st = await self.state(page)
        self._login_error(st)
        return st

    async def status(self, page: Page, sess: _session.Session) -> dict:
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
            for t in await _session.safe_eval(page, FB_THREADS_JS, None, []) or []:
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
            if any(_helpers.display_matches(h, expect_display) for h in heads) or _helpers.display_matches(
                    await _session.safe_eval(page, "() => document.title", None, "") or "", expect_display):
                return {**res, "ok": True, "by": "thread_id+display"}
            return {**res, "ok": False, "status": "wrong_chat", "reason": f"thread header {heads[:2]} does not show {expect_display!r}"}
        return {**res, "ok": True, "by": "thread_id"}

    async def rows(self, page: Page, limit: int = 10000) -> list[dict]:
        return await _session.safe_eval(page, FB_ROWS_JS, limit, []) or []

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
            await _js.scroll_up(page, '[role="main"] [role="row"]')
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
                    sess: _session.Session | None = None) -> dict:
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
                big = await _session.safe_eval(page, _js.LARGEST_IMG_JS)
                url = big["src"] if big and re.search(r"fbcdn|scontent", big["src"]) else src
                suffix = "" if url != src else "_thumb"
                resp = await page.context.request.get(url)
                if resp.ok:
                    path = out / f"fb_{len(files) + 1:03d}{suffix}{_js._ext_for(resp.headers.get('content-type', ''), url)}"
                    _base._write_private(path, await resp.body())
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
                   pacer: _pacing.Pacer | None = None, allow_repeat: bool = False) -> dict:
        if pacer:
            await pacer.check(new_chat=None)
        chk = await self.open_thread(page, peer, expect_display)
        if not chk["ok"]:
            return {"status": chk.get("status", "wrong_chat"), "sent": False, "reason": chk.get("reason"), "header": chk.get("title")}
        rows = await self.rows(page)
        new_chat = not rows
        outs = [r for r in rows if r["dir"] == "out"]
        if outs and not allow_repeat and rows and rows[-1]["dir"] == "out" and _helpers.same_text(rows[-1]["text"], text):
            return {"status": "already_sent", "sent": False, "reason": "the last message is ours with this text (allow_repeat=true to send again)"}
        if pacer:
            await pacer.check(new_chat=new_chat)
        try:
            await page.locator(FB_BOX).last.wait_for(timeout=10000)
        except PWTimeout:
            return {"status": "not_sent", "sent": False, "reason": "message box not found (thread closed, blocked, or PIN prompt?)"}
        before = sum(1 for r in rows if _helpers.same_text(r["text"], text))
        if not await _js._fill_box(page, FB_BOX, text, paste_first=False):
            await _js._clear_box(page, FB_BOX)
            return {"status": "not_sent", "sent": False, "reason": "could not put the text into the message box"}
        if pacer:
            pacer.record(chk["thread_id"], new_chat)
        try:
            await page.keyboard.press("Enter")
        except PWError:
            return {"status": "unknown", "sent": None, "reason": _base.UNKNOWN}
        return await verify_by_count(page, self.rows, text, before, pacer, chk, new_chat, "fb_history")


async def verify_by_count(page: Page, rows_fn, text: str, before: int, pacer: _pacing.Pacer | None, chk: dict,
                          new_chat: bool, history_tool: str, timeout: float = 15) -> dict:
    """Sent = a row with our text appeared (count went up) and it is not marked failed."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        await page.wait_for_timeout(1000)
        rows = await rows_fn(page)
        matches = [r for r in rows if _helpers.same_text(r.get("text", ""), text)]
        if len(matches) > before:
            warn = await _js._limit_warning(page)
            if warn and pacer:
                pacer.block(warn)
            if matches[-1].get("failed"):
                return {"status": "failed_visible", "sent": False, "reason": "the message shows 'not sent'; check the thread before retrying",
                        "limit_warning": warn}
            return {"status": "sent", "sent": True, "header": chk.get("title"), "verified_by": chk.get("by"),
                    "new_chat": new_chat, "limit_warning": warn}
    warn = await _js._limit_warning(page)
    if warn and pacer:
        pacer.block(warn)
    return {"status": "unknown", "sent": None, "reason": _base.UNKNOWN, "limit_warning": warn,
            "next": f"call {history_tool} for this peer and look at the last messages"}
