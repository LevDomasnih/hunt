"""hunt_browser: login."""
from __future__ import annotations
import asyncio
import time
from typing import Any
from huntbrowser.base import ToolError
from huntbrowser import base as _base, messenger as _messenger, session as _session
# ---------------------------------------------------------------- headed login for Messenger / Instagram

LOGIN_URLS = {"messenger": _base.FB + "/messages/t/", "instagram": _base.IG + "/accounts/login/"}
LOGIN_COOKIES = {"messenger": (_base.FB, "c_user"), "instagram": (_base.IG, "sessionid")}
COOKIE_DOMAINS = {"messenger": ("facebook.com", "messenger.com"), "instagram": ("instagram.com",)}


async def headed_login_watch(sess: _session.Session, minutes: float = 15.0) -> None:
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
                    st = await _session.safe_eval(pg, _messenger.FB_STATE_JS, None, {"state": "ok"}) or {"state": "ok"}
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
