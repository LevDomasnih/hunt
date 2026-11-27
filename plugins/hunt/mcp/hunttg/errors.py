"""hunt_telegram: errors."""
from __future__ import annotations
import asyncio
import functools
from datetime import timedelta
from telethon import errors
from hunttg.base import ToolError
from hunttg import base as _base
# ---------------------------------------------------------------- errors

def _stop(msg: str) -> ToolError:
    return ToolError("STOP: " + msg)


def tg_errors(fn):
    """Turn Telethon/network exceptions into short readable ToolErrors."""
    @functools.wraps(fn)
    async def wrapper(*a, **kw):
        try:
            return await fn(*a, **kw)
        except ToolError:
            raise
        except errors.FloodWaitError as e:
            raise _stop(f"Telegram rate limit (FLOOD_WAIT {e.seconds}s). Do not retry before "
                        f"{_base._iso(_base._now() + timedelta(seconds=e.seconds))}.")
        except errors.FrozenMethodInvalidError:
            raise _stop("this Telegram account is frozen (can only message @SpamBot). Stop all outreach and tell the user.")
        except (errors.AuthKeyUnregisteredError, errors.SessionRevokedError, errors.UserDeactivatedBanError,
                errors.AuthKeyDuplicatedError) as e:
            raise ToolError(f"The Telegram session is no longer valid ({type(e).__name__}): it was logged out, "
                            "revoked or the account is banned. Log in again with tg_login_qr.")
        except errors.RPCError as e:
            raise ToolError(f"Telegram error {type(e).__name__}: {getattr(e, 'message', e)}")
        except (ConnectionError, OSError, asyncio.TimeoutError) as e:
            raise ToolError(f"Network problem talking to Telegram ({type(e).__name__}: {e}). Retry later.")
    return wrapper
