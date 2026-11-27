"""hunt_telegram: clients."""
from __future__ import annotations
import asyncio
import contextlib
import os
import platform
from pathlib import Path
from typing import Any
from telethon import TelegramClient
from hunttg.base import ToolError
try:
    import fcntl
except ImportError:  # Windows
    fcntl = None  # type: ignore[assignment]
from hunttg import base as _base, keychain as _keychain
# ---------------------------------------------------------------- clients

class Account:
    def __init__(self, label: str, client: TelegramClient, lockfile):
        self.label = label
        self.client = client
        self.lockfile = lockfile
        self.send_lock = asyncio.Lock()
        self.me: Any = None
        self.login: dict[str, Any] = {}


_accounts: dict[str, Account] = {}
_create_lock: asyncio.Lock | None = None


def session_path(label: str) -> Path:
    return _base.tg_dir() / f"{label}.session"


def _secure_session(label: str) -> None:
    for suffix in ("", "-journal", "-wal", "-shm"):
        p = Path(str(session_path(label)) + suffix)
        if p.exists():
            with contextlib.suppress(OSError):
                os.chmod(p, 0o600)


def _take_process_lock(label: str):
    path = _base.tg_dir() / f"{label}.lock"
    f = open(path, "a+")
    if fcntl is not None:
        try:
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            f.seek(0)
            other = f.read().strip()
            f.close()
            raise ToolError(
                f"Telegram account '{label}' is already open in another Hunt process"
                f"{' (pid ' + other + ')' if other else ''}, probably another Claude Code session. "
                "Use one session at a time, or close the other one."
            )
    f.seek(0)
    f.truncate()
    f.write(str(os.getpid()))
    f.flush()
    return f


async def get_account(account: str) -> Account:
    global _create_lock
    label = _base._label(account)
    if _create_lock is None:
        _create_lock = asyncio.Lock()
    async with _create_lock:
        acc = _accounts.get(label)
        if acc is None:
            api_id, api_hash = _keychain.api_creds(label)
            lockfile = _take_process_lock(label)
            sp = session_path(label)
            if not sp.exists():
                os.close(os.open(sp, os.O_CREAT | os.O_WRONLY, 0o600))  # sqlite accepts an empty file
            client = TelegramClient(
                str(sp), api_id, api_hash,
                device_model="Hunt (Claude Code)",
                system_version=f"{platform.system()} {platform.release()}",
                app_version="hunt 0.1",
                flood_sleep_threshold=15,
            )
            acc = Account(label, client, lockfile)
            _accounts[label] = acc
        if not acc.client.is_connected():
            try:
                await acc.client.connect()
            except (OSError, ConnectionError) as e:
                raise ToolError(f"Cannot reach Telegram ({type(e).__name__}: {e}). Check the network/VPN.")
        _secure_session(label)
        return acc


async def authed(account: str) -> Account:
    acc = await get_account(account)
    if not await acc.client.is_user_authorized():
        raise ToolError(f"Telegram account '{acc.label}' is not logged in. Call tg_login_qr(account='{acc.label}').")
    if acc.me is None:
        acc.me = await acc.client.get_me()
    return acc
