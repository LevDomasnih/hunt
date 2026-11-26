"""Hunt core: registry (split from hunt_core.py)."""
from __future__ import annotations
import asyncio
import contextlib
import html
import io
import json
import logging
import math
import mimetypes
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import xml.etree.ElementTree as ET
from collections import Counter
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, quote, unquote, unquote_plus, urlencode, urlparse
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
import httpx
import keyring
import yaml
try:  # mcp 1.x
    from mcp.server.fastmcp import FastMCP
    from mcp.server.fastmcp.exceptions import ToolError
except ImportError:  # mcp 2.x renamed FastMCP to MCPServer
    from mcp.server.mcpserver import MCPServer as FastMCP
    from mcp.server.mcpserver.exceptions import ToolError
try:
    import fcntl
except ImportError:  # Windows: no file locking, writes are still atomic
    fcntl = None  # type: ignore[assignment]
from huntcore import base as _base, packs as _packs
# ---------------------------------------------------------------- sources registry

SOURCE_SECTIONS = ("portals", "telegram", "facebook_groups", "whatsapp_communities", "instagram", "line", "agencies", "official", "guides", "post_request_where")
_REGISTRY: dict[str, tuple[float, dict]] = {}  # country -> (time, answer); refreshed after 10 minutes


def _source_key(e: Any) -> str:
    if isinstance(e, str):
        return e.lower()
    v = next((e.get(k) for k in ("handle", "url", "name", "text", "note") if e.get(k)), "")
    return re.sub(r"^https?://(www\.)?", "", str(v).lower()).rstrip("/")


async def _with_registry(path: str, doc: dict) -> dict:
    """The pack's sources.yaml plus the registry's approved entries. Never fails: without the registry the pack's list is returned."""
    country = path.strip("/").split("/")[0]
    hit = _REGISTRY.get(country)
    if not hit or time.monotonic() - hit[0] > 600:
        try:
            hit = (time.monotonic(), await _base.api("GET", "/api/sources", params={"country": country}, timeout=12))
        except ToolError as e:
            off = "sources_off" in str(e) or "not connected" in str(e) or "No agent token" in str(e)
            return {**doc, "registry": "off" if off else f"unavailable: {str(e)[:160]}"}
        _REGISTRY[country] = hit
    reg = hit[1]
    try:
        base = yaml.safe_load(doc["content"]) or {}
    except (KeyError, yaml.YAMLError):
        return {**doc, "registry": "unavailable: the pack file cannot be parsed"}
    merged: dict[str, Any] = {k: v for k, v in base.items() if k not in SOURCE_SECTIONS}
    for s in SOURCE_SECTIONS:
        own = base.get(s)
        own = [own] if isinstance(own, dict) else list(own or [])
        items, seen = [], set()
        # The registry's entry (with its id, for source_report) wins over the pack's short one.
        for e in list((reg.get("sections") or {}).get(s) or []) + own:
            k = _source_key(e)
            if k in seen:
                continue
            seen.add(k)
            items.append(e["text"] if isinstance(e, dict) and set(e) <= {"id", "text"} and "text" in e else e)
        if items:
            merged[s] = items
    return {**doc, "content": yaml.safe_dump(merged, allow_unicode=True, sort_keys=False, width=1000), "registry": {"count": reg.get("count"), "updated_at": reg.get("updated_at")}}


@_base.mcp.tool()
async def source_suggest(country: str, section: str, entry: dict) -> dict:
    """Suggest a listing source for everyone (a public chat, group, portal or agency site the hunter found useful). An admin of the
    registry approves it. Only public places: no people, phone numbers or private invite links of somebody's chat.
    section: portals | telegram | facebook_groups | whatsapp_communities | instagram | line | agencies | official | guides.
    entry: {handle: "@name"} for Telegram, else {name, url}, plus title, cities: [], lang, note (short, what it is good for)."""
    if section not in SOURCE_SECTIONS:
        raise ToolError(f"section must be one of {', '.join(SOURCE_SECTIONS)}.")
    return await _base.api("POST", "/api/sources/suggest", body={"country": country, "section": section, "entry": entry})


SHARE_EXT = (".yaml", ".md", ".geojson", ".svg")
_SHARE_PRIVATE = ("telegram", "facebook_groups", "whatsapp_communities", "instagram", "line")  # kept in the registry, not in the data repository
_SHARE_LOOK = [
    ("a phone number", re.compile(r"(?:\+|00)\d[\d ()-]{8,}\d|wa\.me/"), ("emergency.yaml", "places.yaml", "events.yaml")),
    ("an e-mail", re.compile(r"[\w.+-]+@[\w-]+\.[a-z]{2,}", re.I), ()),
    ("a nickname", re.compile(r"(?:^|[\s\"'(\[,])@[A-Za-z][A-Za-z0-9_]{4,31}\b", re.M), ("useful.yaml", "events.yaml")),
    ("a secret", re.compile(r"hunt_[A-Za-z0-9_-]{16,}|sk-ant-|\b(?:api[_ -]?key|access token|seed phrase)\b", re.I), ()),
    ("a hidden comment", re.compile(r"<!--"), ()),
]


def _share_sources(text: str, base: str | None) -> tuple[str | None, list[dict], int]:
    """sources.yaml → (the public part for the data repository, or None if it did not change; new entries for the registry; skipped)."""
    cur, old = (yaml.safe_load(text) or {}), (yaml.safe_load(base or "") or {})
    ident = lambda e: json.dumps({k: e.get(k) for k in ("handle", "url", "name")}, sort_keys=True).lower() if isinstance(e, dict) else str(e)
    out, skipped = [], 0
    for sec in _SHARE_PRIVATE:
        known = {ident(e) for e in (old.get(sec) or []) if isinstance(old.get(sec), list)}
        for e in cur.get(sec) or [] if isinstance(cur.get(sec), list) else []:
            if not isinstance(e, dict) or ident(e) in known:
                continue
            clean = {k: v for k, v in e.items() if k in ("handle", "name", "title", "url", "cities", "lang", "type", "note", "events")}
            if not (clean.get("handle") or clean.get("url")) or re.search(r"(?:\+|wa\.me/)\s?\d[\d ()-]{7,}|t\.me/(?:\+|joinchat)", json.dumps(clean, ensure_ascii=False)):
                skipped += 1
                continue
            out.append({"section": sec, "entry": _packs.jsonable(clean)})
    pub = {k: v for k, v in cur.items() if k not in _SHARE_PRIVATE and k != "post_request_where"}
    for sec in ("portals", "agencies", "official"):
        if isinstance(pub.get(sec), list):
            pub[sec] = [{k: v for k, v in e.items() if k not in ("contact", "note")} if isinstance(e, dict) else e for e in pub[sec]]
    was = {k: v for k, v in old.items() if k not in _SHARE_PRIVATE and k != "post_request_where"}
    changed = _packs.jsonable(pub) != _packs.jsonable({k: ([{a: b for a, b in e.items() if a not in ("contact", "note")} if isinstance(e, dict) else e for e in v] if isinstance(v, list) else v) for k, v in was.items()})
    return (yaml.safe_dump(_packs.jsonable(pub), allow_unicode=True, sort_keys=False, width=1000) if pub and changed else None), out, skipped


def _share_bundle(country: str, folder: Path | None) -> dict:
    """What a share of this country would send: only text files that differ from the installed catalogue."""
    inst = _packs.packs_dir()
    root = folder if folder else inst
    reg = root / "regions" / country if (root / "regions").is_dir() else root / country if (root / country / "pack.yaml").is_file() else root
    if not (reg / "pack.yaml").is_file() or reg.name != country:
        raise ToolError(f"No pack.yaml of {country!r} in {root}: give the folder that has regions/{country}/.")
    git = (inst / ".git").exists()
    files, sources, skipped, look = [], [], 0, []
    for p in sorted(reg.rglob("*")):
        rel = f"regions/{country}/{p.relative_to(reg).as_posix()}"
        if not p.is_file() or p.is_symlink() or p.suffix not in SHARE_EXT:
            continue
        raw = p.read_bytes()
        base = _packs._base_text(inst, rel) if git else None
        if base == raw:
            continue
        text = raw.decode("utf-8")
        if p.name == "sources.yaml":
            pub, sources, skipped = _share_sources(text, base.decode("utf-8") if base else None)
            if pub is None:
                continue
            text = pub
        if p.suffix in (".yaml", ".md"):
            for what, rx, fine in _SHARE_LOOK:
                if p.name in fine:
                    continue
                for n, ln in enumerate(text.split("\n"), 1):
                    if rx.search(ln):
                        look.append(f"{rel}:{n}: {what}: {ln.strip()[:100]}")
        files.append({"path": rel, "content": text})
    return {"files": files, "sources": sources, "skipped": skipped, "look": look[:40], "base": _packs._git("rev-parse", "--short", "HEAD", cwd=inst) if git else None}


@_base.mcp.tool()
async def pack_share(country: str, title: str, note: str = "", author: str | None = None, folder: str | None = None, looked: bool = False, hunter_asked: bool = False) -> dict:
    """Offer the hunter's new city, or a correction of an existing pack, to everyone (a pull request through the bot). It only asks:
    the hunter gets a card in the bot with the full text of what would go, and nothing leaves their server before they press the
    button. Then the catalogue's admin decides. Call it yourself when a pack is finished or a fact was really checked (skill
    hunt-region, "Sharing"); never press for a yes.
    Only the pack's text files that differ from the catalogue are in it; homes, chats, people and money never are.
    country: pack slug. title: short, in the hunter's language ("Сербия: Белград и Нови-Сад"). note: what is new and how it was checked,
    one or two lines, no private details. author: a nickname only if the hunter wants one shown. folder: where the pack is, if it
    is not the installed one. hunter_asked: True only when the hunter asked to share in their own words (an earlier no no longer counts;
    the card still asks). looked: True after you read every line of "look" and removed what should not be public."""
    c = (country or "").strip().lower()
    if not re.fullmatch(r"[a-z]{2,20}", c):
        raise ToolError("country is a pack slug such as 'rs' or 'bali'.")
    b = _share_bundle(c, Path(folder).expanduser() if folder else None)
    if not b["files"] and not b["sources"]:
        return {"status": "nothing_new", "message": "This pack is the same as in the catalogue."}
    if b["look"] and not looked:
        return {"status": "look_first", "look": b["look"], "message": "Read these lines: remove private things (people's contacts, e-mails, secrets, hidden comments), keep public ones (a company's number, an official line), then call again with looked=True. Nothing was shown to the hunter yet."}
    r = await _base.api("POST", "/api/shares", body={"country": c, "title": title, "note": note, "author": author, "hunter_asked": hunter_asked, "base": b["base"], "files": b["files"], "sources": b["sources"]})
    if b["skipped"]:
        r["not_included"] = f"{b['skipped']} sources with personal contacts or private invites"
    return r


@_base.mcp.tool()
async def pack_shares() -> dict:
    """What the hunter was asked to share and how it went: asked | declined | off | sent | returned (with the admin's comment) | rejected |
    approved | merged. returned: fix what the comment says and call pack_share again."""
    return await _base.api("GET", "/api/shares")


@_base.mcp.tool()
async def source_report(source_id: str, kind: str) -> dict:
    """Report a registry source (the `id` of an entry in region_doc sources.yaml). kind: dead (closed, no posts) | spam | ok."""
    if kind not in ("dead", "spam", "ok"):
        raise ToolError("kind must be dead, spam or ok.")
    return await _base.api("POST", "/api/sources/report", body={"id": source_id, "kind": kind})
