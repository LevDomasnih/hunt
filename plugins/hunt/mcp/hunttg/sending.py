"""hunt_telegram: sending."""
from __future__ import annotations
import asyncio
from datetime import datetime, timezone
from typing import Any
from telethon import errors, utils
from telethon.tl import functions, types
from hunttg.base import ToolError
from hunttg import base as _base, clients as _clients, entities as _entities, errors as _errors, folders as _folders, pacing as _pacing
# ---------------------------------------------------------------- tools: sending & folders

@_base.mcp.tool()
@_errors.tg_errors
async def tg_send(account: str = "hunt", peer: str = "", text: str = "", reply_to: int | None = None,
                  allow_duplicate: bool = False) -> dict:
    """Send one message, with safety guards. Only send text the owner approved (draft final_text), then
    draft_mark the draft and messages_log the result.

    Guards: min seconds between sends (waits automatically up to 90 s), min gap between first messages
    to new people, max new chats per rolling 24 h, quiet hours, cooldowns after Telegram limits, and no
    identical resend to the same chat within duplicate_window_h. On FLOOD_WAIT / PEER_FLOOD / frozen
    the tool returns a STOP message and records a cooldown: stop outreach on this account and tell the user.
    New chats are added to the Hunt folder when folder_auto is on.
    Returns {sent, message_id, date, new_chat, external_id, folder?}.
    """
    if not text.strip():
        raise ToolError("text is empty.")
    if len(text) > 4096:
        raise ToolError("Telegram messages are limited to 4096 characters; split it.")
    acc = await _clients.authed(account)
    c = acc.client
    async with acc.send_lock:
        e = await _entities.resolve_entity(c, peer)
        if isinstance(e, types.User) and (e.id in _base.SERVICE_USER_IDS or e.is_self):
            raise ToolError("Refusing to send to a service chat or to yourself.")
        sett = _base.settings_for(acc.label)
        recent = [m async for m in c.iter_messages(e, limit=30)]
        new_chat = not recent
        win = float(sett.get("duplicate_window_h") or 0) * 3600
        if not allow_duplicate and win:
            for m in recent:
                if m.out and (m.message or "").strip() == text.strip() and (_base._now() - m.date).total_seconds() < win:
                    return {"sent": False, "duplicate": True, "message_id": m.id, "date": _base._iso(m.date),
                            "note": "The same text was already sent to this chat recently; not sent again."}
        decision = _pacing.pacing_check(_base.load_state(acc.label), sett, _base._now(), new_chat)
        if not decision["ok"]:
            raise ToolError(decision["reason"])
        if decision.get("wait_s"):
            await asyncio.sleep(decision["wait_s"])
        pid = utils.get_peer_id(e)
        try:
            msg = await c.send_message(e, text, reply_to=reply_to)
        except errors.FloodWaitError as ex:
            secs = ex.seconds
            until = _base._now().timestamp() + secs
            _base.update_state(acc.label, lambda s: s.update(cooldown_until=until, cooldown_reason=f"FLOOD_WAIT {secs}s"))
            raise _errors._stop(f"Telegram rate limit (FLOOD_WAIT {secs}s). Nothing was sent. No sends from '{acc.label}' "
                        f"before {_base._iso(datetime.fromtimestamp(until, timezone.utc))}.")
        except errors.PeerFloodError:
            until = _base._now().timestamp() + 24 * 3600
            _base.update_state(acc.label, lambda s: s.update(new_chat_cooldown_until=until, new_chat_cooldown_reason="PEER_FLOOD"))
            raise _errors._stop("Telegram limited this account for messaging new people (PEER_FLOOD). Nothing was sent. "
                        "Stop all new outreach for 24-72 h, keep only existing chats, tell the user, and let them "
                        "check @SpamBot. Do not retry.")
        except errors.UserPrivacyRestrictedError:
            raise ToolError("This person's privacy settings do not allow messages from strangers. Use another channel.")
        except (errors.UserIsBlockedError, errors.YouBlockedUserError):
            raise ToolError("Blocked (by them or by you). Do not retry; use another channel if appropriate.")
        except errors.InputUserDeactivatedError:
            raise ToolError("This Telegram account was deleted.")
        except (errors.ChatWriteForbiddenError, errors.UserRestrictedError) as ex:
            raise ToolError(f"Cannot write here ({type(ex).__name__}).")
        now_ts = _base._now().timestamp()

        def rec(s: dict) -> None:
            s["last_send_ts"] = now_ts
            s["sends"] = [x for x in s.get("sends", []) if x > now_ts - 86400] + [now_ts]
            if new_chat:
                s["new_chats"] = [x for x in s.get("new_chats", []) if x.get("ts", 0) > now_ts - 86400] + [{"ts": now_ts, "peer": pid}]
        _base.update_state(acc.label, rec)
        out: dict[str, Any] = {"sent": True, "message_id": msg.id, "date": _base._iso(msg.date), "peer": _entities.summarize(e),
                               "new_chat": new_chat, "external_id": f"tg:{acc.me.id}:{pid}:{msg.id}"}
        if decision.get("wait_s"):
            out["waited_s"] = round(decision["wait_s"], 1)
        if new_chat and sett.get("folder_auto"):
            try:
                out["folder"] = await _folders.folder_add(acc, e, sett.get("folder_title") or "Hunt")
            except Exception as ex:  # noqa: BLE001 - message was sent; folder is best effort
                out["folder_warning"] = f"Sent, but not added to the folder: {ex}"
        return out


@_base.mcp.tool()
@_errors.tg_errors
async def tg_folder_ensure(account: str = "hunt", title: str = "Hunt") -> dict:
    """Make sure a chat folder (filter) with this title exists and return its id and size.
    A new folder must contain at least one chat, so it starts with Saved Messages as a placeholder that
    disappears when the first real chat is added. Limits: 10 folders / 100 chats per folder (Premium 30 / 200)."""
    acc = await _clients.authed(account)
    f, created = await _folders._ensure_folder(acc, title)
    premium = bool(getattr(acc.me, "premium", False))
    n = len([p for p in f.include_peers if not isinstance(p, types.InputPeerSelf)]) + len(f.pinned_peers)
    return {"folder": _folders._title_text(f), "folder_id": f.id, "created": created, "chats": n, "limit": _folders.folder_limit(premium)}


@_base.mcp.tool()
@_errors.tg_errors
async def tg_folder_add(account: str = "hunt", peer: str = "", title: str = "Hunt") -> dict:
    """Add a chat to the folder (creates the folder if needed). Reads the folder, appends the peer and
    writes it back; respects the 100 (Premium 200) chats limit."""
    acc = await _clients.authed(account)
    e = await _entities.resolve_entity(acc.client, peer)
    return {**await _folders.folder_add(acc, e, title), "peer": _entities.summarize(e)}


@_base.mcp.tool()
@_errors.tg_errors
async def tg_folder_remove(account: str = "hunt", peer: str = "", title: str = "Hunt") -> dict:
    """Remove a chat from the folder (for dead leads, to stay under the folder limit). The chat itself
    is not deleted or archived."""
    acc = await _clients.authed(account)
    e = await _entities.resolve_entity(acc.client, peer)
    f = _folders._find_folder(await _folders._filters(acc.client), title)
    if f is None:
        raise ToolError(f"No folder named {title!r}.")
    ip = await acc.client.get_input_entity(e)
    res = _folders.remove_peer_from_filter(f, ip)
    if res == "removed":
        await acc.client(functions.messages.UpdateDialogFilterRequest(id=f.id, filter=f))
    return {"folder": title, "folder_id": f.id, "result": res, "peer": _entities.summarize(e)}
