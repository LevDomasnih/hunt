"""hunt_telegram: folders."""
from __future__ import annotations
from typing import Any
from telethon import TelegramClient, utils
from telethon.tl import functions, types
from hunttg.base import ToolError
from hunttg import clients as _clients
# ---------------------------------------------------------------- folders (pure helpers unit-tested)

def _title_text(f: Any) -> str:
    t = getattr(f, "title", "")
    return getattr(t, "text", t) or ""


def make_title(title: str) -> Any:
    if hasattr(types, "TextWithEntities"):
        return types.TextWithEntities(text=title, entities=[])
    return title


def _pkey(ip: Any) -> str:
    if isinstance(ip, types.InputPeerSelf):
        return "self"
    try:
        return str(utils.get_peer_id(ip))
    except (TypeError, ValueError):
        return repr(ip)


def folder_limit(premium: bool) -> int:
    return 200 if premium else 100


def add_peer_to_filter(f: Any, ip: Any, premium: bool) -> str:
    """Append ip to f.include_peers. Returns 'added' | 'already'. Drops a lone self placeholder."""
    keys = {_pkey(p) for p in list(f.include_peers) + list(f.pinned_peers)}
    if _pkey(ip) in keys:
        return "already"
    inc = [p for p in f.include_peers if not isinstance(p, types.InputPeerSelf)]
    if len(inc) + len(f.pinned_peers) + 1 > folder_limit(premium):
        raise ToolError(
            f"Folder '{_title_text(f)}' is full ({folder_limit(premium)} chats max{'' if premium else ' without Premium'}). "
            "Remove dead leads with tg_folder_remove first."
        )
    f.include_peers = inc + [ip]
    return "added"


def remove_peer_from_filter(f: Any, ip: Any) -> str:
    k = _pkey(ip)
    before = len(f.include_peers) + len(f.pinned_peers)
    f.include_peers = [p for p in f.include_peers if _pkey(p) != k]
    f.pinned_peers = [p for p in f.pinned_peers if _pkey(p) != k]
    if len(f.include_peers) + len(f.pinned_peers) == before:
        return "absent"
    if not f.include_peers and not f.pinned_peers:
        f.include_peers = [types.InputPeerSelf()]  # a folder cannot be empty
    return "removed"


def free_filter_id(filters: list) -> int:
    used = {getattr(f, "id", None) for f in filters}
    i = 2  # 0 and 1 are reserved (All chats, Archive)
    while i in used:
        i += 1
    return i


async def _filters(c: TelegramClient) -> list:
    r = await c(functions.messages.GetDialogFiltersRequest())
    return list(getattr(r, "filters", r))


def _find_folder(filters: list, title: str) -> Any:
    for f in filters:
        if isinstance(f, types.DialogFilter) and _title_text(f).casefold() == title.casefold():
            return f
    return None


async def _ensure_folder(acc: _clients.Account, title: str, seed: list | None = None) -> tuple[Any, bool]:
    c = acc.client
    if not title or len(title) > 12:
        raise ToolError("Folder title must be 1-12 characters.")
    filters = await _filters(c)
    f = _find_folder(filters, title)
    if f is not None:
        return f, False
    premium = bool(getattr(acc.me, "premium", False))
    count = sum(1 for x in filters if isinstance(x, (types.DialogFilter, types.DialogFilterChatlist)))
    if count >= (30 if premium else 10):
        raise ToolError(f"This account already has {count} folders (limit {30 if premium else 10}). Delete one in Telegram first.")
    fid = free_filter_id(filters)
    f = types.DialogFilter(id=fid, title=make_title(title), pinned_peers=[],
                           include_peers=list(seed) if seed else [types.InputPeerSelf()], exclude_peers=[])
    await c(functions.messages.UpdateDialogFilterRequest(id=fid, filter=f))
    return f, True


async def folder_add(acc: _clients.Account, entity: Any, title: str) -> dict:
    ip = await acc.client.get_input_entity(entity)
    f, created = await _ensure_folder(acc, title, seed=[ip])
    if created:
        return {"folder": title, "folder_id": f.id, "result": "added", "created": True}
    res = add_peer_to_filter(f, ip, bool(getattr(acc.me, "premium", False)))
    if res == "added":
        await acc.client(functions.messages.UpdateDialogFilterRequest(id=f.id, filter=f))
    return {"folder": title, "folder_id": f.id, "result": res, "chats": len(f.include_peers) + len(f.pinned_peers)}
