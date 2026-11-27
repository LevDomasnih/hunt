"""hunt_browser: login_tools."""
from __future__ import annotations
import asyncio
import contextlib
import json
import time
from datetime import datetime
from pathlib import Path
from huntbrowser.base import ToolError
from playwright.async_api import Page
from playwright.async_api import Error as PWError
from huntbrowser import base as _base, fb_tools as _fb_tools, ig_tools as _ig_tools, login as _login, session as _session, tools as _tools
# ---------------------------------------------------------------- Messenger & Instagram login tools

async def _headed_login(channel: str, account: str, cookies_file: str | None) -> dict:
    acct = _base.check_account(account)
    sess = _session.session(channel, acct)
    url, name = _login.LOGIN_COOKIES[channel]
    if cookies_file:
        p = Path(cookies_file).expanduser()
        try:
            raw = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as e:
            raise ToolError(f"cannot read cookies file {p}: {e}")
        cookies = _login.convert_cookies(raw, channel)
        if not any(c["name"] == name for c in cookies):
            raise ToolError(f"the file has no '{name}' cookie for {_login.COOKIE_DOMAINS[channel][0]}; export cookies while logged in.")

        async def imp(s: _session.Session, page: Page):
            await s.ctx.add_cookies(cookies)
            return {"status": "imported", "cookies": len(cookies)}

        res = await _tools.run(channel, acct, imp)
        st = await (_fb_tools.fb_status(acct) if channel == "messenger" else _ig_tools.ig_status(acct))
        res.update(session=st, reminder=f"Delete {p} now: it is a login token for the hunter's account.")
        return res
    async with sess.lock:
        await sess.close()
        await sess.start(headed=True)
        page = await sess.page()
        page.set_default_timeout(30000)
        with contextlib.suppress(PWError):
            await page.goto(_login.LOGIN_URLS[channel], wait_until="domcontentloaded")
    sess.login = {"state": "waiting_for_login", "opened": datetime.now().isoformat(timespec="seconds")}
    if sess.login_task is None or sess.login_task.done():
        sess.login_task = asyncio.create_task(_login.headed_login_watch(sess))
    who = "Facebook" if channel == "messenger" else "Instagram"
    return {"status": "window_open", "profile": str(sess.dir),
            "tell_hunter": (f"A separate Chromium window with {who} opened (Hunt's own profile, not your Chrome). "
                            f"Log in there yourself{' and enter the Messenger PIN if asked' if channel == 'messenger' else ''}. "
                            "The window closes by itself once you're in. Hunt never sees your password."),
            "next": f"poll {'fb' if channel == 'messenger' else 'ig'}_login_status(wait_s=60)"}


async def _headed_login_status(channel: str, account: str, wait_s: int) -> dict:
    acct = _base.check_account(account)
    sess = _session.session(channel, acct)
    deadline = time.monotonic() + max(0, min(int(wait_s or 0), 120))
    while sess.headed and sess.ctx is not None and time.monotonic() < deadline:
        await asyncio.sleep(2)
    if sess.headed and sess.ctx is not None:
        return {"status": sess.login.get("state", "waiting_for_login"), "window": "open"}
    st = await (_fb_tools.fb_status(acct) if channel == "messenger" else _ig_tools.ig_status(acct))
    return {"status": "logged_in" if st.get("logged_in") else sess.login.get("state", "not_logged_in"), "session": st}


@_base.mcp.tool()
async def fb_login(account: str = "main", cookies_file: str | None = None) -> dict:
    """Connect Facebook Messenger. Default: opens a VISIBLE Chromium window of Hunt's own profile so the
    hunter logs in themselves (and types the Messenger end-to-end PIN if asked); it closes by itself
    once the c_user session cookie appears, then everything runs headless. Never type passwords or PINs
    for the hunter. Alternative: cookies_file = JSON exported from a logged-in browser (Cookie-Editor)."""
    return await _headed_login("messenger", account, cookies_file)


@_base.mcp.tool()
async def fb_login_status(account: str = "main", wait_s: int = 0) -> dict:
    """Has the hunter finished logging in to Facebook in the window? wait_s (0-120) waits for it."""
    return await _headed_login_status("messenger", account, wait_s)


@_base.mcp.tool()
async def ig_login(account: str = "main", cookies_file: str | None = None) -> dict:
    """Connect Instagram DMs. Opens a VISIBLE Chromium window of Hunt's own profile at the Instagram login
    page; the hunter logs in themselves (use the hunting account, not the personal one). Closes by
    itself once the sessionid cookie appears. Alternative: cookies_file (Cookie-Editor JSON export)."""
    return await _headed_login("instagram", account, cookies_file)


@_base.mcp.tool()
async def ig_login_status(account: str = "main", wait_s: int = 0) -> dict:
    """Has the hunter finished logging in to Instagram in the window? wait_s (0-120) waits for it."""
    return await _headed_login_status("instagram", account, wait_s)
