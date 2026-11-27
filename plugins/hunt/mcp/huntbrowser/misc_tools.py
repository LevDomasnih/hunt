"""hunt_browser: misc_tools."""
from __future__ import annotations
from datetime import datetime
from huntbrowser.base import ToolError
from playwright.async_api import Page
from huntbrowser import base as _base, chromium as _chromium, session as _session, tools as _tools
# ---------------------------------------------------------------- debugging / housekeeping

@_base.mcp.tool()
async def browser_screenshot(channel: str, account: str = "main", full_page: bool = False) -> dict:
    """Screenshot of what the headless browser of channel/account shows now (debugging). Saved under
    ~/.config/hunt/browser/screens/ (mode 600; may contain private chats — delete when done)."""
    if channel not in _base.CHANNELS:
        raise ToolError(f"channel must be one of {', '.join(_base.CHANNELS)}")
    acct = _base.check_account(account)

    async def go(s: _session.Session, page: Page):
        path = _base.browser_dir() / "screens" / f"{channel}-{acct}-{datetime.now():%Y%m%d-%H%M%S}.png"
        _base._write_private(path, await page.screenshot(full_page=full_page))
        return {"path": str(path), "url": page.url, "title": await page.title()}

    return await _tools.run(channel, acct, go)


@_base.mcp.tool()
async def browser_sessions() -> dict:
    """Running browser sessions in this server and the profiles on disk, plus the Chromium in use."""
    running = [{"channel": c, "account": a, "headed": s.headed, "alive": s.alive(),
                "url": s._page.url if s._page and not s._page.is_closed() else None, "login": s.login or None}
               for (c, a), s in _session.SESSIONS.items()]
    d = _base.browser_dir()
    profiles = sorted(p.name for p in d.iterdir() if p.is_dir() and any(p.name.startswith(c + "-") for c in _base.CHANNELS))
    found = _chromium.find_chromium()
    return {"running": running, "profiles": profiles, "chromium": found,
            "chromium_ok": bool(found["full"] or found["shell"]),
            "chromium_help": None if (found["full"] or found["shell"]) else _chromium.chromium_missing_message(found["root"])}


@_base.mcp.tool()
async def browser_close(channel: str, account: str = "main") -> dict:
    """Close the background browser of channel/account (frees memory). The login stays in the profile;
    the next call starts it again. WhatsApp unlinks devices unused for ~30 days, so open it now and then."""
    if channel not in _base.CHANNELS:
        raise ToolError(f"channel must be one of {', '.join(_base.CHANNELS)}")
    sess = _session.session(channel, account)
    async with sess.lock:
        await sess.close()
    return {"closed": True, "channel": channel, "account": sess.account}
