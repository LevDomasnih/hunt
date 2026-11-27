"""hunt_browser: session."""
from __future__ import annotations
import asyncio
import contextlib
from pathlib import Path
from typing import Any
from huntbrowser.base import ToolError
from playwright.async_api import BrowserContext, Page, async_playwright
from playwright.async_api import Error as PWError
from huntbrowser import base as _base, chromium as _chromium
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
        return _base.profile_dir(self.channel, self.account)

    def alive(self) -> bool:
        return self.ctx is not None

    async def start(self, headed: bool = False) -> BrowserContext:
        if self.ctx is not None and self.headed == headed:
            return self.ctx
        await self.close()
        found = _chromium.find_chromium()
        exe = found["full"] or (found["shell"] if not headed else None)
        if not exe:
            raise ToolError(_chromium.chromium_missing_message(found["root"]))
        bc = _base.browser_config()
        locale = bc.get("locale") or "en-US"  # English UI keeps the selectors' text checks stable
        kw: dict[str, Any] = dict(
            executable_path=exe,
            headless=not headed,
            locale=locale,
            user_agent=_chromium.user_agent(found["version"]),
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
    key = (channel, _base.check_account(account))
    if key not in SESSIONS:
        SESSIONS[key] = Session(*key)
    return SESSIONS[key]


async def safe_eval(page: Page, js: str, arg: Any = None, default: Any = None) -> Any:
    """page.evaluate that survives navigations/reloads (returns default instead of raising)."""
    try:
        return await page.evaluate(js, arg)
    except PWError:
        return default
