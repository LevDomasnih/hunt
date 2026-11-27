"""hunt_telegram: setup."""
from __future__ import annotations
import asyncio
import contextlib
import json
import os
import re
import time
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
import keyring
from huntshared import config_dir
from telethon import errors
from hunttg.base import ToolError
from hunttg import base as _base, clients as _clients, entities as _entities, errors as _errors, login_page as _login_page, pacing as _pacing
# ---------------------------------------------------------------- tools: setup & login

@_base.mcp.tool()
async def tg_setup_api(api_id: int, api_hash: str, account: str = "hunt") -> dict:
    """Store Telegram API credentials (from https://my.telegram.org → API development tools) in the OS
    keychain for an account label. The first stored pair also becomes the default for other labels.
    These identify the app, not the user; still never write them into files or chats."""
    label = _base._label(account)
    if not re.fullmatch(r"[0-9a-f]{32}", (api_hash or "").strip().lower()):
        raise ToolError("api_hash must be the 32-character hex string from my.telegram.org.")
    if int(api_id) <= 0:
        raise ToolError("api_id must be a positive number.")
    val = json.dumps({"api_id": int(api_id), "api_hash": api_hash.strip().lower()})
    try:
        keyring.set_password(_base.KEYRING_SERVICE, label, val)
        default_set = False
        if not keyring.get_password(_base.KEYRING_SERVICE, "default"):
            keyring.set_password(_base.KEYRING_SERVICE, "default", val)
            default_set = True
    except Exception as e:
        raise ToolError(f"Cannot write to the OS keychain ({type(e).__name__}: {e}).")
    return {"ok": True, "account": label, "stored": f"keychain service '{_base.KEYRING_SERVICE}'", "also_default": default_set,
            "next": f"tg_login_qr(account='{label}')"}


async def _qr_loop(acc: _clients.Account, qr: Any, deadline: float) -> None:
    st = acc.login
    try:
        while time.time() < deadline:
            try:
                left = (qr.expires - _base._now()).total_seconds()
                user = await qr.wait(timeout=max(3.0, min(left, deadline - time.time())))
                acc.me = user
                st.update(state="done", error=None)
                return
            except asyncio.TimeoutError:
                if time.time() >= deadline:
                    break
                await qr.recreate()
                st["url"] = qr.url
                st["expires"] = _base._iso(qr.expires)
                st.update(_login_page.render_qr(qr.url, _base.tg_dir() / f"{acc.label}-login"))
                st["generation"] = st.get("generation", 0) + 1
        st.update(state="expired", error="Nobody scanned the QR code in time. Call tg_login_qr again.")
    except errors.SessionPasswordNeededError:
        st["state"] = "password_needed"
        st["password_url"] = await _login_page._start_password_page(acc)
    except asyncio.CancelledError:
        raise
    except Exception as e:  # noqa: BLE001
        st.update(state="error", error=f"{type(e).__name__}: {e}")
    finally:
        _clients._secure_session(acc.label)


def _login_view(acc: _clients.Account) -> dict:
    st = acc.login
    out: dict[str, Any] = {"account": acc.label, "state": st.get("state", "idle")}
    if st.get("state") == "waiting_scan":
        out.update({k: st[k] for k in ("url", "expires", "qr_png", "qr_svg", "qr_ascii") if k in st})
        out["instruction"] = ("On the phone logged into the account Hunt should use: Telegram → Settings → Devices → "
                              "Link Desktop Device, then scan the QR (show qr_ascii in a code block, or open qr_png). "
                              "The code refreshes about every 30 s; call tg_login_status to wait.")
    elif st.get("state") == "password_needed":
        out["password_url"] = st.get("password_url")
        out["instruction"] = ("This account has a two-step (cloud) password. Ask the user to open password_url in a browser "
                              "on this computer and type the password there. Do NOT ask for the password in the chat. "
                              "Then call tg_login_status.")
    elif st.get("state") == "done" and acc.me is not None:
        out["me"] = _entities.summarize(acc.me, mask_phone=True)
    if st.get("error"):
        out["error"] = st["error"]
    return out


@_base.mcp.tool()
@_errors.tg_errors
async def tg_login_qr(account: str = "hunt") -> dict:
    """Start a QR login for an account label (default "hunt", the separate hunting account).
    Returns the tg://login url, an ASCII QR (qr_ascii) and a PNG path (qr_png). The user scans it from
    Telegram on their phone (Settings → Devices → Link Desktop Device). Then call tg_login_status.
    No phone number or SMS code is needed; passwords are never asked in the chat."""
    acc = await _clients.get_account(account)
    c = acc.client
    if await c.is_user_authorized():
        acc.me = await c.get_me()
        return {"account": acc.label, "state": "done", "already_logged_in": True, "me": _entities.summarize(acc.me, mask_phone=True)}
    old = acc.login.get("task")
    if old and not old.done():
        old.cancel()
    if acc.login.get("pw_server"):
        acc.login["pw_server"].close()
    qr = await c.qr_login()
    acc.login = {"state": "waiting_scan", "url": qr.url, "expires": _base._iso(qr.expires), "generation": 0}
    acc.login.update(_login_page.render_qr(qr.url, _base.tg_dir() / f"{acc.label}-login"))
    acc.login["task"] = asyncio.create_task(_qr_loop(acc, qr, time.time() + 300))
    return _login_view(acc)


@_base.mcp.tool()
@_errors.tg_errors
async def tg_login_status(account: str = "hunt", wait_s: int = 25) -> dict:
    """Wait up to wait_s seconds for the QR login to progress and return its state:
    waiting_scan (with a fresh url/QR if it rotated), password_needed (with password_url: the user types
    the 2FA password on a local page, never in the chat), done (with `me`), expired or error."""
    acc = await _clients.get_account(account)
    st = acc.login
    if not st:
        if await acc.client.is_user_authorized():
            acc.me = acc.me or await acc.client.get_me()
            return {"account": acc.label, "state": "done", "me": _entities.summarize(acc.me, mask_phone=True)}
        return {"account": acc.label, "state": "idle", "next": "Call tg_login_qr first."}
    start_state, start_gen = st.get("state"), st.get("generation")
    end = time.time() + max(0, min(int(wait_s), 120))
    while time.time() < end and st.get("state") == start_state and st.get("generation") == start_gen:
        await asyncio.sleep(0.5)
    if st.get("state") == "done":
        _clients._secure_session(acc.label)
        for k in ("qr_png", "qr_svg"):
            if st.get(k):
                with contextlib.suppress(OSError):
                    os.unlink(st[k])
    return _login_view(acc)


@_base.mcp.tool()
@_errors.tg_errors
async def tg_status(account: str = "hunt") -> dict:
    """Who the account is logged in as (phone masked), Premium (affects folder limits), pacing state
    (sends, new chats in the last 24 h, cooldowns) and effective settings."""
    label = _base._label(account)
    out: dict[str, Any] = {"account": label, "session_file": str(_clients.session_path(label))}
    if not _clients.session_path(label).exists():
        out.update(logged_in=False, next=f"tg_setup_api then tg_login_qr(account='{label}')")
        return out
    acc = await _clients.get_account(label)
    ok = await acc.client.is_user_authorized()
    out["logged_in"] = ok
    if ok:
        acc.me = await acc.client.get_me()
        out["me"] = _entities.summarize(acc.me, mask_phone=True)
    st = _base.load_state(label)
    ts = _base._now().timestamp()
    out["pacing"] = {
        "last_send": _base._iso(datetime.fromtimestamp(st["last_send_ts"], timezone.utc)) if st.get("last_send_ts") else None,
        "new_chats_24h": sum(1 for x in st.get("new_chats", []) if x.get("ts", 0) > ts - 86400),
        "cooldown_until": _base._iso(datetime.fromtimestamp(st["cooldown_until"], timezone.utc)) if (st.get("cooldown_until") or 0) > ts else None,
        "new_chat_cooldown_until": _base._iso(datetime.fromtimestamp(st["new_chat_cooldown_until"], timezone.utc)) if (st.get("new_chat_cooldown_until") or 0) > ts else None,
    }
    out["settings"] = _base.settings_for(label)
    return out


@_base.mcp.tool()
async def tg_settings(
    account: str | None = None,
    min_send_interval_s: int | None = None,
    new_chat_interval_s: int | None = None,
    max_new_chats_per_day: int | None = None,
    quiet_start: str | None = None,
    quiet_end: str | None = None,
    quiet_tz: str | None = None,
    quiet_off: bool = False,
    folder_auto: bool | None = None,
    folder_title: str | None = None,
    read_scope: str | None = None,
) -> dict:
    """Show or change Telegram pacing and folder settings (stored in ~/.config/hunt/config.json).
    With account=None changes apply to all accounts; with a label only to that account.
    Recommended: hunting account 20 new chats/day, 120 s between new chats; personal account (folder
    mode) max 10–15/day, 180–360 s, read_scope="folder", folder_auto=true. quiet_* in the destination
    timezone, e.g. 21:00 → 08:00 Asia/Makassar. Call with no changes to just read."""
    changes: dict[str, Any] = {}
    for k, v in (("min_send_interval_s", min_send_interval_s), ("new_chat_interval_s", new_chat_interval_s),
                 ("max_new_chats_per_day", max_new_chats_per_day), ("folder_auto", folder_auto),
                 ("folder_title", folder_title), ("read_scope", read_scope)):
        if v is not None:
            changes[k] = v
    if read_scope is not None and read_scope not in ("non_contacts", "folder"):
        raise ToolError("read_scope must be 'non_contacts' or 'folder'.")
    if folder_title is not None and not (1 <= len(folder_title) <= 12):
        raise ToolError("folder_title must be 1-12 characters.")
    if quiet_off:
        changes["quiet_hours"] = None
    elif quiet_start or quiet_end or quiet_tz:
        if not (quiet_start and quiet_end):
            raise ToolError("Give both quiet_start and quiet_end (HH:MM).")
        _pacing._hm(quiet_start), _pacing._hm(quiet_end)
        if quiet_tz:
            try:
                ZoneInfo(quiet_tz)
            except (ZoneInfoNotFoundError, ValueError):
                raise ToolError(f"Unknown timezone {quiet_tz!r}.")
        changes["quiet_hours"] = {"start": quiet_start, "end": quiet_end, "tz": quiet_tz}
    label = _base._label(account) if account else None
    if changes:
        def m(cfg: dict) -> None:
            tg = cfg.setdefault("telegram", {})
            tgt = tg.setdefault("accounts", {}).setdefault(label, {}) if label else tg
            tgt.update(changes)
        _base.update_json(config_dir() / "config.json", config_dir() / ".config.lock", m)
    return {"account": label or "(all)", "changed": list(changes), "effective": _base.settings_for(label or "hunt")}
