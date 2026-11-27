"""hunt_telegram: reading."""
from __future__ import annotations
import contextlib
import re
from datetime import timedelta
from pathlib import Path
from typing import Any
from telethon import utils
from telethon.tl import types
from hunttg.base import ToolError
from hunttg import base as _base, clients as _clients, entities as _entities, errors as _errors, folders as _folders
# ---------------------------------------------------------------- tools: reading

async def _folder_peer_ids(acc: _clients.Account, title: str) -> set[int]:
    f = _folders._find_folder(await _folders._filters(acc.client), title)
    if f is None:
        return set()
    out = set()
    for p in list(f.include_peers) + list(f.pinned_peers):
        with contextlib.suppress(Exception):
            out.add(utils.get_peer_id(p))
    return out


@_base.mcp.tool()
@_errors.tg_errors
async def tg_inbox(account: str = "hunt", since: str = "24h", include_contacts: bool = False,
                   limit_dialogs: int = 100, per_dialog: int = 50) -> dict:
    """Private chats with at least one INCOMING message since `since`, with all their messages since then
    (oldest first). Read-only: does not mark anything as read.

    Args:
        since: ISO datetime/date (naive = UTC) or relative like '24h', '3d'.
        include_contacts: also include people saved in the phone's contacts (friends/family are skipped by default).
        limit_dialogs: how many most recent dialogs to scan.
        per_dialog: max messages per chat (truncated=true if more).
    Each message: id, date, direction in|out, text (caption for media), media [{type, filename, mime_type,
    size, lat/lng for locations, ...}], external_id (pass to messages_log), reply_to, album.
    In read_scope="folder" mode only chats in the Hunt folder are returned. Service chats are never read.
    """
    acc = await _clients.authed(account)
    c = acc.client
    since_dt = _base.parse_since(since) or (_base._now() - timedelta(days=1))
    sett = _base.settings_for(acc.label)
    only: set[int] | None = None
    if sett.get("read_scope") == "folder":
        only = await _folder_peer_ids(acc, sett.get("folder_title") or "Hunt")
    chats = []
    scanned = 0
    async for d in c.iter_dialogs(limit=max(1, min(int(limit_dialogs), 500))):
        scanned += 1
        if not d.is_user:
            continue
        u = d.entity
        if u.bot or u.is_self or u.id in _base.SERVICE_USER_IDS or getattr(u, "support", False):
            continue
        if not include_contacts and (u.contact or u.mutual_contact):
            continue
        if only is not None and u.id not in only:
            continue
        if d.date and d.date < since_dt:
            continue
        msgs = []
        truncated = False
        async for m in c.iter_messages(u, limit=max(1, min(int(per_dialog), 500)) + 1):
            if m.date < since_dt:
                break
            msgs.append(m)
        if len(msgs) > per_dialog:
            msgs, truncated = msgs[:per_dialog], True
        if not any(not m.out for m in msgs):
            continue
        msgs.reverse()
        chats.append({
            "peer": _entities.summarize(u), "unread": d.unread_count, "last_date": _base._iso(d.date), "truncated": truncated,
            "messages": [_entities.describe(m, acc.me.id, u.id) for m in msgs],
        })
    return {"account": acc.label, "since": _base._iso(since_dt), "dialogs_scanned": scanned, "chats": chats,
            "note": "truncated=true: call tg_history for the full thread before replying." if any(x["truncated"] for x in chats) else None}


@_base.mcp.tool()
@_errors.tg_errors
async def tg_history(account: str = "hunt", peer: str = "", limit: int = 200, before_id: int | None = None) -> dict:
    """The whole thread with one person, oldest first: texts, captions, media descriptors, locations,
    forwarded/edited flags. Always read it completely before drafting a reply (they may have sent photos,
    a location or answers you already asked for). peer: @username, t.me link, +phone or numeric id.
    For older pages pass before_id = the smallest id you have. has_more=true means older messages exist."""
    acc = await _clients.authed(account)
    c = acc.client
    e = await _entities.resolve_entity(c, peer)
    if isinstance(e, types.User) and e.id in _base.SERVICE_USER_IDS:
        raise ToolError("Hunt does not read Telegram service chats.")
    lim = max(1, min(int(limit), 1000))
    kw: dict[str, Any] = {"limit": lim}
    if before_id:
        kw["offset_id"] = int(before_id)
    msgs = [m async for m in c.iter_messages(e, **kw)]
    msgs.reverse()
    pid = utils.get_peer_id(e)
    return {"account": acc.label, "peer": _entities.summarize(e), "count": len(msgs), "has_more": len(msgs) == lim,
            "messages": [_entities.describe(m, acc.me.id, pid) for m in msgs]}


MEDIA_KINDS = ("photo", "video", "document", "voice", "audio", "video_note", "gif", "sticker")


@_base.mcp.tool()
@_errors.tg_errors
async def tg_media(account: str = "hunt", peer: str = "", out_dir: str = "", since: str | None = None,
                   kinds: list[str] | None = None, max: int = 0, direction: str = "in") -> dict:
    """Download media from one chat into out_dir (all of it by default; never stop at the first few).
    Files are named <peer>_<message id>.<ext>; files already downloaded are skipped, so re-running is cheap.

    Args:
        out_dir: local folder (created if missing), e.g. the search's photos folder.
        since: only messages after this ISO time / '3d' (default: whole chat).
        kinds: subset of photo, video, document, voice, audio, video_note, gif, sticker (default photo, video, document).
        max: stop after this many files (0 = no limit).
        direction: "in" (what they sent, default), "out" or "any".
    Album captions are copied to every file of the album. Files over media_max_mb (setting, 50) are skipped.
    """
    if not out_dir:
        raise ToolError("out_dir is required.")
    kinds = kinds or ["photo", "video", "document"]
    bad = [k for k in kinds if k not in MEDIA_KINDS]
    if bad:
        raise ToolError(f"Unknown kinds {bad}; use {MEDIA_KINDS}.")
    if direction not in ("in", "out", "any"):
        raise ToolError("direction must be in, out or any.")
    acc = await _clients.authed(account)
    c = acc.client
    e = await _entities.resolve_entity(c, peer)
    since_dt = _base.parse_since(since)
    od = Path(out_dir).expanduser()
    od.mkdir(parents=True, exist_ok=True)
    max_bytes = float(_base.settings_for(acc.label).get("media_max_mb") or 50) * 1024 * 1024
    slug = re.sub(r"[^A-Za-z0-9_-]", "", (getattr(e, "username", None) or str(utils.get_peer_id(e))))[:40]
    picked = []
    album_caption: dict[int, str] = {}
    async for m in c.iter_messages(e, limit=None):
        if since_dt and m.date < since_dt:
            break
        if m.grouped_id and m.message:
            album_caption.setdefault(m.grouped_id, m.message)
        if direction == "in" and m.out or direction == "out" and not m.out:
            continue
        k = _entities._media_kind(m)
        if k in kinds:
            picked.append((m, k))
    picked.reverse()
    files, skipped = [], []
    for m, k in picked:
        if max and len(files) >= max:
            break
        size = getattr(m.file, "size", 0) or 0
        if size > max_bytes:
            skipped.append({"message_id": m.id, "kind": k, "size": size, "why": "too big"})
            continue
        ext = getattr(m.file, "ext", None) or ""
        target = od / f"{slug}_{m.id}{ext}"
        existed = target.exists() and target.stat().st_size > 0
        if not existed:
            got = await c.download_media(m, file=str(target))
            target = Path(got) if got else target
        files.append({"message_id": m.id, "date": _base._iso(m.date), "kind": k, "path": str(target), "size": size or None,
                      "caption": m.message or album_caption.get(m.grouped_id or 0, ""), "album": str(m.grouped_id) if m.grouped_id else None,
                      "already_had": existed})
    return {"account": acc.label, "peer": _entities.summarize(e), "out_dir": str(od), "count": len(files), "files": files,
            "skipped": skipped, "more_available": bool(max) and len(picked) > len(files) + len(skipped)}


def parse_post_link(link: str) -> tuple[str | int, int]:
    """t.me/<username>/<id>, t.me/<username>/<topic>/<id>, t.me/c/<internal id>/<id> (+ ?single etc.) → (peer, message id)."""
    s = str(link or "").strip()
    m = re.match(r"^(?:https?://)?(?:t\.me|telegram\.me)/(?:s/)?(c/\d+|[A-Za-z][A-Za-z0-9_]{3,31})/(?:\d+/)?(\d+)/?(?:\?.*)?$", s)
    if not m:
        raise ToolError(f"Not a Telegram post link: {link!r}. Use https://t.me/<channel>/<id> or https://t.me/c/<id>/<msg>.")
    who, mid = m.group(1), int(m.group(2))
    return (int("-100" + who[2:]) if who.startswith("c/") else who), mid


def _who(e: Any) -> dict | None:
    if e is None:
        return None
    d = _entities.summarize(e)
    return {k: d.get(k) for k in ("id", "type", "name", "title", "username") if d.get(k) is not None}


@_base.mcp.tool()
@_errors.tg_errors
async def tg_post_media(link: str, out_dir: str, account: str = "hunt", include_video_thumbs: bool = False) -> dict:
    """READ ONLY: download the photos of ONE Telegram post (and every photo of its album) into out_dir, e.g. to pick an
    event photo. link: https://t.me/<channel>/<id> (public channels/groups are read without joining) or
    https://t.me/c/<id>/<msg> (only chats the account is already in). Never joins, posts or reacts.

    Returns {peer, post: {id, date, text, author, forwarded_from, link}, files: [{message_id, path, width, height, size,
    kind}], skipped}. `author` is who posted it in the chat (a channel's own post, or a user in a group);
    `forwarded_from` the original channel/user of a repost. Use them to judge rights: only images published by the
    organizer or venue to promote that event or place are usable (credit + link to the post); skip random users' photos
    and stock. Images in documents (uncompressed) are included; videos are skipped (their thumbnail with
    include_video_thumbs=true)."""
    if not out_dir:
        raise ToolError("out_dir is required.")
    peer, mid = parse_post_link(link)
    acc = await _clients.authed(account)
    c = acc.client
    e = await _entities.resolve_entity(c, peer)
    first = await c.get_messages(e, ids=mid)
    if first is None:
        raise ToolError(f"Message {mid} not found in {_entities.summarize(e).get('peer')} (deleted, or the chat is not readable).")
    msgs = [first]
    if first.grouped_id:
        near = await c.get_messages(e, ids=list(range(max(1, mid - 10), mid + 11)))
        msgs = sorted([m for m in near if m is not None and m.grouped_id == first.grouped_id], key=lambda m: m.id)
    od = Path(out_dir).expanduser()
    od.mkdir(parents=True, exist_ok=True)
    max_bytes = float(_base.settings_for(acc.label).get("media_max_mb") or 50) * 1024 * 1024
    slug = re.sub(r"[^A-Za-z0-9_-]", "", (getattr(e, "username", None) or str(utils.get_peer_id(e))))[:40]
    files, skipped = [], []
    for m in msgs:
        k = _entities._media_kind(m)
        is_img_doc = k == "document" and str(getattr(m.file, "mime_type", "") or "").startswith("image/")
        if k not in ("photo",) and not is_img_doc and not (include_video_thumbs and k == "video"):
            if k:
                skipped.append({"message_id": m.id, "kind": k, "why": "not a photo"})
            continue
        size = getattr(m.file, "size", 0) or 0
        if size > max_bytes:
            skipped.append({"message_id": m.id, "kind": k, "size": size, "why": "too big"})
            continue
        if k == "video":
            target = od / f"{slug}_{m.id}_thumb.jpg"
            if not (target.exists() and target.stat().st_size > 0):
                got = await c.download_media(m, file=str(target), thumb=-1)
                target = Path(got) if got else target
        else:
            target = od / f"{slug}_{m.id}{getattr(m.file, 'ext', None) or '.jpg'}"
            if not (target.exists() and target.stat().st_size > 0):
                got = await c.download_media(m, file=str(target))
                target = Path(got) if got else target
        files.append({"message_id": m.id, "path": str(target), "kind": "video_thumb" if k == "video" else k,
                      "width": getattr(m.file, "width", None), "height": getattr(m.file, "height", None), "size": size or None})
    author = None
    with contextlib.suppress(Exception):
        author = _who(await first.get_sender()) if first.sender_id else _who(e)
    fwd = None
    ff = getattr(first, "fwd_from", None)
    if ff is not None:
        fwd = {"name": getattr(ff, "from_name", None), "post_id": getattr(ff, "channel_post", None)}
        if getattr(ff, "from_id", None) is not None:
            with contextlib.suppress(Exception):
                fwd.update(_who(await c.get_entity(ff.from_id)) or {})
        if fwd.get("username") and fwd.get("post_id"):
            fwd["link"] = f"https://t.me/{fwd['username']}/{fwd['post_id']}"
    text = next((m.message for m in msgs if m.message), "")
    uname = getattr(e, "username", None)
    return {"account": acc.label, "peer": _entities.summarize(e),
            "post": {"id": mid, "date": _base._iso(first.date), "text": text, "author": author, "forwarded_from": fwd,
                     "album": str(first.grouped_id) if first.grouped_id else None,
                     "link": f"https://t.me/{uname}/{mid}" if uname else str(link)},
            "out_dir": str(od), "count": len(files), "files": files, "skipped": skipped}


@_base.mcp.tool()
@_errors.tg_errors
async def tg_resolve(account: str = "hunt", query: str = "") -> dict:
    """Look up a person/group by @username, t.me link, +phone or numeric id and summarize it:
    type, name, username, is_contact, scam/fake flags, and `peer` to use in other tools.
    Phone lookups only work if the owner allows being found by number; many lookups in a row can hit
    Telegram limits, so resolve only numbers you are about to contact."""
    acc = await _clients.authed(account)
    e = await _entities.resolve_entity(acc.client, query)
    out = _entities.summarize(e)
    with contextlib.suppress(Exception):
        last = [m async for m in acc.client.iter_messages(e, limit=1)]
        out["has_chat"] = bool(last)
        out["last_message_date"] = _base._iso(last[0].date) if last else None
    return out
