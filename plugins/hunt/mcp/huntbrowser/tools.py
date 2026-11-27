"""hunt_browser: tools."""
from __future__ import annotations
import contextlib
from huntbrowser.base import ToolError
from playwright.async_api import Error as PWError
from huntbrowser import instagram as _instagram, messenger as _messenger, pacing as _pacing, session as _session, whatsapp as _whatsapp
# ---------------------------------------------------------------- tool plumbing

WAPP, MSGR, INSTA = _whatsapp.WhatsApp(), _messenger.Messenger(), _instagram.Instagram()


async def run(channel: str, account: str, fn, *, need_lock: bool = True):
    """Run fn(sess, page) on the session page; login/crash errors become clear tool errors."""
    sess = _session.session(channel, account)
    if sess.headed:
        raise ToolError(f"A login window for {channel}/{sess.account} is open. Finish logging in there (or close it), "
                        f"then retry. Check with {channel[:2] if channel != 'messenger' else 'fb'}_login_status.")
    for attempt in (1, 2):
        try:
            async with (sess.lock if need_lock else contextlib.nullcontext()):
                page = await sess.page()
                return await fn(sess, page)
        except _session.LoginNeeded as e:
            raise ToolError(f"login needed: {e}") from e
        except _pacing.Paced as p:
            return p.result()
        except PWError as e:
            msg = str(e)
            closed = "closed" in msg.lower() or "crash" in msg.lower() or "Target" in msg
            if closed and attempt == 1 and not getattr(fn, "is_send", False):
                await sess.close()  # browser/page died: relaunch once for read-only work
                continue
            if closed:
                await sess.close()
            raise ToolError(f"{channel} browser error: {msg.splitlines()[0][:300]}") from e


def send_fn(fn):
    fn.is_send = True  # never auto-retried
    return fn


def _limit(n: int, lo: int = 1, hi: int = 2000) -> int:
    return max(lo, min(int(n or lo), hi))


def _text_arg(text: str) -> str:
    if not (text or "").strip():
        raise ToolError("text is empty")
    if len(text) > 4000:
        raise ToolError("text is longer than 4000 characters; split it")
    return text
