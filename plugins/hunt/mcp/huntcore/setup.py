"""Hunt core: setup (split from hunt_core.py)."""
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
# ---------------------------------------------------------------- setup

@_base.mcp.tool()
async def hunt_config_set(api_url: str, token: str, verify: bool = True) -> dict:
    """Connect Hunt to a CRM. Stores api_url in ~/.config/hunt/config.json and the agent token
    in the OS keychain (never in a file, never echoed back).

    Args:
        api_url: CRM base URL, e.g. https://hunt-crm.<name>.workers.dev (the bot shows it with the token).
        token: agent token from the bot (/start or /token). Do not paste it anywhere else.
        verify: check the token with GET /api/me before saving (default true).
    """
    url = _base._norm_url(api_url)
    token = (token or "").strip()
    if not token:
        raise ToolError("token is empty.")
    me = None
    warning = None
    if verify:
        try:
            me = await _base.api("GET", "/api/me", creds=(url, token))
        except ToolError as e:
            if "CRM 401" in str(e):
                raise ToolError("The CRM rejected this token (401). Nothing was saved. Get a fresh one with /token in the bot.")
            if "Cannot reach" in str(e) or "did not answer" in str(e):
                warning = f"Saved without verification: {e}"
            else:
                raise
    _base._keyring_set(url, token)
    _base.update_config(lambda c: c.__setitem__("api_url", url))
    out: dict[str, Any] = {"ok": True, "api_url": url, "token": "stored in OS keychain (service 'hunt')"}
    if me:
        out["user"] = me.get("user")
        out["has_profile"] = bool(me.get("profile"))
    if warning:
        out["warning"] = warning
    return out


@_base.mcp.tool()
async def hunt_status() -> dict:
    """Check the Hunt setup: config, token presence, CRM /health and /api/me (who the token belongs to,
    whether a profile exists), and where region packs are read from. Call this first in a session."""
    out: dict[str, Any] = {"config_file": str(_base.config_path()), "regions_root": str(_packs.regions_root())}
    cfg = _base.load_config()
    url = os.environ.get("HUNT_API_URL") or cfg.get("api_url")
    out["api_url"] = url
    if not url:
        out["ready"] = False
        out["next"] = "Ask the user for the CRM URL and agent token, then call hunt_config_set."
        return out
    try:
        out["health"] = await _base.api("GET", "/health", auth=False)
    except ToolError as e:
        out["health"] = {"ok": False, "error": str(e)}
    try:
        url_n, token = _base._creds()
        out["token"] = "present"
        me = await _base.api("GET", "/api/me", creds=(url_n, token))
        out["user"] = me.get("user")
        out["profile"] = me.get("profile")
        out["ready"] = True
    except ToolError as e:
        out["ready"] = False
        out["error"] = str(e)
    return out
