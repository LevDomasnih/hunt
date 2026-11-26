"""Hunt core: routes (split from hunt_core.py)."""
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
# ---------------------------------------------------------------- time & routes

WEEKDAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")


def _zone(tz: str) -> ZoneInfo:
    tz = (tz or "").strip()
    try:
        return ZoneInfo(tz)
    except (ZoneInfoNotFoundError, ValueError):
        pass
    # Allow a region path ("bali/bukit") and use the pack timezone.
    try:
        ptz = _packs.merged_pack(tz).get("timezone")
        if ptz:
            return ZoneInfo(ptz)
    except ToolError:
        pass
    raise ToolError(f"Unknown timezone {tz!r}. Use an IANA name like 'Asia/Makassar' or a region path like 'bali'.")


def _parse_date(s: str) -> date:
    try:
        return date.fromisoformat(str(s).strip()[:10])
    except ValueError:
        raise ToolError(f"Bad date {s!r}: use YYYY-MM-DD.")


def time_info_impl(tz: str, day: str | None = None, now: datetime | None = None) -> dict:
    z = _zone(tz)
    now_local = (now or datetime.now(tz=z)).astimezone(z)
    today = now_local.date()
    out: dict[str, Any] = {
        "tz": str(z.key),
        "now": now_local.isoformat(timespec="seconds"),
        "date": today.isoformat(),
        "weekday": WEEKDAYS[today.weekday()],
        "time": now_local.strftime("%H:%M"),
        "utc_offset": now_local.strftime("%z")[:3] + ":" + now_local.strftime("%z")[3:],
    }
    if day:
        d = _parse_date(day)
        out["asked"] = {"date": d.isoformat(), "weekday": WEEKDAYS[d.weekday()], "days_from_today": (d - today).days}
    return out


@_base.mcp.tool()
async def time_info(tz: str, date: str | None = None) -> dict:
    """Current local time in a timezone, with ISO date and weekday name. Always use this instead of
    guessing weekdays or "tomorrow". tz: IANA name ('Asia/Makassar', 'Asia/Bangkok') or a region path
    ('bali'). date (optional, YYYY-MM-DD): also returns its weekday and days from today."""
    return time_info_impl(tz, date)


def dates_between_impl(start: str, end: str) -> list[dict]:
    a, b = _parse_date(start), _parse_date(end)
    if b < a:
        a, b = b, a
    if (b - a).days > 366:
        raise ToolError("Range too long (max 366 days).")
    return [{"date": (a + timedelta(days=i)).isoformat(), "weekday": WEEKDAYS[(a + timedelta(days=i)).weekday()]}
            for i in range((b - a).days + 1)]


@_base.mcp.tool()
async def dates_between(start: str, end: str) -> dict:
    """All dates from start to end inclusive (YYYY-MM-DD) with weekday names, plus the number of days
    and nights. Handy for "next Tuesday", stay lengths and viewing days."""
    days = dates_between_impl(start, end)
    return {"days": len(days), "nights": max(len(days) - 1, 0), "dates": days}


def _point(p: Any) -> str:
    try:
        if isinstance(p, dict):
            lat, lng = float(p["lat"]), float(p.get("lng", p.get("lon")))
        elif isinstance(p, (list, tuple)):
            lat, lng = float(p[0]), float(p[1])
        else:
            lat_s, lng_s = str(p).split(",")
            lat, lng = float(lat_s), float(lng_s)
    except (KeyError, ValueError, TypeError, IndexError):
        raise ToolError(f"Bad point {p!r}: use {{'lat': -8.8, 'lng': 115.1}}.")
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        raise ToolError(f"Point out of range: {lat},{lng}")
    return f"{round(lat, 6)},{round(lng, 6)}"


MAX_WAYPOINTS = 9  # Google Maps URLs: up to 9 waypoints (3 on some mobile browsers)


def route_links(points: list, travelmode: str = "driving") -> list[str]:
    pts = [_point(p) for p in points]
    if not pts:
        raise ToolError("No points.")
    if len(pts) == 1:
        return ["https://www.google.com/maps/search/?" + urlencode({"api": 1, "query": pts[0]}, safe=",")]
    links = []
    per = MAX_WAYPOINTS + 2
    i = 0
    while i < len(pts) - 1:
        chunk = pts[i:i + per]
        q = {"api": 1, "origin": chunk[0], "destination": chunk[-1], "travelmode": travelmode}
        if len(chunk) > 2:
            q["waypoints"] = "|".join(chunk[1:-1])
        links.append("https://www.google.com/maps/dir/?" + urlencode(q, safe=","))
        i += per - 1
    return links


@_base.mcp.tool()
async def route_link(points: list[dict], travelmode: str = "driving") -> dict:
    """Google Maps directions URL through points in the given order (first = start, last = end).
    points: [{"lat": -8.81, "lng": 115.12}, ...]. travelmode: driving | two_wheeler | walking | transit.
    More than 11 points are split into several consecutive links. Mobile browsers may show only 3
    waypoints; the Google Maps app shows all."""
    if travelmode not in ("driving", "two_wheeler", "walking", "transit", "bicycling"):
        raise ToolError("travelmode must be driving, two_wheeler, walking, transit or bicycling.")
    links = route_links(points, travelmode)
    return {"url": links[0], "urls": links, "points": len(points)}
