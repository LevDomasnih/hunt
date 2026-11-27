"""hunt_telegram: entities."""
from __future__ import annotations
import re
from typing import Any
from telethon import TelegramClient, errors, utils
from telethon.tl import functions, types
from hunttg.base import ToolError
from hunttg import base as _base
# ---------------------------------------------------------------- entities & messages

def _mask_phone(p: str | None) -> str | None:
    if not p:
        return None
    p = p if p.startswith("+") else "+" + p
    return p[:4] + "*" * max(len(p) - 7, 0) + p[-3:]


def summarize(e: Any, mask_phone: bool = False) -> dict:
    if isinstance(e, types.User):
        name = " ".join(x for x in (e.first_name, e.last_name) if x) or None
        usernames = [u.username for u in (getattr(e, "usernames", None) or []) if getattr(u, "active", True)]
        uname = e.username or (usernames[0] if usernames else None)
        return {
            "id": e.id, "type": "bot" if e.bot else "user", "name": name, "username": uname,
            "phone": (_mask_phone(e.phone) if mask_phone else ("+" + e.phone if e.phone else None)),
            "is_contact": bool(e.contact), "mutual_contact": bool(e.mutual_contact),
            "verified": bool(e.verified), "scam": bool(e.scam), "fake": bool(e.fake), "premium": bool(e.premium),
            "deleted": bool(e.deleted), "lang_code": getattr(e, "lang_code", None),
            "peer": f"@{uname}" if uname else str(e.id),
        }
    if isinstance(e, (types.Chat, types.ChatForbidden)):
        return {"id": utils.get_peer_id(e), "type": "group", "title": getattr(e, "title", None),
                "peer": str(utils.get_peer_id(e))}
    if isinstance(e, (types.Channel, types.ChannelForbidden)):
        uname = getattr(e, "username", None)
        return {"id": utils.get_peer_id(e), "type": "supergroup" if getattr(e, "megagroup", False) else "channel",
                "title": getattr(e, "title", None), "username": uname, "scam": bool(getattr(e, "scam", False)),
                "fake": bool(getattr(e, "fake", False)), "peer": f"@{uname}" if uname else str(utils.get_peer_id(e))}
    return {"repr": type(e).__name__}


def parse_peer(peer: str | int) -> tuple[str, Any]:
    """→ ('id', int) | ('phone', '+digits') | ('username', 'name')."""
    if isinstance(peer, int):
        return "id", peer
    s = str(peer).strip()
    m = re.match(r"^(?:https?://)?(?:t\.me|telegram\.me)/(?:\+)?([A-Za-z0-9_]{3,})/?$", s)
    if m:
        return "username", m.group(1)
    if re.fullmatch(r"-?\d{5,}", s):
        return "id", int(s)
    digits = re.sub(r"[\s().-]", "", s)
    if re.fullmatch(r"\+\d{7,15}", digits):
        return "phone", digits
    s = s.lstrip("@")
    if re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{3,31}", s):
        return "username", s
    raise ToolError(f"Cannot understand peer {peer!r}: use @username, t.me/username, +phone or a numeric id.")


async def resolve_entity(c: TelegramClient, peer: str | int) -> Any:
    kind, val = parse_peer(peer)
    if kind == "id" and abs(val) in _base.SERVICE_USER_IDS:
        raise ToolError("Hunt does not read or write Telegram service chats.")
    try:
        if kind == "phone":
            try:
                return await c.get_entity(val)
            except (ValueError, TypeError):
                r = await c(functions.contacts.ResolvePhoneRequest(phone=val.lstrip("+")))
                if r.users:
                    return r.users[0]
                raise ToolError(f"No Telegram account found for {val}.")
        if kind == "id":
            try:
                return await c.get_entity(val)
            except ValueError:
                async for _ in c.iter_dialogs(limit=300):  # fills the entity cache
                    pass
                try:
                    return await c.get_entity(val)
                except ValueError:
                    raise ToolError(f"Unknown id {val}: Telegram only resolves ids we have talked to. Use @username or +phone.")
        return await c.get_entity(val)
    except errors.PhoneNotOccupiedError:
        raise ToolError(f"No Telegram account for {val} (or its owner hides the number from strangers).")
    except (errors.UsernameNotOccupiedError, errors.UsernameInvalidError):
        raise ToolError(f"No Telegram user @{val}.")
    except ValueError as ex:
        raise ToolError(f"Cannot find {peer!r} on Telegram ({ex}).")


def _media_kind(m: Any) -> str | None:
    if m.media is None or isinstance(m.media, types.MessageMediaEmpty):
        return None
    if m.photo:
        return "photo"
    if getattr(m, "video_note", None):
        return "video_note"
    if getattr(m, "gif", None):
        return "gif"
    if m.video:
        return "video"
    if m.voice:
        return "voice"
    if m.audio:
        return "audio"
    if m.sticker:
        return "sticker"
    if m.document:
        return "document"
    if isinstance(m.media, (types.MessageMediaGeo, types.MessageMediaVenue, types.MessageMediaGeoLive)):
        return "location"
    if isinstance(m.media, types.MessageMediaContact):
        return "contact"
    if isinstance(m.media, types.MessageMediaWebPage):
        return "webpage"
    if isinstance(m.media, types.MessageMediaPoll):
        return "poll"
    return "other"


def media_info(m: Any) -> dict | None:
    kind = _media_kind(m)
    if not kind:
        return None
    d: dict[str, Any] = {"type": kind}
    f = getattr(m, "file", None)
    if kind in ("photo", "video", "video_note", "gif", "voice", "audio", "sticker", "document") and f is not None:
        for k in ("name", "mime_type", "size", "duration", "width", "height"):
            v = getattr(f, k, None)
            if v:
                d["filename" if k == "name" else k] = v
    if kind == "location":
        g = getattr(m.media, "geo", None)
        if g is not None and hasattr(g, "lat"):
            d.update(lat=g.lat, lng=g.long, map_url=f"https://www.google.com/maps/search/?api=1&query={g.lat},{g.long}")
        if isinstance(m.media, types.MessageMediaVenue):
            d.update(title=m.media.title, address=m.media.address)
        if isinstance(m.media, types.MessageMediaGeoLive):
            d["live"] = True
    elif kind == "contact":
        mc = m.media
        d.update(name=" ".join(x for x in (mc.first_name, mc.last_name) if x) or None,
                 phone=("+" + mc.phone_number.lstrip("+")) if mc.phone_number else None, user_id=mc.user_id or None)
    elif kind == "webpage":
        wp = getattr(m.media, "webpage", None)
        d.update(url=getattr(wp, "url", None), title=getattr(wp, "title", None), site=getattr(wp, "site_name", None))
    elif kind == "poll":
        d["question"] = str(getattr(getattr(m.media.poll, "question", None), "text", m.media.poll.question))
    return d


def describe(m: Any, me_id: int | None, peer_id: int) -> dict:
    d: dict[str, Any] = {
        "id": m.id,
        "date": _base._iso(m.date),
        "direction": "out" if m.out else "in",
        "text": m.message or "",
        "external_id": f"tg:{me_id}:{peer_id}:{m.id}",
    }
    rt = getattr(m, "reply_to", None)
    if rt is not None and getattr(rt, "reply_to_msg_id", None):
        d["reply_to"] = rt.reply_to_msg_id
    if getattr(m, "fwd_from", None) is not None:
        d["forwarded"] = True
    if getattr(m, "edit_date", None):
        d["edited"] = _base._iso(m.edit_date)
    if getattr(m, "grouped_id", None):
        d["album"] = str(m.grouped_id)
    if isinstance(m, types.MessageService) or getattr(m, "action", None) is not None:
        d["service"] = type(m.action).__name__ if getattr(m, "action", None) else "service"
    mi = media_info(m)
    if mi:
        d["media"] = [mi]
        d["caption"] = m.message or ""
    return d
