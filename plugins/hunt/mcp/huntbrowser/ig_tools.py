"""hunt_browser: ig_tools."""
from __future__ import annotations
from huntbrowser.base import ToolError
from huntbrowser import base as _base, js as _js, pacing as _pacing, tools as _tools
# ---------------------------------------------------------------- Instagram tools

@_base.mcp.tool()
async def ig_status(account: str = "main") -> dict:
    """Instagram: logged in? username, user id, plus pacing counters."""
    acct = _base.check_account(account)
    res = await _tools.run("instagram", acct, lambda s, p: _tools.INSTA.status(p, s))
    res["pacing"] = _pacing.Pacer("instagram", acct).summary()
    return res


@_base.mcp.tool()
async def ig_inbox(account: str = "main", limit: int = 30, all_chats: bool = False, requests: bool = True) -> dict:
    """Instagram DM threads that are unread, plus message requests (request=true). Each: thread_id, users,
    last message. all_chats=true lists the latest threads."""
    return await _tools.run("instagram", account, lambda s, p: _tools.INSTA.inbox(p, s, _tools._limit(limit, 1, 100), all_chats, requests))


@_base.mcp.tool()
async def ig_history(account: str = "main", peer: str = "", limit: int = 200, expect_display: str | None = None) -> dict:
    """Instagram DM thread, oldest first. peer = thread id, instagram.com/direct/t/<id> URL or @username.
    Messages: dir, time, text, media (image_url full size, video, shared post/reel with caption, link,
    voice). Language: use dir='in' only."""
    if not peer:
        raise ToolError("peer is required (thread id, URL or username)")
    return await _tools.run("instagram", account, lambda s, p: _tools.INSTA.history(p, s, peer, _tools._limit(limit), expect_display))


@_base.mcp.tool()
async def ig_media(account: str = "main", peer: str = "", out_dir: str | None = None, limit: int = 20,
                   expect_display: str | None = None) -> dict:
    """Save full-size photos (and covers of shared posts/videos) from an Instagram DM thread."""
    if not peer:
        raise ToolError("peer is required")
    acct = _base.check_account(account)
    out = _js.media_dir("instagram", acct, peer.lstrip("@"), out_dir)
    return await _tools.run("instagram", acct, lambda s, p: _tools.INSTA.media(p, s, peer, out, _tools._limit(limit, 1, 200), expect_display))


@_base.mcp.tool()
async def ig_send(account: str = "main", peer: str = "", text: str = "", expect_display: str | None = None,
                  allow_repeat: bool = False) -> dict:
    """Send one Instagram DM. peer = thread id/URL or @username (a new conversation is opened from the
    profile's Message button if none exists). Checks participants (username / expect_display), types,
    presses Enter and verifies through Instagram's own thread data. Non-followers get one message until
    they accept. Status: sent | unknown (read ig_history first, never resend blindly) | not_sent |
    wrong_chat | no_chat | already_sent | paced."""
    if not peer:
        raise ToolError("peer is required")
    text = _tools._text_arg(text)
    acct = _base.check_account(account)
    pacer = _pacing.Pacer("instagram", acct)
    return await _tools.run("instagram", acct, _tools.send_fn(lambda s, p: _tools.INSTA.send(p, s, peer, text, expect_display, pacer, allow_repeat)))


@_base.mcp.tool()
async def ig_resolve(account: str = "main", query: str = "") -> dict:
    """Find an Instagram user/thread: @username → user id + existing thread id; free text → DM search."""
    if not query:
        raise ToolError("query is required")
    return await _tools.run("instagram", account, lambda s, p: _tools.INSTA.resolve(p, s, query))
