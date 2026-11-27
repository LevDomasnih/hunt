"""hunt_browser: whatsapp."""
from __future__ import annotations
import asyncio
import base64
import contextlib
import re
import time
from datetime import datetime
from pathlib import Path
from huntbrowser.base import ToolError
from playwright.async_api import Page
from playwright.async_api import Error as PWError
from playwright.async_api import TimeoutError as PWTimeout
from huntbrowser import base as _base, helpers as _helpers, js as _js, pacing as _pacing, session as _session
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

WA_ROWS_JS = "(limit) => { " + _js.TEXT_OF + r"""
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

    def __init__(self, base: str = _base.WA):
        self.base = base

    async def wait_state(self, page: Page, want: set[str], timeout: float = 60.0) -> dict:
        deadline = time.monotonic() + timeout
        st: dict = {"state": "loading"}
        while time.monotonic() < deadline:
            st = await _session.safe_eval(page, WA_STATE_JS, None, {"state": "loading"}) or {"state": "loading"}
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
            raise _session.LoginNeeded("WhatsApp is not linked: call wa_login and have the hunter scan the QR "
                              "(WhatsApp on the hunting phone → Linked devices → Link a device).")
        if st["state"] == "unsupported":
            raise ToolError("WhatsApp Web says this browser is unsupported; check the Chromium install.")
        if st["state"] not in ("app", "chat"):
            raise ToolError(f"WhatsApp Web did not finish loading ({st.get('text') or st['state']}). Retry in a minute.")
        return st

    async def own_number(self, page: Page) -> str | None:
        v = await _session.safe_eval(page, WA_OWN_JS, None, None)
        if not v:
            return None
        m = re.search(r"(\d{6,15})", v)
        return m.group(1) if m else None

    async def open_chat(self, page: Page, peer: str, expect_display: str | None) -> dict:
        """Open the chat by number (deep link) or by exact name; returns header check result."""
        digits = _helpers.phone_digits(peer)
        if digits:
            await page.goto(f"{self.base}/send?phone={digits}", wait_until="domcontentloaded")
            st = await self.wait_state(page, {"chat", "qr", "qr_expired"}, timeout=45)
            if st["state"] in ("qr", "qr_expired"):
                raise _session.LoginNeeded("WhatsApp is not linked: call wa_login.")
            if st["state"] == "invalid":
                return {"ok": False, "status": "no_chat", "reason": f"number {digits} is not on WhatsApp", "dialog": st.get("text")}
            if st["state"] != "chat":
                return {"ok": False, "status": "no_chat", "reason": f"chat did not open ({st['state']})"}
            await page.wait_for_timeout(800)  # header may still be swapping after the reload
            st = await _session.safe_eval(page, WA_STATE_JS, None, st) or st
        else:
            await self.ensure_app(page)
            hits = await self._search(page, peer)
            exact = [h for h in hits if _helpers._norm(h["name"]) == _helpers._norm(peer)]
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
        chk = _helpers.header_check(st.get("title", ""), st.get("header", ""), digits, expect_display)
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
        return await _session.safe_eval(page, WA_CHATLIST_JS, None, []) or []

    async def _clear_search(self, page: Page) -> None:
        with contextlib.suppress(Exception):
            await page.keyboard.press("Escape")

    async def rows(self, page: Page, limit: int = 10000) -> list[dict]:
        return await _session.safe_eval(page, WA_ROWS_JS, limit, []) or []

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
            await _js.scroll_up(page, '#main [role="row"]')
            await page.wait_for_timeout(1200)
        return False

    # --- public operations (page already belongs to the session)

    async def status(self, page: Page) -> dict:
        try:
            await self.ensure_app(page, timeout=45)
        except _session.LoginNeeded as e:
            return {"logged_in": False, "how": str(e)}
        return {"logged_in": True, "number": await self.own_number(page)}

    async def inbox(self, page: Page, limit: int = 30, all_chats: bool = False) -> dict:
        await self.ensure_app(page)
        seen: dict[str, dict] = {}
        await _session.safe_eval(page, WA_PANE_SCROLL_JS, 0)
        await page.wait_for_timeout(500)
        for _ in range(10):
            for c in await _session.safe_eval(page, WA_CHATLIST_JS, None, []) or []:
                seen.setdefault(c["name"] + "|" + c["preview"][:40], c)
            want = [c for c in seen.values() if all_chats or c["unread"] or c["missed_call"]]
            if len(want) >= limit:
                break
            sc = await _session.safe_eval(page, WA_PANE_SCROLL_JS, 1)
            if not sc or sc.get("end"):
                break
            await page.wait_for_timeout(700)
        await _session.safe_eval(page, WA_PANE_SCROLL_JS, 0)
        chats = []
        for c in seen.values():
            if not (all_chats or c["unread"] or c["missed_call"]):
                continue
            d = _helpers.phone_digits(c["name"])
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
                big = await _session.safe_eval(page, _js.LARGEST_IMG_JS)
                src, suffix = (big["src"], "") if big and big["src"] != thumb_src else (thumb_src, "_thumb")
                blob = await _session.safe_eval(page, _js.BLOB_B64_JS, src)
                await page.keyboard.press("Escape")
                await page.wait_for_timeout(400)
                if not blob or not blob.get("data"):
                    skipped += 1
                    continue
                path = out / f"wa_{len(files) + 1:03d}{suffix}{_js._ext_for(blob['type'])}"
                _base._write_private(path, base64.b64decode(blob["data"]))
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
                   pacer: _pacing.Pacer | None = None, allow_repeat: bool = False) -> dict:
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
        if last_out and not allow_repeat and _helpers.same_text(last_out.get("text", ""), text):
            return {"status": "already_sent", "sent": False, "header": chk.get("title"),
                    "reason": "the last outgoing message already has this text (pass allow_repeat=true to send again)"}
        if pacer:
            await pacer.check(new_chat=new_chat)
        try:
            await page.locator(WA_BOX).last.wait_for(timeout=10000)
        except PWTimeout:
            return {"status": "not_sent", "sent": False, "reason": "message box not found (blocked contact or group you left?)"}
        if not await _js._fill_box(page, WA_BOX, text, paste_first=True):
            await _js._clear_box(page, WA_BOX)
            return {"status": "not_sent", "sent": False, "reason": "could not put the text into the message box"}
        before_ids = {r.get("id") for r in before if r.get("id")}
        if pacer:
            pacer.record(peer, new_chat)
        try:
            await page.keyboard.press("Enter")
        except PWError:
            return {"status": "unknown", "sent": None, "reason": _base.UNKNOWN}
        return await self._verify_sent(page, text, before_ids, chk, pacer, new_chat)

    async def _verify_sent(self, page, text, before_ids, chk, pacer, new_chat) -> dict:
        deadline = time.monotonic() + 20
        reloaded = False
        while time.monotonic() < deadline:
            await page.wait_for_timeout(1000)
            st = await _session.safe_eval(page, WA_STATE_JS, None, None)
            if st is None or st.get("state") != "chat":
                reloaded = True  # page reloads right after a send sometimes; wait for it to settle
                continue
            rows = await self.rows(page, 30)
            for r in reversed(rows):
                if r["dir"] != "out":
                    continue
                if r.get("id") in before_ids:
                    break
                if _helpers.same_text(r.get("text", ""), text):
                    warn = await _js._limit_warning(page)
                    if warn and pacer:
                        pacer.block(warn)
                    pending = bool(r.get("status") and "time" in r["status"])
                    return {"status": "sent_pending" if pending else "sent", "sent": True,
                            "header": chk.get("title"), "verified_by": chk.get("by"), "new_chat": new_chat,
                            "message_id": r.get("id"), "tick": r.get("status"),
                            "limit_warning": warn,
                            "note": "clock icon: queued on WhatsApp's side, do not resend" if pending else None}
                break
        warn = await _js._limit_warning(page)
        if warn and pacer:
            pacer.block(warn)
        return {"status": "unknown", "sent": None, "reason": _base.UNKNOWN, "page_reloaded": reloaded,
                "limit_warning": warn, "next": "call wa_history for this peer and look at the last outgoing message"}

    async def resolve(self, page: Page, query: str) -> dict:
        digits = _helpers.phone_digits(query)
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
            d = _helpers.phone_digits(h["name"])
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
        _base._write_private(path, png)
        return True


def qr_paths(account: str) -> tuple[Path, Path]:
    d = _base.browser_dir()
    return d / f"qr-{account}.png", d / f"qr-{account}.html"


def write_qr_html(html_path: Path, png_name: str) -> None:
    html = f"""<!doctype html><meta charset="utf-8"><title>Hunt: link WhatsApp</title>
<style>body{{font:16px system-ui;background:#fff;text-align:center;padding:24px}}img{{width:320px;image-rendering:pixelated}}</style>
<h2>Link WhatsApp to Hunt</h2><p>WhatsApp on the hunting phone → Settings → Linked devices → Link a device → scan.</p>
<img id="q" src="{png_name}"><p><small>Refreshes by itself every 3 s.</small></p>
<script>setInterval(()=>{{document.getElementById('q').src='{png_name}?'+Date.now()}},3000)</script>"""
    _base._write_private(html_path, html.encode())


async def wa_login_watch(sess: _session.Session, wa: WhatsApp, account: str, minutes: float = 6.0) -> None:
    """Background: keep qr-<account>.png fresh (WA rotates/expires the code) until linked or timeout."""
    png, _ = qr_paths(account)
    deadline = time.monotonic() + minutes * 60
    last_ref, reloads = None, 0
    try:
        while time.monotonic() < deadline:
            async with sess.lock:
                page = await sess.page()
                st = await _session.safe_eval(page, WA_STATE_JS, None, {"state": "loading"}) or {"state": "loading"}
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
                    ref = await _session.safe_eval(page, "() => document.querySelector('canvas[aria-label*=\"QR\" i]')?.closest('[data-ref]')?.getAttribute('data-ref') || null")
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
