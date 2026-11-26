"""Hunt core: event_sources (split from hunt_core.py)."""
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
from huntcore import base as _base, deals as _deals, event_photos as _event_photos, events as _events, places as _places, routes as _routes
# ---------------------------------------------------------------- wave 9: organizer / venue / ticket pages (read-only)

HUNTBOT_UA = "HuntBot/1.0 (+read-only)"
SOURCE_CACHE = "event_source_cache.json"
SOURCE_CACHE_TTL = 6 * 3600          # seconds: a page (and its robots.txt) is read at most every 6 h
SOURCE_CACHE_MAX = 300               # entries kept in the cache file
SOURCE_MIN_INTERVAL = 1.0            # seconds between two requests to the same host (≤ 1 req/s)
SOURCE_MAX_CRAWL_DELAY = 10.0        # a robots.txt Crawl-delay above this is capped (we read one page anyway)
ROBOTS_MAX_BYTES = 512 * 1024
_host_last: dict[str, float] = {}
_host_interval: dict[str, float] = {}

_LD_SCRIPT = re.compile(r"<script\b[^>]*\btype\s*=\s*[\"']?application/ld\+json[\"']?[^>]*>(.*?)</script\s*>", re.I | re.S)
_META_TAG = re.compile(r"<meta\b[^>]*>", re.I)
_A_TAG = re.compile(r"<a\b([^>]*)>(.*?)</a\s*>", re.I | re.S)
_TITLE_TAG = re.compile(r"<title\b[^>]*>(.*?)</title\s*>", re.I | re.S)
_TAGS = re.compile(r"<[^>]+>")
_EVENT_EXTRA_TYPES = {"Festival", "Hackathon", "EventSeries"}
_EVENT_LINK_HINT = re.compile(
    r"/(events?|event-detail|party|parties|gigs?|whats-?on|what-s-on|agenda|calendar|programme|program|lineup|line-up|"
    r"tickets?|shows?|concerts?|e)(/|-|$)|/\d{4}[-/]\d{2}[-/]\d{2}|/\d{4}/\d{2}/", re.I)
_ISO_ANY = re.compile(r"^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$", re.I)


async def _host_throttle(host: str) -> None:
    """≤ 1 request per second per host (or the robots.txt Crawl-delay, capped), shared by every source read."""
    gap = _host_interval.get(host, SOURCE_MIN_INTERVAL)
    wait = gap - (time.monotonic() - _host_last.get(host, -1e9))
    if wait > 0:
        await _places._sleep(wait)
    _host_last[host] = time.monotonic()


def _source_cache() -> dict[str, Any]:
    data = _places._json_cache_load(SOURCE_CACHE)
    now = time.time()
    return {k: v for k, v in data.items() if isinstance(v, dict) and now - float(v.get("at") or 0) < SOURCE_CACHE_TTL}


def _source_cache_put(cache: dict[str, Any], key: str, value: Any) -> None:
    cache[key] = {"at": time.time(), "v": value}
    if len(cache) > SOURCE_CACHE_MAX:
        for k in sorted(cache, key=lambda k: cache[k].get("at") or 0)[: len(cache) - SOURCE_CACHE_MAX]:
            cache.pop(k, None)
    _places._json_cache_save(SOURCE_CACHE, cache)


async def _robots_txt(origin: str, host: str, cache: dict[str, Any]) -> str | None:
    """robots.txt text for an origin ("" = none/4xx = everything allowed; None = 5xx/unreachable = treat as disallowed),
    cached 6 h."""
    key = "robots:" + origin
    if key in cache:
        return cache[key]["v"]
    await _host_throttle(host)
    meta: dict[str, Any] = {}
    try:
        data, _, _ = await _event_photos._fetch_public(origin + "/robots.txt", ROBOTS_MAX_BYTES, "text/plain,*/*;q=0.5", ("",),
                                         "robots.txt", ua=HUNTBOT_UA, meta=meta)
    except ToolError as e:
        if "public https" in str(e):  # a redirect to a private/http host: never follow
            raise
        data, meta = b"", {"status": 599}
    status = int(meta.get("status") or 200)
    if status >= 500:
        text: str | None = None
    elif status >= 400:
        text = ""
    else:
        text = data.decode("utf-8", "replace")
    _source_cache_put(cache, key, text)
    return text


def _robots_groups(robots_text: str) -> list[dict]:
    """robots.txt → [{agents, rules: [(allow, pattern)], delay}]; consecutive User-agent lines share one group."""
    groups: list[dict] = []
    cur: dict | None = None
    last_ua = False
    for raw in robots_text.splitlines():
        line = raw.split("#", 1)[0].strip()
        if ":" not in line:
            continue
        k, v = (x.strip() for x in line.split(":", 1))
        k = k.lower()
        if k == "user-agent":
            if cur is None or not last_ua:
                cur = {"agents": [], "rules": [], "delay": None}
                groups.append(cur)
            cur["agents"].append(v.lower())
            last_ua = True
            continue
        last_ua = False
        if cur is None:
            continue
        if k in ("allow", "disallow"):
            cur["rules"].append((k == "allow", v))
        elif k == "crawl-delay" and cur["delay"] is None:
            with contextlib.suppress(ValueError):
                cur["delay"] = float(v)
    return groups


def _robots_rule_re(pattern: str) -> re.Pattern:
    end = pattern.endswith("$")
    body = unquote(pattern[:-1] if end else pattern)
    return re.compile("".join(".*" if ch == "*" else re.escape(ch) for ch in body) + ("$" if end else ""), re.S)


def robots_allows(robots_text: str | None, url: str, ua: str = HUNTBOT_UA) -> tuple[bool, float | None]:
    """(allowed, crawl delay) for url under a robots.txt text, RFC 9309: the group naming our product token
    ("huntbot") or else "*", `*` and `$` wildcards in paths, the longest matching rule wins and Allow wins a tie.
    None = the file could not be read (5xx / network): nothing is allowed."""
    if robots_text is None:
        return False, None
    if not robots_text.strip():
        return True, None
    token = ua.split("/")[0].strip().lower()
    groups = _robots_groups(robots_text)
    mine = [g for g in groups if any(a != "*" and (a == token or a in ua.lower()) for a in g["agents"])]
    mine = mine or [g for g in groups if "*" in g["agents"]]
    rules = [r for g in mine for r in g["rules"]]
    delay = next((g["delay"] for g in mine if g["delay"] is not None), None)
    u = urlparse(url)
    target = unquote((u.path or "/") + ("?" + u.query if u.query else ""))
    best: tuple[int, bool] | None = None
    for allow, pattern in rules:
        if not pattern:
            continue  # "Disallow:" with nothing = allow everything
        if _robots_rule_re(pattern).match(target):
            key = (len(pattern), allow)
            if best is None or key > best:
                best = key
    return (True if best is None else best[1]), delay


def _noindex(html_text: str, x_robots: list[str]) -> bool:
    """True when the page asks not to be indexed: <meta name="robots|huntbot" content="noindex|none"> or an
    X-Robots-Tag header (generic or addressed to huntbot)."""
    for v in x_robots or []:
        for part in str(v).split(","):
            part = part.strip().lower()
            m = re.match(r"^([a-z0-9_-]+)\s*:\s*(.*)$", part)
            if m and m.group(1) not in ("noindex", "none", "nofollow", "noarchive", "unavailable_after", "max-snippet",
                                         "max-image-preview", "max-video-preview", "nosnippet", "notranslate", "noimageindex"):
                if m.group(1) != "huntbot":
                    continue
                part = m.group(2)
            if re.search(r"(^|\s)(noindex|none)(\s|$)", part):
                return True
    head = html_text[:300_000]
    for tag in _META_TAG.findall(head):
        a = {k.lower(): v.strip("\"'") for k, v in _event_photos._ATTR.findall(tag)}
        if (a.get("name") or "").lower() in ("robots", "huntbot"):
            if re.search(r"\b(noindex|none)\b", (a.get("content") or "").lower()):
                return True
    return False


def _text(v: Any, n: int) -> str | None:
    if isinstance(v, list):
        v = next((x for x in v if isinstance(x, str) and x.strip()), None)
    if isinstance(v, dict):
        v = v.get("name") or v.get("@value")
    if not isinstance(v, str):
        return None
    s = re.sub(r"\s+", " ", html.unescape(_TAGS.sub(" ", v))).strip()
    if not s:
        return None
    return s if len(s) <= n else s[: n - 1].rstrip() + "…"


def _ld_types(d: dict) -> list[str]:
    t = d.get("@type")
    ts = t if isinstance(t, list) else [t]
    return [re.split(r"[/:#]", x)[-1] for x in ts if isinstance(x, str)]


def _is_event_type(d: dict) -> str | None:
    for t in _ld_types(d):
        if t.endswith("Event") or t in _EVENT_EXTRA_TYPES:
            return t
    return None


def _ld_events(blob: Any, depth: int = 0, out: list | None = None) -> list[dict]:
    """Every schema.org Event (and subtype: MusicEvent, SocialEvent, Festival …) in a JSON-LD value: @graph, lists,
    ItemList elements, a Place's or Organization's event(s), subEvent."""
    out = [] if out is None else out
    if depth > 8 or len(out) > 200:
        return out
    if isinstance(blob, list):
        for x in blob:
            _ld_events(x, depth + 1, out)
    elif isinstance(blob, dict):
        if _is_event_type(blob):
            out.append(blob)
        for k, v in blob.items():
            if k in ("@context",) or not isinstance(v, (dict, list)):
                continue
            _ld_events(v, depth + 1, out)
    return out


def _ld_blobs(html_text: str) -> list[Any]:
    blobs = []
    for raw in _LD_SCRIPT.findall(html_text):
        s = raw.strip()
        s = re.sub(r"^\s*(<!--|//\s*<!\[CDATA\[|<!\[CDATA\[)", "", s)
        s = re.sub(r"(-->|//\s*\]\]>|\]\]>)\s*$", "", s).strip()
        try:
            blobs.append(json.loads(s))
        except ValueError:
            with contextlib.suppress(ValueError):  # stray control characters inside strings are common
                blobs.append(json.loads(re.sub(r"[\x00-\x1f]+", " ", s)))
    return blobs


def _abs_https(base: str, v: Any) -> str | None:
    from urllib.parse import urljoin
    if isinstance(v, list):
        for x in v:
            u = _abs_https(base, x)
            if u:
                return u
        return None
    if isinstance(v, dict):
        v = v.get("url") or v.get("contentUrl") or v.get("@id")
    if not isinstance(v, str) or not v.strip():
        return None
    u = urljoin(base, html.unescape(v.strip()))
    return u if _events._HTTPS.match(u) and len(u) <= 1000 else None


def parse_event_time(v: Any, tz: str | None = None) -> dict:
    """Normalize a page's date/time. Returns {value, naive, date_only, utc, local?}:
    value = ISO with offset when the page gave one ("+0800" → "+08:00", "Z" → "+00:00"), else the naive or date-only
    text as given (never an invented offset). With tz (IANA, e.g. Asia/Makassar) an aware time is also converted to
    local → `local`; a naive time gets `if_local` = that wall time in tz, for you to confirm, not a fact."""
    out: dict[str, Any] = {"value": None, "naive": False, "date_only": False, "utc": False}
    if not isinstance(v, str) or not v.strip():
        return out
    s = v.strip()
    m = _ISO_ANY.match(s)
    if not m:
        out["value"], out["naive"], out["unparsed"] = s[:40], True, True
        return out
    day, hh, mm, ss, off = m.groups()
    if hh is None:
        out.update(value=day, date_only=True)
        return out
    base = f"{day}T{hh}:{mm}:{ss or '00'}"
    try:
        datetime.fromisoformat(base)
    except ValueError:
        out["value"], out["naive"], out["unparsed"] = s[:40], True, True
        return out
    if off is None:
        out.update(value=base, naive=True)
        if tz:
            with contextlib.suppress(ToolError, ValueError):
                out["if_local"] = datetime.fromisoformat(base).replace(tzinfo=_routes._zone(tz)).isoformat()
        return out
    if off.upper() == "Z":
        off, out["utc"] = "+00:00", True
    elif ":" not in off:
        off = off[:3] + ":" + off[3:]
    value = base + off
    out["value"] = value
    if tz:
        with contextlib.suppress(ToolError, ValueError):
            out["local"] = datetime.fromisoformat(value).astimezone(_routes._zone(tz)).isoformat()
    return out


def _num_price(v: Any) -> float | None:
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        s = re.sub(r"[^\d.,]", "", v)
        if not s:
            return None
        if re.match(r"^\d{1,3}([.,]\d{3})+$", s):  # 250.000 / 250,000
            s = re.sub(r"[.,]", "", s)
        else:
            s = s.replace(",", "")
        with contextlib.suppress(ValueError):
            return float(s)
    return None


def _ld_offers(v: Any) -> dict:
    offers = v if isinstance(v, list) else [v] if isinstance(v, dict) else []
    prices, cur, url, avail = [], None, None, None
    for o in offers:
        if not isinstance(o, dict):
            continue
        for k in ("price", "lowPrice", "highPrice"):
            p = _num_price(o.get(k))
            if p is not None:
                prices.append(p)
        spec = o.get("priceSpecification")
        if isinstance(spec, dict):
            p = _num_price(spec.get("price"))
            if p is not None:
                prices.append(p)
            cur = cur or spec.get("priceCurrency")
        cur = cur or o.get("priceCurrency")
        url = url or (o.get("url") if isinstance(o.get("url"), str) else None)
        avail = avail or (re.split(r"[/:#]", o["availability"])[-1] if isinstance(o.get("availability"), str) else None)
    out: dict[str, Any] = {}
    if prices:
        out.update(low=min(prices), high=max(prices))
        out["kind"] = "free" if max(prices) == 0 else "paid"
    if isinstance(cur, str) and _events._CURRENCY.match(cur.strip().upper()):
        out["currency"] = cur.strip().upper()
    if url:
        out["url"] = url
    if avail:
        out["availability"] = avail
    return out


def _ld_place(v: Any) -> dict:
    places = v if isinstance(v, list) else [v]
    out: dict[str, Any] = {}
    for p in places:
        if isinstance(p, str):
            out.setdefault("name", _text(p, 140))
            continue
        if not isinstance(p, dict):
            continue
        if "VirtualLocation" in _ld_types(p):
            out["online"] = True
            continue
        out.setdefault("name", _text(p.get("name"), 140))
        addr = p.get("address")
        if isinstance(addr, dict):
            parts = [addr.get(k) for k in ("streetAddress", "addressLocality", "addressRegion", "postalCode")]
            country = addr.get("addressCountry")
            parts.append(country.get("name") if isinstance(country, dict) else country)
            a = ", ".join(str(x).strip() for x in parts if isinstance(x, (str, int)) and str(x).strip())
            if a:
                out.setdefault("address", a[:200])
            out.setdefault("locality", _text(addr.get("addressLocality"), 80))
        elif isinstance(addr, str):
            out.setdefault("address", _text(addr, 200))
        geo = p.get("geo")
        if isinstance(geo, dict):
            lat, lng = _places._num(geo.get("latitude")), _places._num(geo.get("longitude"))
            if lat is not None and lng is not None and -90 <= lat <= 90 and -180 <= lng <= 180 and (lat, lng) != (0, 0):
                out.setdefault("lat", round(lat, 6))
                out.setdefault("lng", round(lng, 6))
        if isinstance(p.get("hasMap"), str) and p["hasMap"].startswith("https://"):
            out.setdefault("map_url", p["hasMap"])
    return {k: v for k, v in out.items() if v is not None}


def _names(v: Any, n: int = 20) -> list[str]:
    items = v if isinstance(v, list) else [v]
    out = []
    for it in items:
        t = _text(it, 80)
        if t and t not in out:
            out.append(t)
    return out[:n]


def _suggest(ev: dict, site_name: str | None, page: str) -> tuple[dict, list[str]]:
    """events_upsert fields we can fill from the page, and the ones you still have to add yourself."""
    s: dict[str, Any] = {"source_kind": "web", "source_url": ev.get("url") or page}
    if site_name:
        s["source_name"] = site_name[:140]
    if ev.get("title"):
        s["title"] = ev["title"][:140]
    st, en = ev.get("start") or {}, ev.get("end") or {}
    start_val = st.get("local") or (st.get("value") if not st.get("naive") and not st.get("date_only") else None)
    if start_val and _events._ISO_OFFSET.match(start_val):
        s["starts_at"] = start_val
        end_val = en.get("local") or (en.get("value") if not en.get("naive") and not en.get("date_only") else None)
        if end_val and _events._ISO_OFFSET.match(end_val) and end_val >= start_val:
            s["ends_at"] = end_val
    pl = ev.get("place") or {}
    if pl.get("name"):
        s["place_name"] = pl["name"][:140]
    if pl.get("lat") is not None:
        s["lat"], s["lng"] = pl["lat"], pl["lng"]
    if pl.get("map_url") and _events._HTTPS.match(pl["map_url"]):
        s["map_url"] = pl["map_url"]
    pr = ev.get("price") or {}
    if pr.get("kind"):
        s["price_kind"] = pr["kind"]
        if pr["kind"] == "paid":
            s["price"] = int(round(pr["low"]))
            if pr.get("currency"):
                s["currency"] = pr["currency"]
            if pr.get("high") and pr["high"] != pr["low"]:
                s["price_note"] = f"from {pr['low']:g} to {pr['high']:g} {pr.get('currency') or ''}".strip()[:140]
    if ev.get("ticket_url"):
        s["booking"], s["ticket_url"] = "ticket", ev["ticket_url"]
    org = ev.get("organizer") or {}
    if org.get("name"):
        s["organizer_name"] = org["name"][:120]
        if org.get("url") and _events._HTTPS.match(org["url"]):
            s["organizer_channel"], s["organizer_address"] = "web", org["url"][:200]
    if ev.get("image"):
        s["photo_url"] = ev["image"]
        s["photo_credit"] = (org.get("name") or site_name or urlparse(page).hostname or "organizer")[:140]
        s["photo_source_url"] = page
    if ev.get("status") == "cancelled":
        s["status"] = "cancelled"
    missing = ["country", "about_ru", "category"]
    if "starts_at" not in s:
        missing.insert(0, "starts_at (the page gave " + ("only a date" if st.get("date_only") else
                                                          "a time without an offset" if st.get("naive") else "no time") + ")")
    if "place_name" not in s and "lat" not in s:
        missing.append("place_name / place_id / lat+lng")
    return s, missing


def _normalize_ld(d: dict, base: str, site_name: str | None, tz: str | None) -> dict:
    url = _abs_https(base, d.get("url")) or _abs_https(base, d.get("@id") if str(d.get("@id", "")).startswith("http") else None)
    offers = _ld_offers(d.get("offers"))
    ticket = _abs_https(base, offers.pop("url", None)) if offers.get("url") else None
    status_raw = d.get("eventStatus")
    status = re.split(r"[/:#]", status_raw)[-1] if isinstance(status_raw, str) else None
    mode = d.get("eventAttendanceMode")
    org = d.get("organizer")
    org = org[0] if isinstance(org, list) and org else org
    ev = {
        "from": "jsonld",
        "type": _is_event_type(d),
        "title": _text(d.get("name"), 140),
        "description": _text(d.get("description"), 400),
        "url": url,
        "start": parse_event_time(d.get("startDate"), tz),
        "end": parse_event_time(d.get("endDate"), tz),
        "place": _ld_place(d.get("location")),
        "price": offers,
        "ticket_url": ticket,
        "lineup": _names(d.get("performer") or d.get("performers")),
        "organizer": {"name": _text(org, 120), "url": _abs_https(base, org.get("url")) if isinstance(org, dict) else None},
        "image": _abs_https(base, d.get("image")),
        "status": "cancelled" if status == "EventCancelled" else (status[5:].lower() if status and status.startswith("Event")
                                                                    and status != "EventScheduled" else None),
        "online": bool(isinstance(mode, str) and mode.endswith("OnlineEventAttendanceMode")),
    }
    ev["naive_time"] = bool(ev["start"].get("naive"))
    ev["date_only"] = bool(ev["start"].get("date_only"))
    return ev


def _metas(html_text: str) -> dict[str, str]:
    m: dict[str, str] = {}
    for tag in _META_TAG.findall(html_text[:600_000]):
        a = {k.lower(): v.strip("\"'") for k, v in _event_photos._ATTR.findall(tag)}
        key = (a.get("property") or a.get("name") or a.get("itemprop") or "").lower()
        val = html.unescape(a.get("content") or "").strip()
        if key and val and key not in m:
            m[key] = val
    return m


def _og_event(metas: dict[str, str], base: str, tz: str | None) -> dict | None:
    title = _text(metas.get("og:title") or metas.get("twitter:title"), 140)
    if not title:
        return None
    start = metas.get("event:start_time") or metas.get("og:event:start_time") or metas.get("startdate")
    end = metas.get("event:end_time") or metas.get("og:event:end_time") or metas.get("enddate")
    ev = {
        "from": "og",
        "type": metas.get("og:type"),
        "title": title,
        "description": _text(metas.get("og:description") or metas.get("description"), 400),
        "url": _abs_https(base, metas.get("og:url")) or base,
        "start": parse_event_time(start, tz),
        "end": parse_event_time(end, tz),
        "place": {k: v for k, v in {"name": _text(metas.get("event:location") or metas.get("og:locality"), 140)}.items() if v},
        "price": {},
        "ticket_url": None,
        "lineup": [],
        "organizer": {"name": None, "url": None},
        "image": _abs_https(base, metas.get("og:image:secure_url") or metas.get("og:image") or metas.get("twitter:image")),
        "status": None,
        "online": False,
    }
    ev["naive_time"] = bool(ev["start"].get("naive"))
    ev["date_only"] = bool(ev["start"].get("date_only"))
    return ev


def _site_key(host: str) -> str:
    return ".".join((host or "").lower().split(".")[-2:])


def _event_links(html_text: str, base: str, limit: int = 40) -> list[dict]:
    """Candidate event pages linked from a listing page, same site only (no crawling: you open the ones you need)."""
    from urllib.parse import urljoin, urldefrag
    site = _site_key(urlparse(base).hostname or "")
    seen, out = {urldefrag(base)[0].rstrip("/")}, []
    for attrs, inner in _A_TAG.findall(html_text[:2_000_000]):
        a = {k.lower(): v.strip("\"'") for k, v in _event_photos._ATTR.findall(attrs)}
        href = html.unescape(a.get("href") or "").strip()
        if not href or href.startswith(("#", "mailto:", "tel:", "javascript:")):
            continue
        u = urldefrag(urljoin(base, href))[0]
        p = urlparse(u)
        if p.scheme != "https" or _site_key(p.hostname or "") != site or not _EVENT_LINK_HINT.search(p.path or ""):
            continue
        k = u.rstrip("/")
        if k in seen:
            continue
        seen.add(k)
        out.append({"url": u, "text": _text(inner, 120)})
        if len(out) >= limit:
            break
    return out


def _ics_unfold(text: str) -> list[str]:
    lines: list[str] = []
    for raw in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        if raw[:1] in (" ", "\t") and lines:
            lines[-1] += raw[1:]
        else:
            lines.append(raw)
    return lines


def _ics_time(prop: str, val: str, tz: str | None) -> dict:
    """DTSTART/DTEND: ...Z = UTC, ;TZID=Area/City = that zone (exact), floating = naive, VALUE=DATE = date only."""
    params = dict(p.split("=", 1) for p in prop.split(";")[1:] if "=" in p)
    v = val.strip()
    m = re.match(r"^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$", v)
    if not m:
        return {"value": v[:40], "naive": True, "date_only": False, "utc": False, "unparsed": True}
    y, mo, d, hh, mi, ss, z = m.groups()
    if hh is None:
        return parse_event_time(f"{y}-{mo}-{d}", tz)
    base = f"{y}-{mo}-{d}T{hh}:{mi}:{ss or '00'}"
    if z:
        return parse_event_time(base + "Z", tz)
    zone = params.get("TZID", "").strip('"')
    if zone:
        with contextlib.suppress(ToolError, ValueError):
            aware = datetime.fromisoformat(base).replace(tzinfo=_routes._zone(zone)).isoformat()
            return parse_event_time(aware, tz)
    return parse_event_time(base, tz)


def _ics_events(text: str, base: str, tz: str | None) -> list[dict]:
    out, cur = [], None
    for line in _ics_unfold(text):
        if line.strip().upper() == "BEGIN:VEVENT":
            cur = {}
            continue
        if line.strip().upper() == "END:VEVENT":
            if cur is not None:
                out.append(cur)
            cur = None
            continue
        if cur is None or ":" not in line:
            continue
        prop, val = line.split(":", 1)
        name = prop.split(";")[0].upper()
        unesc = val.replace("\\n", " ").replace("\\N", " ").replace("\\,", ",").replace("\\;", ";").replace("\\\\", "\\")
        if name in ("DTSTART", "DTEND"):
            cur[name] = _ics_time(prop, val, tz)
        elif name in ("SUMMARY", "DESCRIPTION", "LOCATION", "URL", "GEO", "STATUS", "ORGANIZER"):
            cur.setdefault(name, unesc)
    evs = []
    for c in out:
        geo = {}
        if c.get("GEO") and ";" in c["GEO"]:
            la, lo = (_places._num(x) for x in c["GEO"].split(";", 1))
            if la is not None and lo is not None:
                geo = {"lat": round(la, 6), "lng": round(lo, 6)}
        org = c.get("ORGANIZER") or ""
        org_name = re.search(r"CN=([^;:]+)", org)
        ev = {"from": "ics", "type": "VEVENT", "title": _text(c.get("SUMMARY"), 140),
              "description": _text(c.get("DESCRIPTION"), 400), "url": _abs_https(base, c.get("URL")),
              "start": c.get("DTSTART") or parse_event_time(None), "end": c.get("DTEND") or parse_event_time(None),
              "place": {k: v for k, v in {"name": _text(c.get("LOCATION"), 140), **geo}.items() if v is not None},
              "price": {}, "ticket_url": None, "lineup": [], "organizer": {"name": _text(org_name.group(1), 120) if org_name else None, "url": None},
              "image": None, "status": "cancelled" if (c.get("STATUS") or "").upper() == "CANCELLED" else None, "online": False}
        ev["naive_time"] = bool(ev["start"].get("naive"))
        ev["date_only"] = bool(ev["start"].get("date_only"))
        evs.append(ev)
    return evs


def extract_page_events(body: str, ctype: str, base: str, tz: str | None = None) -> dict:
    """Pure part of event_source_read: {read, site_name, title, events, links} from a fetched page."""
    if ctype == "text/calendar" or body.lstrip().upper().startswith("BEGIN:VCALENDAR"):
        evs = _ics_events(body, base, tz)
        return {"read": "ics" if evs else "none", "site_name": None, "title": None, "events": evs, "links": []}
    metas = _metas(body)
    site_name = _text(metas.get("og:site_name") or metas.get("application-name"), 140)
    if not site_name:
        site_name = (urlparse(base).hostname or "").removeprefix("www.") or None
    title_m = _TITLE_TAG.search(body[:300_000])
    page_title = _text(title_m.group(1), 200) if title_m else None
    events, seen = [], set()
    blobs: list[Any] = []
    if ctype in ("application/ld+json", "application/json"):
        with contextlib.suppress(ValueError):
            blobs = [json.loads(body)]
    for blob in blobs or _ld_blobs(body):
        for d in _ld_events(blob):
            ev = _normalize_ld(d, base, site_name, tz)
            key = ((ev["title"] or "").lower(), ev["start"].get("value"), ev["url"])
            if not ev["title"] or key in seen:
                continue
            seen.add(key)
            events.append(ev)
    links = _event_links(body, base) if "<a" in body[:2_000_000].lower() else []
    read = "jsonld" if events else "none"
    if not events:
        og = _og_event(metas, base, tz)
        eventish = bool(og) and ("event" in (og.get("type") or "").lower() or og["start"].get("value"))
        if og and (eventish or len(links) < 3):
            og["single_page_guess"] = not eventish  # og tags of a page that may be the venue's home, not one event
            events.append(og)
            read = "og"
        elif links:
            read = "list"
    return {"read": read, "site_name": site_name, "title": page_title, "events": events, "links": links}


@_base.mcp.tool()
async def event_source_read(url: str, max_events: int = 30, tz: str | None = None) -> dict:
    """Read ONE organizer / venue / ticket-platform page READ-ONLY and extract its events (wave 9: organizer sites as a
    first-class Афиша source, "link, don't store"). Use it for the region pack's events.yaml sources (their events_url,
    else url; `read` says how: jsonld | og | list | ics) and for an event page you found. One page per call; never crawl.

    How it reads: schema.org JSON-LD Event first (also inside @graph, lists, a Place's events; subtypes MusicEvent,
    SocialEvent, DanceEvent, Festival …: name, startDate/endDate, location Place / PostalAddress / geo, offers price +
    currency + ticket url, performer → lineup, organizer, image, url, eventStatus), then an .ics calendar, then the og:
    tags as a single-event fallback (`single_page_guess: true` = maybe the venue's home page, not one event), and always
    `links`: candidate event pages on the same site for you to open one by one (read = "list" when that is all there is).

    POLITE BY DESIGN: robots.txt is honoured (generic UA "HuntBot/1.0 (+read-only)"; a disallowed page → {skipped:
    "robots"}; robots.txt unreachable with 5xx → skipped too), ≤ 1 request/s per host (or its Crawl-delay), results and
    robots.txt cached 6 h on disk (a second call within 6 h costs nothing: from_cache = true), a noindex page (meta
    robots or X-Robots-Tag) → {skipped: "noindex"} with no events. Public https hosts only (http, private/internal
    addresses and redirects to them are refused), ≤ 3 MB. Telegram/Instagram/Facebook are not read here (tg_history /
    the browser tools).

    TIMES: kept exactly as the page gives them. With an offset → `start.value` "2026-11-28T22:00:00+08:00" ("Z" →
    "+00:00", utc = true); pass tz (the region's IANA zone, e.g. Asia/Makassar) to get `start.local` converted exactly.
    A naive time (no offset) → `naive_time: true`, value without offset (and `if_local` with tz: the same wall time in
    tz, a guess for you to confirm from the page); date only → `date_only: true`. Never invent an offset: the suggested
    dict carries starts_at only when the time is exact.

    Each event comes with `suggested`: events_upsert fields filled from the page — source_kind "web", source_url (the
    event's OWN page), source_name (site name), title, starts_at/ends_at, place_name, lat/lng, price_kind/price/currency,
    booking ticket + ticket_url, organizer_name, photo_url (the image's public URL: LINK, DON'T STORE) + photo_credit
    (organizer or site) + photo_source_url (this page), status — and `missing`: what you still add (country, about_ru in
    your own words, category, topic, tags, the time if inexact). Check the line-up/date against the page when unsure;
    organizer pages beat chat posts for exact date, time and line-up.

    Returns {url, final_url, site_name, title, read: jsonld | ics | og | list | none, events: [{from, type, title,
    description, url, start, end, naive_time, date_only, place, price, ticket_url, lineup, organizer, image, status,
    online, suggested, missing}], links: [{url, text}], total, from_cache, warning?} or {url, skipped: "robots" |
    "noindex", from_cache}."""
    url = (url or "").strip()
    if re.match(r"^(?:https?://)?(?:www\.)?(?:t\.me|telegram\.me|instagram\.com|facebook\.com|fb\.com)/", url, re.I):
        raise ToolError("Telegram / Instagram / Facebook pages are not read here: tg_history (read only) or the "
                        "browser tools' history; this tool reads organizer, venue and ticket sites.")
    _event_photos._check_public_https(url, "page")
    if tz:
        _routes._zone(tz)
    try:
        n = max(1, min(int(max_events), 100))
    except (TypeError, ValueError):
        raise ToolError("max_events must be a number 1..100.")
    u = urlparse(url)
    host = (u.hostname or "").lower()
    origin = f"https://{u.netloc}"
    cache = _source_cache()
    ckey = "page:" + url + ("|tz=" + tz if tz else "")
    hit = cache.get(ckey)
    if hit:
        res, from_cache = hit["v"], True
    else:
        from_cache = False
        robots = await _robots_txt(origin, host, cache)
        allowed, delay = robots_allows(robots, url)
        if delay:
            _host_interval[host] = min(max(SOURCE_MIN_INTERVAL, delay), SOURCE_MAX_CRAWL_DELAY)
        if not allowed:
            res = {"url": url, "skipped": "robots",
                   "why": "robots.txt could not be read (server error)" if robots is None else "robots.txt disallows this page for crawlers"}
        else:
            await _host_throttle(host)
            meta: dict[str, Any] = {}
            data, ctype, final = await _event_photos._fetch_public(
                url, _event_photos.PAGE_MAX_BYTES, "text/html,application/xhtml+xml,text/calendar,application/ld+json;q=0.9,*/*;q=0.1",
                ("text/html", "application/xhtml", "text/calendar", "application/ld+json", "application/json", "text/plain"),
                "page", ua=HUNTBOT_UA, meta=meta)
            if int(meta.get("status") or 200) >= 400:
                raise ToolError(f"The page answered {meta['status']}; check the URL in the pack (events_url).")
            body = data.decode("utf-8", "replace")
            if _noindex(body, meta.get("x_robots") or []):
                res = {"url": url, "final_url": final, "skipped": "noindex",
                       "why": "the page asks not to be indexed (meta robots / X-Robots-Tag); do not use it as a source"}
            else:
                ex = extract_page_events(body, ctype, final, tz)
                for ev in ex["events"]:
                    ev["suggested"], ev["missing"] = _suggest(ev, ex["site_name"], final)
                    bad = _deals.sensitive_findings(ev["suggested"])
                    if bad:
                        ev["suggested"], ev["missing"] = None, ["refused: " + "; ".join(bad)]
                res = {"url": url, "final_url": final, **ex, "total": len(ex["events"])}
                if _site_key(urlparse(final).hostname or "") != _site_key(host):
                    res["warning"] = (f"The page redirected to another site ({urlparse(final).hostname}): check it is still "
                                      "the organizer's own page before using it.")
        _source_cache_put(cache, ckey, res)
    out = dict(res)
    if "events" in out:
        out["events"] = out["events"][:n]
    out["from_cache"] = from_cache
    return out
