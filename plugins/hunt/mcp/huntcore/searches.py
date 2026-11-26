"""Hunt core: searches (split from hunt_core.py)."""
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
# ---------------------------------------------------------------- searches

@_base.mcp.tool()
async def search_create(title: str, region: str, brief: dict | None = None, approval_mode: str = "ask") -> dict:
    """Create a search (one house hunt).

    Args:
        title: short human title, e.g. "Bukit, Nov 2026".
        region: region pack path, e.g. "bali/bukit", "th/phuket" (see region_list).
        brief: the search brief (budget, dates, bedrooms, must-haves, answers to pack brief_questions).
        approval_mode: "ask" (every outgoing message is approved by the owner in Telegram) or
            "routine_auto" (routine kinds schedule/running_late/decline/cancel/found are auto-approved).

    Returns {search, group_link, invite_link}: give the owner group_link to add the bot to a
    (new) group for listing cards; invite_link lets friends join the search to vote.
    """
    if approval_mode not in ("ask", "routine_auto"):
        raise ToolError("approval_mode must be 'ask' or 'routine_auto'.")
    out = await _base.api("POST", "/api/searches", body={"title": title, "region": region, "brief": brief or {}, "approval_mode": approval_mode})
    if not _packs._region_dirs(region):
        out["warning"] = f"No region pack found for {region!r} under {_packs.regions_root()}; the agent will work without pack knowledge."
    return out


@_base.mcp.tool()
async def search_list() -> list:
    """List searches the token's user is a member of (newest activity first)."""
    return await _base.api("GET", "/api/searches")


@_base.mcp.tool()
async def search_get(search_id: str) -> dict:
    """Get one search with members and listing stats by status/decision.
    The search has tg_chat_id = null until the bot was added to the search group."""
    return await _base.api("GET", f"/api/searches/{_base._q(search_id)}")


@_base.mcp.tool()
async def search_update(
    search_id: str,
    title: str | None = None,
    region: str | None = None,
    brief: dict | None = None,
    status: str | None = None,
    approval_mode: str | None = None,
) -> dict:
    """Update a search; only the given fields change. brief replaces the whole brief object
    (read it with search_get first and send the merged version).
    status: active | paused | found | living (moved in: the Mini App shows the house screen) | closed.
    approval_mode: ask | routine_auto."""
    if status and status not in SEARCH_STATUSES:
        raise ToolError("status must be active, paused, found, living or closed.")
    if approval_mode and approval_mode not in ("ask", "routine_auto"):
        raise ToolError("approval_mode must be 'ask' or 'routine_auto'.")
    body = _base._clean({"title": title, "region": region, "brief": brief, "status": status, "approval_mode": approval_mode})
    if not body:
        raise ToolError("Nothing to update.")
    return await _base.api("PATCH", f"/api/searches/{_base._q(search_id)}", body=body)


SEARCH_STATUSES = ("active", "paused", "found", "living", "closed")


def _cursor_key(search_id: str) -> str:
    url = os.environ.get("HUNT_API_URL") or _base.load_config().get("api_url") or ""
    return f"{url.rstrip('/')}|{search_id}"


@_base.mcp.tool()
async def search_digest(search_id: str, since: int | None = None, advance: bool = True) -> dict:
    """What humans did since the last check: votes, comments on cards, draft decisions, member joins
    (events not made by the agent).

    The last cursor is remembered per search in the local config, so calling
    search_digest(search_id) again returns only what is new. Pass since=0 to see everything again,
    or advance=false to peek without moving the remembered cursor.

    Returns {cursor, previous_cursor, events:[{id, kind, ref, actor, data, at}]}.
    """
    key = _cursor_key(search_id)
    prev = since if since is not None else int(_base.load_config().get("digest_cursors", {}).get(key, 0))
    data = await _base.api("GET", f"/api/searches/{_base._q(search_id)}/digest", params={"since": prev})
    cur = data.get("cursor", prev)
    if advance and (cur != prev or since is not None):
        _base.update_config(lambda c: c.setdefault("digest_cursors", {}).__setitem__(key, cur))
    return {"cursor": cur, "previous_cursor": prev, "events": data.get("events", []), "count": len(data.get("events", []))}
