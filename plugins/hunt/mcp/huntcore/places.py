"""Hunt core: places (split from hunt_core.py)."""
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
# ---------------------------------------------------------------- wave 3: places near (travel times)

VALHALLA_URL = "https://valhalla1.openstreetmap.de/route"
_VALHALLA_MIN_INTERVAL = 1.1  # seconds between requests to the free public server
_valhalla_last = 0.0
COSTING = {"scooter": "motor_scooter", "car": "auto", "taxi": "auto", "walk": "pedestrian"}


def _costing(country: str, mode: str | None) -> str:
    if mode in COSTING:
        return COSTING[mode]
    return "auto" if _drive(country) == "car" else "motor_scooter"


def _drive(country: str) -> str:
    """How people get around (pack.yaml `drive`): scooter by default."""
    try:
        return str(_packs.merged_pack(country).get("drive") or "scooter")
    except ToolError:
        return "scooter"


def _valhalla_cache() -> Path:
    return _base.config_dir() / "valhalla_cache.json"


async def valhalla_minutes(a: tuple[float, float], b: tuple[float, float], costing: str) -> tuple[float, float] | None:
    """Off-peak (minutes, km) from a to b via the public Valhalla server; cached on disk by rounded coordinates."""
    global _valhalla_last
    key = f"{costing}:{a[0]:.4f},{a[1]:.4f}>{b[0]:.4f},{b[1]:.4f}"
    cache_f = _valhalla_cache()
    cache: dict[str, Any] = {}
    if cache_f.is_file():
        with contextlib.suppress(ValueError, OSError):
            cache = json.loads(cache_f.read_text(encoding="utf-8"))
    if key in cache:
        v = cache[key]
        return None if v is None else (v[0], v[1])
    wait = _VALHALLA_MIN_INTERVAL - (time.monotonic() - _valhalla_last)
    if wait > 0:
        await asyncio.sleep(wait)
    body = {"locations": [{"lat": a[0], "lon": a[1]}, {"lat": b[0], "lon": b[1]}], "costing": costing, "units": "kilometers",
            "directions_options": {"units": "kilometers"}, "directions_type": "none"}
    try:
        async with httpx.AsyncClient(transport=_base._TRANSPORT, timeout=30) as c:
            r = await c.post(VALHALLA_URL, json=body, headers={"User-Agent": _base.USER_AGENT})
    except httpx.HTTPError as e:
        raise ToolError(f"Valhalla is not reachable ({type(e).__name__}); retry later.")
    finally:
        _valhalla_last = time.monotonic()
    if r.status_code == 429:
        raise ToolError("Valhalla rate limit (429): wait a minute and retry with fewer listings.")
    out: tuple[float, float] | None = None
    if r.status_code < 400:
        s = ((r.json() or {}).get("trip") or {}).get("summary") or {}
        if s.get("time") is not None:
            out = (float(s["time"]) / 60.0, float(s.get("length") or 0))
    cache[key] = None if out is None else [round(out[0], 2), round(out[1], 2)]
    cache_f.parent.mkdir(parents=True, exist_ok=True)
    cache_f.write_text(json.dumps(cache), encoding="utf-8")
    return out


@_base.mcp.tool()
async def travel_times_set(listing_id: str, times: list[dict], replace: bool = False) -> dict:
    """Store travel times from a listing to the brief anchors (shown on the listing, Mini App "Your places").
    times: [{"anchor_id": "a_surf", "minutes": 9, "km": 3.1, "mode": "scooter"}]; replace=True drops the others.
    Prefer travel_times_refresh, which computes them."""
    for t_ in times or []:
        if not isinstance(t_, dict) or not t_.get("anchor_id") or t_.get("minutes") is None:
            raise ToolError("Each time needs anchor_id and minutes.")
    return await _base.api("PUT", f"/api/listings/{_base._q(listing_id)}/travel", body={"times": times, "replace": replace})


@_base.mcp.tool()
async def travel_times_refresh(search_id: str, listing_ids: list[str] | None = None, force: bool = False, max_routes: int = 60) -> dict:
    """Compute rush-hour travel times from listings to every brief anchor (brief.anchors, + the legacy brief.anchor)
    with the free public Valhalla API (OSM): motor_scooter in Bali/Thailand, auto in Kazakhstan (an anchor's mode
    car/taxi/walk/scooter wins), multiplied by the city pack's travel.rush_factor, then stored with travel_times_set.
    Polite: ≤ 1 request/s, results cached in the Hunt config folder; listings without coordinates are skipped.
    listing_ids: default = every open listing of the search with lat/lng; force recomputes stored ones."""
    s = await _base.api("GET", f"/api/searches/{_base._q(search_id)}")
    search = s.get("search") or {}
    brief = search.get("brief") or {}
    region = search.get("region") or ""
    country = region.split("/")[0]
    anchors = [a for a in brief.get("anchors") or [] if isinstance(a, dict) and a.get("lat") is not None and a.get("lng") is not None]
    old = brief.get("anchor")
    if isinstance(old, dict) and old.get("lat") is not None and not any(a.get("id") == "anchor" for a in anchors):
        anchors.insert(0, {"id": "anchor", "name": old.get("label"), "lat": old["lat"], "lng": old["lng"], "mode": None})
    if not anchors:
        raise ToolError("The brief has no places with coordinates (brief.anchors). Ask the hunter or add them in the Mini App.")
    rush = 1.3
    with contextlib.suppress(ToolError):
        rush = float(((_packs.merged_pack(region) if region else {}).get("travel") or {}).get("rush_factor") or rush)
    listings = await _base.api("GET", f"/api/searches/{_base._q(search_id)}/listings")
    picked = [l for l in listings if l.get("lat") is not None and l.get("lng") is not None and l.get("status") != "closed"
              and (not listing_ids or l.get("id") in listing_ids)]
    done, skipped, routes = [], [], 0
    for l in picked:
        have = l.get("travel") if isinstance(l.get("travel"), dict) else {}
        times = []
        for a in anchors:
            if not force and a["id"] in have:
                continue
            if routes >= max_routes:
                break
            mode = a.get("mode") or _drive(country)
            res = await valhalla_minutes((float(l["lat"]), float(l["lng"])), (float(a["lat"]), float(a["lng"])), _costing(country, mode))
            routes += 1
            if res is None:
                continue
            times.append({"anchor_id": a["id"], "minutes": max(1, round(res[0] * (1 if mode == "walk" else rush))), "km": round(res[1], 1), "mode": mode})
        if times:
            await travel_times_set(l["id"], times)
            done.append({"listing_id": l["id"], "times": times})
        else:
            skipped.append(l["id"])
    return {"rush_factor": rush, "anchors": [a["id"] for a in anchors], "updated": done, "unchanged": skipped,
            "routes": routes, "note": "max_routes reached, run again" if routes >= max_routes else None}


# ---------------------------------------------------------------- wave 3: districts (areas) of a region pack

def _in_ring(x: float, y: float, ring: list) -> bool:
    ins = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-12) + xi:
            ins = not ins
        j = i
    return ins


def area_of_point(geo: dict, lat: float, lng: float) -> str | None:
    for f in (geo or {}).get("features") or []:
        g = f.get("geometry") or {}
        polys = [g.get("coordinates")] if g.get("type") == "Polygon" else g.get("coordinates") or [] if g.get("type") == "MultiPolygon" else []
        for p in polys:
            if p and _in_ring(lng, lat, p[0]) and not any(_in_ring(lng, lat, h) for h in p[1:]):
                return (f.get("properties") or {}).get("id")
    return None


@_base.mcp.tool()
async def region_districts(path: str, lat: float | None = None, lng: float | None = None) -> dict:
    """Areas of a country pack (districts.yaml): name, vibe, tags, scores 1-5 (surf, quiet, no_traffic, food,
    coworking, nightlife), airport/ocean minutes, market price fallback per bedrooms, pros/cons, the city-pack district
    slugs inside each area. With lat/lng also returns `area` = the area id containing that point (districts.geojson).
    Use it to explain areas to the hunter and to assign listings to areas; area ids are valid brief.districts slugs."""
    parts = _packs._check_path(path)
    cdir = _packs.regions_root() / parts[0]
    f = cdir / "districts.yaml"
    if not f.is_file():
        raise ToolError(f"No districts.yaml in pack {parts[0]!r}.")
    areas = (_packs._yaml(f).get("areas") or {})
    if len(parts) >= 2:
        city = {k: v for k, v in areas.items() if isinstance(v, dict) and v.get("city") == parts[1]}
        areas = city or areas
    out: dict[str, Any] = {"areas": _packs.jsonable(areas)}
    if lat is not None and lng is not None:
        g = cdir / "districts.geojson"
        out["area"] = area_of_point(json.loads(g.read_text(encoding="utf-8")), lat, lng) if g.is_file() else None
    return out


# ---------------------------------------------------------------- wave 4: shared helpers for external services

async def _sleep(seconds: float) -> None:
    """asyncio.sleep behind a name tests can replace."""
    await asyncio.sleep(seconds)


_OPEN_METEO_MIN_INTERVAL = 1.0  # seconds between elevation requests
_ext_last: dict[str, float] = {}
_BACKOFF = (2, 4, 8)  # seconds before retry 1, 2, 3 on 429 / 5xx / timeouts


class _OutOfBudget(Exception):
    """The per-call request budget is spent."""


async def _polite_request(
    gate: str,
    method: str,
    url: str,
    *,
    json_body: Any = None,
    counter: list[int] | None = None,
    max_n: int | None = None,
    timeout: float = 60.0,
    what: str = "The service",
) -> httpx.Response:
    """One request to a free public API: a minimum gap between requests per gate (Valhalla shares its gap with
    travel_times_refresh), exponential backoff on 429 / 5xx / timeouts, and an optional request budget
    (counter[0] counts every attempt; raises _OutOfBudget when it reaches max_n)."""
    global _valhalla_last
    delays = list(_BACKOFF)
    while True:
        if counter is not None and max_n is not None and counter[0] >= max_n:
            raise _OutOfBudget()
        interval = _VALHALLA_MIN_INTERVAL if gate == "valhalla" else _OPEN_METEO_MIN_INTERVAL
        last = _valhalla_last if gate == "valhalla" else _ext_last.get(gate, 0.0)
        wait = interval - (time.monotonic() - last)
        if wait > 0:
            await _sleep(wait)
        if counter is not None:
            counter[0] += 1
        r: httpx.Response | None = None
        timed_out = False
        try:
            async with httpx.AsyncClient(transport=_base._TRANSPORT, timeout=timeout) as c:
                r = await c.request(method, url, json=json_body, headers={"User-Agent": _base.USER_AGENT})
        except httpx.TimeoutException:
            timed_out = True
        except httpx.HTTPError as e:
            raise ToolError(f"{what} is not reachable ({type(e).__name__}); retry later.")
        finally:
            if gate == "valhalla":
                _valhalla_last = time.monotonic()
            else:
                _ext_last[gate] = time.monotonic()
        if r is not None and r.status_code != 429 and r.status_code < 500:
            return r
        if not delays:
            why = "timeouts" if timed_out else f"HTTP {r.status_code if r is not None else '?'}"
            raise ToolError(f"{what} kept failing ({why}) after {len(_BACKOFF)} retries; try again in a few minutes.")
        await _sleep(delays.pop(0))


def _json_cache_load(name: str) -> dict[str, Any]:
    f = _base.config_dir() / name
    if f.is_file():
        with contextlib.suppress(ValueError, OSError):
            data = json.loads(f.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                return data
    return {}


def _json_cache_save(name: str, data: dict[str, Any]) -> None:
    f = _base.config_dir() / name
    f.parent.mkdir(parents=True, exist_ok=True)
    tmp = f.with_suffix(f.suffix + ".tmp")
    tmp.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
    os.replace(tmp, f)


async def _search_region(search_id: str) -> tuple[dict, str, str]:
    s = await _base.api("GET", f"/api/searches/{_base._q(search_id)}")
    search = s.get("search") or {}
    region = search.get("region") or ""
    return search, region, region.split("/")[0]


def _rush_factor(region: str) -> float:
    rush = 1.3
    with contextlib.suppress(ToolError, TypeError, ValueError):
        rush = float(((_packs.merged_pack(region) if region else {}).get("travel") or {}).get("rush_factor") or rush)
    return rush


# ---------------------------------------------------------------- wave 4: places (user map lists)

PLACE_BASE_TYPES = ("beach", "surf", "coworking", "gym", "yoga", "supermarket", "market", "hospital", "pharmacy",
                    "coffee", "food", "daytrip")
PLACE_EXTRA_TYPES = ("nightlife", "construction", "other")
PLACE_SOURCES = ("google_list", "my_maps", "google_place", "manual")
MAX_PLACES_BATCH = 200

# Keyword rules for the type of an imported place (ru/en/id): pattern -> type. Order matters: the first matching
# pattern wins, so the more specific rules come first ("beach club" is nightlife, not beach; "surf cafe" is surf;
# "kitchen & bar" is food).
PLACE_TYPE_RULES: dict[str, str] = {
    r"beach\s*club|day\s*club|пляжн\w* клуб|hookah|кальян": "nightlife",
    r"co-?work|коворк|outpost|\bdojo\b|\bhub\b|hubud": "coworking",
    r"yoga|pilates|йог|пилатес": "yoga",
    r"\bgym\b|fitness|crossfit|muay\s*thai|boxing|\bmma\b|\bзал\b|спортзал|фитнес|кроссфит": "gym",
    r"surf|серф": "surf",
    r"apotek|pharmacy|guardian|kimia\s*farma|\bk-?24\b|аптек": "pharmacy",
    r"hospital|clinic|rumah\s*sakit|\brs\b|klinik|больниц|клиник|госпитал": "hospital",
    (r"supermarket|mini\s*-?market|pepito|grand\s*lucky|\bpopular\b|frestive|carrefour|tiara\s*dewata|"
     r"coco\s*mart|indomaret|alfamart|мини-?маркет|супермаркет"): "supermarket",
    r"\bpasar\b|\bmarkets?\b|рынок|рынк": "market",
    r"coffee|\bkopi\b|\bcaf[eé]s?\b|roast|espresso|кофе|кофейн": "coffee",
    (r"warung|restaurant|\bresto|\bfood\b|brunch|kitchen|bistro|eatery|pizz|sushi|burger|tacos?\b|bakery|ramen|\bpoke\b|\bbowls?\b|"
     r"ресторан|\bкафе\b|пекарн|еда\b"): "food",
    r"\bbar\b|\bclub\b|lounge|\bpub\b|клуб|\bбар\b": "nightlife",
    r"beach|\bpantai\b|пляж": "beach",
    r"temple|\bpura\b|waterfall|air\s*terjun|rice\s*terrace|volcano|храм|водопад|вулкан": "daytrip",
}
_PLACE_RULES = [(t, re.compile(rx, re.I)) for rx, t in PLACE_TYPE_RULES.items()]

_TIER_NEGATIVE = re.compile(
    r"не очень|так себе|дорого|плохо|грязн|не понрав|разочар|\bmeh\b|\bbad\b|overpriced|avoid|dirty|👎", re.I)
_TIER_POSITIVE = re.compile(
    r"лучш|топ|обожа|любим|супер|огонь|крут|\bmust\b|\bbest\b|amazing|\blove|favou?rite|🔥|❤|★|!!!", re.I)

_GMAPS_BROWSER_UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) "
                     "Chrome/124.0 Safari/537.36")
# Pre-accepted consent cookies so EU-routed requests are not sent to consent.google.com.
_GOOGLE_COOKIES = {"CONSENT": "YES+", "SOCS": "CAESEwgDEgk0ODE3Nzk3MjQaAmVuIAEaBgiA_LyaBg"}
GMAPS_GETLIST_URL = ("https://www.google.com/maps/preview/entitylist/getlist?authuser=0&hl=ru&gl=id"
                     "&pb=!1m4!1s{id}!2e1!3m1!1e1!2e2!3e2!4i500!16b1")
MYMAPS_KML_URL = "https://www.google.com/maps/d/kml?mid={mid}&forcekml=1"


def infer_place_type(name: str, address: str = "", note: str = "", layer: str = "") -> str | None:
    """Place type from keywords: name + note + My Maps layer first, the address only as a fallback
    (Bali street names like "Jl. Pantai Berawa" would otherwise turn every cafe into a beach)."""
    for text in (" ".join(x for x in (name, note, layer) if x), address or ""):
        if not text:
            continue
        for t, rx in _PLACE_RULES:
            if rx.search(text):
                return t
    return None


def infer_place_tier(note: str | None) -> int:
    """1 when the note is enthusiastic, 3 when it is negative (negative wins), else 2."""
    n = note or ""
    if _TIER_NEGATIVE.search(n):
        return 3
    if _TIER_POSITIVE.search(n):
        return 1
    return 2


def place_ext_key(name: str, lat: float, lng: float) -> str:
    """Default upsert key, the same as the Worker's: lowercased name + point rounded to 4 decimals."""
    return f"{(name or '').strip().lower()}@{float(lat):.4f},{float(lng):.4f}"


def _place_types(region: str | None = None) -> set[str]:
    """Allowed place types: the pack places.yaml types (the search region, else every pack) + nightlife/construction/other."""
    out = set(PLACE_EXTRA_TYPES)
    root = _packs.regions_root()
    files: list[Path] = []
    if region:
        files = [d / "places.yaml" for d in _packs._region_dirs(region)]
    elif root.is_dir():
        files = list(root.glob("*/places.yaml")) + list(root.glob("*/*/places.yaml"))
    found = False
    for f in files:
        if f.is_file():
            with contextlib.suppress(ToolError):
                types = _packs._yaml(f).get("types") or {}
                if isinstance(types, dict) and types:
                    out |= {str(k) for k in types}
                    found = True
    if not found:
        out |= set(PLACE_BASE_TYPES)
    return out


def _at(obj: Any, *idx: int) -> Any:
    """obj[i][j]... or None when any level is missing or not a list."""
    for i in idx:
        if not isinstance(obj, list) or i >= len(obj) or i < -len(obj):
            return None
        obj = obj[i]
    return obj


def _num(v: Any) -> float | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def parse_getlist(text: str) -> tuple[str | None, list[dict]]:
    """Parse Google Maps entitylist/getlist output into (list name, [{name, note, lat, lng, address}]).
    Only these fields are read: the list author's name, avatar and Google id are never touched."""
    t = (text or "").lstrip()
    if t.startswith(")]}'"):
        t = t.split("\n", 1)[1] if "\n" in t else ""
    try:
        d = json.loads(t)
    except ValueError:
        raise ToolError("Google returned something that is not a saved list (the list may be private: ask the hunter to share it publicly).")
    list_name = _at(d, 0, 4)
    items = _at(d, 0, 8)
    out = []
    for it in items if isinstance(items, list) else []:
        name, lat, lng = _at(it, 2), _num(_at(it, 1, 5, 2)), _num(_at(it, 1, 5, 3))
        if not isinstance(name, str) or not name.strip() or lat is None or lng is None:
            continue
        note, addr = _at(it, 3), _at(it, 1, 4)
        out.append({"name": name.strip(), "lat": lat, "lng": lng,
                    "note": note.strip() if isinstance(note, str) and note.strip() else None,
                    "address": addr.strip() if isinstance(addr, str) and addr.strip() else None})
    return (list_name.strip() if isinstance(list_name, str) and list_name.strip() else None), out


def _strip_html(s: str | None) -> str | None:
    if not s:
        return None
    s = re.sub(r"(?i)<br\s*/?>|</p>|</div>", "\n", s)
    s = html.unescape(re.sub(r"<[^>]+>", "", s))
    s = re.sub(r"[ \t]+", " ", re.sub(r"\n\s*\n+", "\n", s)).strip()
    return s or None


def parse_kml(text: str) -> tuple[str | None, list[dict]]:
    """Parse a Google My Maps KML export into (map name, [{name, note, lat, lng, layer}]); only Point placemarks."""
    try:
        root = ET.fromstring(text.encode("utf-8") if isinstance(text, str) else text)
    except ET.ParseError as e:
        raise ToolError(f"The My Maps export is not valid KML ({e}). Is the map shared publicly?")

    def tag(el: ET.Element) -> str:
        return el.tag.rsplit("}", 1)[-1]

    def child_text(el: ET.Element, name: str) -> str | None:
        for c in el:
            if tag(c) == name:
                return (c.text or "").strip() or None
        return None

    out: list[dict] = []

    def walk(el: ET.Element, layer: str | None) -> None:
        for c in el:
            t = tag(c)
            if t == "Folder":
                walk(c, child_text(c, "name") or layer)
            elif t == "Document":
                walk(c, layer)
            elif t == "Placemark":
                coords = None
                for p in c.iter():
                    if tag(p) == "Point":
                        coords = next(((q.text or "").strip() for q in p if tag(q) == "coordinates"), None)
                        break
                if not coords:
                    continue
                parts = coords.split(",")
                lng, lat = (_num(parts[0]), _num(parts[1])) if len(parts) >= 2 else (None, None)
                name = child_text(c, "name")
                if lat is None or lng is None or not name:
                    continue
                out.append({"name": name, "lat": lat, "lng": lng, "note": _strip_html(child_text(c, "description")), "layer": layer})

    doc = next((c for c in root if tag(c) == "Document"), root)
    walk(doc, None)
    return child_text(doc, "name"), out


_PLACE_URL_3D4D = re.compile(r"!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)")
_PLACE_URL_AT = re.compile(r"@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)")
_LIST_ID_STRICT = re.compile(r"!11m\d+!2s([A-Za-z0-9_-]{8,})")
_LIST_ID_LOOSE = re.compile(r"!2s([A-Za-z0-9_-]{10,})")


def classify_maps_url(url: str) -> tuple[str, Any]:
    """("my_maps", mid) | ("list", list_id) | ("place", {name, lat, lng}) for a resolved Google Maps URL."""
    u = unquote(url or "")
    pu = urlparse(u)
    qs = parse_qs(pu.query)
    if "/maps/d/" in pu.path:
        mid = (qs.get("mid") or [None])[0] or (re.search(r"mid=([\w-]+)", u) or [None, None])[1]
        if mid:
            return "my_maps", mid
    m = _LIST_ID_STRICT.search(u)
    if m:
        return "list", m.group(1)
    is_place = "/maps/place/" in pu.path or _PLACE_URL_3D4D.search(u)
    if is_place or _PLACE_URL_AT.search(pu.path):
        m3 = _PLACE_URL_3D4D.search(u) or _PLACE_URL_AT.search(u)
        if m3:
            name = None
            pm = re.search(r"/maps/place/([^/@]+)", pu.path)
            if pm:
                name = unquote_plus(pm.group(1)).strip() or None
            if is_place or not _LIST_ID_LOOSE.search(u):
                return "place", {"name": name, "lat": float(m3.group(1)), "lng": float(m3.group(2))}
    q = (qs.get("q") or qs.get("query") or [""])[0]
    mq = re.match(r"^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$", q)
    if mq:
        return "place", {"name": None, "lat": float(mq.group(1)), "lng": float(mq.group(2))}
    m = _LIST_ID_LOOSE.search(u)
    if m:
        return "list", m.group(1)
    raise ToolError("This does not look like a Google Maps saved list, a My Maps map or a place link. "
                    "Ask the hunter for the share link of the list (Saved → the list → Share).")


def _consent_continue(u: str) -> str:
    if "consent." in (urlparse(u).hostname or ""):
        return (parse_qs(urlparse(u).query).get("continue") or [u])[0]
    return u


_SHORT_LINK_HOSTS = ("goo.gl", "g.co")


def _short_link_host(host: str) -> bool:
    """goo.gl / g.co or their subdomains (maps.app.goo.gl), never look-alikes such as evilgoo.gl."""
    host = (host or "").lower().rstrip(".")
    return any(host == h or host.endswith("." + h) for h in _SHORT_LINK_HOSTS)


async def _resolve_maps_url(url: str) -> str:
    """Follow short links (maps.app.goo.gl) hop by hop until they leave goo.gl (the final Maps page itself is not
    downloaded); a consent.google.com hop yields its `continue` URL."""
    final = _consent_continue(url)
    try:
        # A browser User-Agent gets a JavaScript page from maps.app.goo.gl; a plain one gets the 302 we need.
        async with httpx.AsyncClient(transport=_base._TRANSPORT, timeout=30, follow_redirects=False, cookies=_GOOGLE_COOKIES) as c:
            for _ in range(6):
                host = (urlparse(final).hostname or "").lower()
                if not _short_link_host(host):
                    break
                r = await c.get(final, headers={"User-Agent": _base.USER_AGENT, "Accept-Language": "en"})
                loc = r.headers.get("location")
                if r.is_redirect and loc:
                    final = _consent_continue(str(r.url.join(loc)))
                    continue
                m = re.search(r"https://www\.google\.com/maps[^\"'\s<>\\]+",
                              r.text.replace("\\u003d", "=").replace("\\u0026", "&"))
                if not m:
                    raise ToolError("The short link did not lead to Google Maps; open it in a browser and paste the full link.")
                final = html.unescape(m.group(0))
    except httpx.HTTPError as e:
        raise ToolError(f"Cannot open the Google Maps link ({type(e).__name__}); check the link and the network.")
    return final


async def _google_get(url: str, what: str) -> str:
    try:
        async with httpx.AsyncClient(transport=_base._TRANSPORT, timeout=45, follow_redirects=True, cookies=_GOOGLE_COOKIES) as c:
            r = await c.get(url, headers={"User-Agent": _GMAPS_BROWSER_UA, "Accept-Language": "ru,en;q=0.8"})
    except httpx.HTTPError as e:
        raise ToolError(f"Cannot download the {what} from Google ({type(e).__name__}); retry later.")
    if r.status_code >= 400:
        raise ToolError(f"Google answered {r.status_code} for the {what}: is it shared publicly (anyone with the link)?")
    return r.text


async def _places_from_url(url: str) -> tuple[str, str | None, list[dict], str]:
    """(source, list_name, raw places, resolved url) for a Google Maps link."""
    final = await _resolve_maps_url(url.strip())
    kind, ref = classify_maps_url(final)
    if kind == "list":
        name, items = parse_getlist(await _google_get(GMAPS_GETLIST_URL.format(id=ref), "saved list"))
        for it in items:
            it["url"] = f"https://www.google.com/maps/search/?api=1&query={it['lat']},{it['lng']}"
        return "google_list", name, items, final
    if kind == "my_maps":
        name, items = parse_kml(await _google_get(MYMAPS_KML_URL.format(mid=quote(ref, safe="")), "My Maps map"))
        return "my_maps", name, items, final
    p = dict(ref)
    p["name"] = p.get("name") or "Pinned place"
    p["url"] = final
    return "google_place", None, [p], final


def _places_from_file(path: str) -> tuple[str, str | None, list[dict], str | None]:
    fp = Path(path).expanduser()
    if not fp.is_file():
        raise ToolError(f"File not found: {fp}")
    try:
        data = json.loads(fp.read_text(encoding="utf-8"))
    except ValueError as e:
        raise ToolError(f"{fp} is not valid JSON ({e}).")
    if isinstance(data, dict):
        data = data.get("places") or data.get("items") or []
    if not isinstance(data, list):
        raise ToolError(f"{fp} must hold a list of places [{{name, lat, lon, addr, note}}].")
    list_name, src_url = None, None
    side = fp.with_name(f"{fp.stem}.source.json")
    if side.is_file():
        with contextlib.suppress(ValueError, OSError):
            meta = json.loads(side.read_text(encoding="utf-8"))
            if isinstance(meta, dict):
                list_name = meta.get("name") if isinstance(meta.get("name"), str) else None
                src = meta.get("source")
                src_url = src if isinstance(src, str) and src.startswith("http") else None
    items = []
    for x in data:
        if not isinstance(x, dict):
            continue
        items.append({"name": str(x.get("name") or "").strip(), "lat": _num(x.get("lat")),
                      "lng": _num(x.get("lon") if x.get("lon") is not None else x.get("lng")),
                      "address": x.get("addr") or x.get("address"), "note": x.get("note"), "url": x.get("url") or src_url})
    return "google_list", list_name, items, src_url


def build_places(raw: list[dict], source: str, list_name: str | None, allowed: set[str],
                 types: dict[str, str] | None = None) -> tuple[list[dict], list[dict], int]:
    """Normalize raw places into CRM bodies: type + tier inference, ext_key, dedupe. Returns (places, unresolved, skipped)."""
    overrides = {str(k).strip().lower(): v for k, v in (types or {}).items()}
    seen: set[str] = set()
    places: list[dict] = []
    unresolved: list[dict] = []
    skipped = 0
    for r in raw:
        name = str(r.get("name") or "").strip()
        lat, lng = _num(r.get("lat")), _num(r.get("lng"))
        if not name or lat is None or lng is None or not (-90 <= lat <= 90 and -180 <= lng <= 180):
            skipped += 1
            continue
        key = place_ext_key(name, lat, lng)
        if key in seen:
            continue
        seen.add(key)
        note = (r.get("note") or "").strip() or None if isinstance(r.get("note"), str) else None
        address = (r.get("address") or "").strip() or None if isinstance(r.get("address"), str) else None
        t = overrides.get(key) or overrides.get(name.lower())
        if t and t not in allowed:
            raise ToolError(f"types[{name!r}] = {t!r} is not a place type; use one of {', '.join(sorted(allowed))}.")
        if not t:
            t = infer_place_type(name, address or "", note or "", r.get("layer") or "")
            if t and t not in allowed:
                t = None
        if not t:
            t = "other"
            unresolved.append({"name": name, "ext_key": key, "address": address})
        places.append(_base._clean({"name": name, "lat": round(lat, 6), "lng": round(lng, 6), "type": t, "tier": infer_place_tier(note),
                              "note": note, "address": address, "url": r.get("url"), "source": source, "list_name": list_name,
                              "ext_key": key}))
    return places, unresolved, skipped


@_base.mcp.tool()
async def places_import(
    search_id: str,
    url: str | None = None,
    path: str | None = None,
    types: dict | None = None,
    dry_run: bool = False,
    list_name: str | None = None,
) -> dict:
    """Import the hunter's own places (cafes, gyms, beaches they love) into the search: they feed the location score
    of every listing (the pack's travel-time rings, 10/20/40 minutes by default; own places weigh 1.5x) and show on the Mini App map.

    Args:
        url: a Google Maps share link: a saved list (maps.app.goo.gl/… or …!2s<id>…), a My Maps map (google.com/maps/d/…
            mid=…; its layers hint the type) or a single place link (/maps/place/<name>/@lat,lng…).
        path: a local JSON list [{name, lat, lon|lng, addr|address, note}] (e.g. ~/.config/hunt/places/<name>.json;
            a sibling <name>.source.json {source, list_id, name} gives the list name).
        types: {place name or ext_key: type} overrides after you decided unclear ones.
        dry_run: preview only (counts by type, unresolved, first 20 items); nothing is written.
        list_name: overrides the list name shown in the Mini App.
    The type comes from keywords (ru/en/id) in the name, note and layer (the address only as a fallback); tier from the
    note (1 enthusiastic, 3 negative, else 2). Places with no clear type become "other" and are listed in `unresolved`:
    decide each one (look at the name/address) and fix it with place_set or re-run with `types`. The list author's
    name, avatar and Google id are never read or stored. Upsert by ext_key (lowercased name + point to 4 decimals),
    so re-importing the same list updates instead of duplicating. Returns {added, updated, by_type, unresolved, list_name}.
    """
    if bool(url) == bool(path):
        raise ToolError("Give exactly one of url (a Google Maps link) or path (a local JSON file).")
    _, region, _ = await _search_region(search_id)
    allowed = _place_types(region or None)
    if url:
        source, name, raw, _ = await _places_from_url(url)
    else:
        source, name, raw, _ = _places_from_file(path or "")
    lname = list_name or name
    places, unresolved, skipped = build_places(raw, source, lname, allowed, types)
    if not places:
        raise ToolError("No places with a name and coordinates were found at that link/file.")
    by_type = dict(Counter(p["type"] for p in places).most_common())
    hint = ("Decide a type for each (beach, surf, coworking, gym, yoga, supermarket, market, hospital, pharmacy, coffee, "
            "food, daytrip, nightlife, construction, other) and call place_set(place_id, type=…), "
            "or re-run places_import with types={name: type}.") if unresolved else None
    if dry_run:
        return {"dry_run": True, "count": len(places), "by_type": by_type, "unresolved": unresolved, "unresolved_hint": hint,
                "skipped": skipped, "list_name": lname, "source": source,
                "items": [{k: p.get(k) for k in ("name", "type", "tier", "note", "address")} for p in places[:20]]}
    added = updated = 0
    ids: dict[str, str] = {}
    for i in range(0, len(places), MAX_PLACES_BATCH):
        batch = [_base._clean(p) for p in places[i:i + MAX_PLACES_BATCH]]
        res = await _base.api("POST", f"/api/searches/{_base._q(search_id)}/places", body={"places": batch}, timeout=60)
        added += int(res.get("added") or 0)
        updated += int(res.get("updated") or 0)
        for p in res.get("places") or []:
            if isinstance(p, dict) and p.get("ext_key") and p.get("id"):
                ids[p["ext_key"]] = p["id"]
    for u in unresolved:
        if u["ext_key"] in ids:
            u["place_id"] = ids[u["ext_key"]]
    return {"added": added, "updated": updated, "count": len(places), "by_type": by_type, "unresolved": unresolved,
            "unresolved_hint": hint, "skipped": skipped, "list_name": lname, "source": source}


@_base.mcp.tool()
async def places_list(search_id: str) -> dict:
    """The search's own places (incl. hidden) and a summary of the region's base places:
    {places:[{id, name, type, tier, note, area, lat, lng, source, list_name, hidden}], base:{count, types}}."""
    return await _base.api("GET", f"/api/searches/{_base._q(search_id)}/places")


@_base.mcp.tool()
async def place_set(
    place_id: str,
    type: str | None = None,
    tier: int | None = None,
    note: str | None = None,
    name: str | None = None,
    hidden: bool | None = None,
    delete: bool = False,
) -> dict:
    """Fix one of the search's places (ids pl_…): type (beach | surf | coworking | gym | yoga | supermarket | market |
    hospital | pharmacy | coffee | food | daytrip | nightlife | construction (a penalty only when quiet matters) | other
    (shown, not scored)), tier (1 top, 2 good, 3 ordinary), note, name, hidden (keeps it but drops it from the map and
    the score). delete=True removes it. Location scores are recomputed by the CRM."""
    if delete:
        return await _base.api("DELETE", f"/api/places/{_base._q(place_id)}")
    if type is not None and type not in _place_types():
        raise ToolError(f"type must be one of {', '.join(sorted(_place_types()))}.")
    if tier is not None and tier not in (1, 2, 3):
        raise ToolError("tier must be 1 (top), 2 (good) or 3 (ordinary).")
    body = _base._clean({"type": type, "tier": tier, "note": note, "name": name, "hidden": hidden})
    if not body:
        raise ToolError("Nothing to change.")
    return await _base.api("PATCH", f"/api/places/{_base._q(place_id)}", body=body)
