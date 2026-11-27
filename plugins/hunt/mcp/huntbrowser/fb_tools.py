"""hunt_browser: fb_tools."""
from __future__ import annotations
import re
from huntbrowser.base import ToolError
from playwright.async_api import Page
from huntbrowser import base as _base, helpers as _helpers, js as _js, messenger as _messenger, pacing as _pacing, session as _session, tools as _tools
# ---------------------------------------------------------------- Messenger tools

@_base.mcp.tool()
async def fb_status(account: str = "main") -> dict:
    """Facebook Messenger: logged in? user id; flags a pending e2ee PIN prompt or security checkpoint."""
    acct = _base.check_account(account)
    res = await _tools.run("messenger", acct, lambda s, p: _tools.MSGR.status(p, s))
    res["pacing"] = _pacing.Pacer("messenger", acct).summary()
    return res


@_base.mcp.tool()
async def fb_inbox(account: str = "main", limit: int = 30, all_chats: bool = False) -> dict:
    """Messenger threads with unread messages (thread_id, name, preview). Marketplace threads are included.
    all_chats=true lists the latest threads regardless of unread state (unread detection is heuristic)."""
    return await _tools.run("messenger", account, lambda s, p: _tools.MSGR.inbox(p, _tools._limit(limit, 1, 200), all_chats))


@_base.mcp.tool()
async def fb_history(account: str = "main", peer: str = "", limit: int = 200, expect_display: str | None = None) -> dict:
    """Messenger thread, oldest first. peer = thread id, facebook.com/messages/t/<id> (or /e2ee/t/) URL or
    m.me/<name>. Always opened on www.facebook.com. Messages: dir in/out (from bubble position), text,
    image/video/link descriptors, failed flag. Language: use dir='in' messages only."""
    if not peer:
        raise ToolError("peer is required (thread id or URL)")
    return await _tools.run("messenger", account, lambda s, p: _tools.MSGR.history(p, peer, _tools._limit(limit), expect_display))


@_base.mcp.tool()
async def fb_media(account: str = "main", peer: str = "", out_dir: str | None = None, limit: int = 20,
                   expect_display: str | None = None) -> dict:
    """Save photos from a Messenger thread (opens each in the viewer for the large version; newest first)."""
    if not peer:
        raise ToolError("peer is required")
    acct = _base.check_account(account)
    out = _js.media_dir("messenger", acct, _messenger.fb_thread_id(peer)[0] or peer, out_dir)
    return await _tools.run("messenger", acct, lambda s, p: _tools.MSGR.media(p, peer, out, _tools._limit(limit, 1, 200), expect_display, s))


@_base.mcp.tool()
async def fb_send(account: str = "main", peer: str = "", text: str = "", expect_display: str | None = None,
                  allow_repeat: bool = False) -> dict:
    """Send one Messenger message in an existing thread (peer = thread id / URL). Checks the browser really
    is on that thread (and that the header shows expect_display when given), types, presses Enter and
    verifies the message appeared. Status as in wa_send: sent | unknown (read fb_history before anything
    else, never resend blindly) | not_sent | wrong_chat | no_chat | already_sent | failed_visible | paced.
    If Messenger asks for the e2ee PIN you get 'login needed': the hunter types it via fb_login."""
    if not peer:
        raise ToolError("peer is required (thread id or URL)")
    text = _tools._text_arg(text)
    acct = _base.check_account(account)
    pacer = _pacing.Pacer("messenger", acct)
    return await _tools.run("messenger", acct, _tools.send_fn(lambda s, p: _tools.MSGR.send(p, peer, text, expect_display, pacer, allow_repeat)))


@_base.mcp.tool()
async def fb_resolve(account: str = "main", query: str = "") -> dict:
    """Find Messenger threads: a thread id/URL → its header name; a name → matching recent threads."""
    if not query:
        raise ToolError("query is required")

    async def go(s: _session.Session, page: Page):
        tid, _ = _messenger.fb_thread_id(query)
        if tid and (re.search(r"/t/|m\.me/", query) or tid.isdigit()):
            chk = await _tools.MSGR.open_thread(page, query, None)
            return {"query": query, "thread_id": tid, "opened": chk.get("ok"), "header": chk.get("title"), "url": chk.get("url")}
        inbox = await _tools.MSGR.inbox(page, 200, True)
        return {"query": query, "matches": [t for t in inbox["chats"] if _helpers.display_matches(t["name"], query)][:20]}

    return await _tools.run("messenger", account, go)
