"""hunt_browser: wa_tools."""
from __future__ import annotations
import asyncio
import contextlib
import re
import time
from datetime import datetime
from huntbrowser.base import ToolError
from playwright.async_api import Page
from huntbrowser import base as _base, js as _js, pacing as _pacing, session as _session, tools as _tools, whatsapp as _whatsapp
# ---------------------------------------------------------------- WhatsApp tools

@_base.mcp.tool()
async def wa_login(account: str = "main") -> dict:
    """Link WhatsApp Web (headless) to the hunting WhatsApp account. Saves the QR code as
    ~/.config/hunt/browser/qr-<account>.png (and qr-<account>.html, which auto-refreshes) and keeps it
    fresh in the background for ~6 minutes. Show the PNG to the hunter: WhatsApp on the hunting phone →
    Settings → Linked devices → Link a device → scan. Then poll wa_login_status until linked."""
    acct = _base.check_account(account)
    sess = _session.session("whatsapp", acct)
    png, html = _whatsapp.qr_paths(acct)

    async def go(s: _session.Session, page: Page):
        if not page.url.startswith(_base.WA):
            await page.goto(_base.WA + "/", wait_until="domcontentloaded")
        st = await _tools.WAPP.wait_state(page, {"app", "chat", "qr", "qr_expired"}, timeout=60)
        if st["state"] in ("app", "chat"):
            return {"status": "already_linked", "number": await _tools.WAPP.own_number(page)}
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
        if not await _tools.WAPP.qr_snapshot(page, png):
            return {"status": "not_ready", "state": "qr canvas not found"}
        _whatsapp.write_qr_html(html, png.name)
        return {"status": "qr", "qr_png": str(png), "qr_page": str(html)}

    res = await _tools.run("whatsapp", acct, go)
    if res.get("status") == "qr":
        sess.login = {"state": "qr", "qr_updated": datetime.now().isoformat(timespec="seconds")}
        if sess.login_task is None or sess.login_task.done():
            sess.login_task = asyncio.create_task(_whatsapp.wa_login_watch(sess, _tools.WAPP, acct))
        res["next"] = ("Show the QR to the hunter (Read the PNG to display it, or they open qr_page in a browser). "
                       "It rotates and expires; the file is refreshed for ~6 min. Then call wa_login_status(wait_s=60).")
    return res


@_base.mcp.tool()
async def wa_login_status(account: str = "main", wait_s: int = 0) -> dict:
    """Is WhatsApp linked yet? wait_s (0-120) polls until the chat list appears. Returns the QR path
    while still waiting, 'syncing' while chats load after the scan, 'linked' with the own number when done."""
    acct = _base.check_account(account)
    sess = _session.session("whatsapp", acct)
    png, html = _whatsapp.qr_paths(acct)
    deadline = time.monotonic() + max(0, min(int(wait_s or 0), 120))
    while True:
        st = await _tools.run("whatsapp", acct, lambda s, p: _session.safe_eval(p, _whatsapp.WA_STATE_JS, None, {"state": "loading"}))
        st = st or {"state": "loading"}
        if st["state"] in ("app", "chat"):
            num = await _tools.run("whatsapp", acct, lambda s, p: _tools.WAPP.own_number(p))
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


@_base.mcp.tool()
async def wa_status(account: str = "main") -> dict:
    """WhatsApp: linked? own number? plus today's pacing counters."""
    acct = _base.check_account(account)
    res = await _tools.run("whatsapp", acct, lambda s, p: _tools.WAPP.status(p))
    res["pacing"] = _pacing.Pacer("whatsapp", acct).summary()
    return res


@_base.mcp.tool()
async def wa_inbox(account: str = "main", limit: int = 30, all_chats: bool = False) -> dict:
    """WhatsApp chats with unread messages or missed calls (name or number, last message preview, unread
    count, time). all_chats=true lists recent chats regardless of unread state. Opening a chat later
    (wa_history) marks it read on the hunter's phone too."""
    return await _tools.run("whatsapp", account, lambda s, p: _tools.WAPP.inbox(p, _tools._limit(limit, 1, 200), all_chats))


@_base.mcp.tool()
async def wa_history(account: str = "main", peer: str = "", limit: int = 200, expect_display: str | None = None) -> dict:
    """Full WhatsApp thread with one contact, oldest first (scrolls up to `limit` messages). peer = phone
    number (any format, opened via /send?phone=) or an exact chat name. Each message: dir in/out/system,
    time, text (captions included), media descriptors (image/video/voice/document/location/contact/
    missed_call), tick status for ours. verified=false means the header shows neither the number nor
    expect_display: check before trusting it. Decide the language from dir='in' messages only."""
    if not peer:
        raise ToolError("peer is required (phone number or exact chat name)")
    return await _tools.run("whatsapp", account, lambda s, p: _tools.WAPP.history(p, peer, _tools._limit(limit), expect_display))


@_base.mcp.tool()
async def wa_media(account: str = "main", peer: str = "", out_dir: str | None = None, limit: int = 20,
                   expect_display: str | None = None) -> dict:
    """Save photos from a WhatsApp chat as files (full size via the photo viewer; newest first).
    Default folder: ~/.config/hunt/browser/media/whatsapp-<account>/<peer>/. Videos are only counted."""
    if not peer:
        raise ToolError("peer is required")
    acct = _base.check_account(account)
    out = _js.media_dir("whatsapp", acct, peer, out_dir)
    return await _tools.run("whatsapp", acct, lambda s, p: _tools.WAPP.media(p, peer, out, _tools._limit(limit, 1, 200), expect_display))


@_base.mcp.tool()
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
    text = _tools._text_arg(text)
    acct = _base.check_account(account)
    pacer = _pacing.Pacer("whatsapp", acct)
    return await _tools.run("whatsapp", acct, _tools.send_fn(lambda s, p: _tools.WAPP.send(p, peer, text, expect_display, pacer, allow_repeat)))


@_base.mcp.tool()
async def wa_resolve(account: str = "main", query: str = "") -> dict:
    """Is this number on WhatsApp, and what does the chat header show (number or business/saved name)?
    For a name: searches the chat list and returns matching chats. Sends nothing."""
    if not query:
        raise ToolError("query is required")
    return await _tools.run("whatsapp", account, lambda s, p: _tools.WAPP.resolve(p, query))
