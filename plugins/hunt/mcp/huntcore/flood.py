"""Hunt core: flood (split from hunt_core.py)."""
from __future__ import annotations
import contextlib
import json
import math
from typing import Any
from huntcore.base import ToolError
from huntcore import base as _base, deals as _deals, packs as _packs, places as _places
# ---------------------------------------------------------------- wave 4: flood risk

OPEN_METEO_ELEVATION_URL = "https://api.open-meteo.com/v1/elevation"
FLOOD_LEVELS = ("low", "medium", "high")
FLOOD_SOURCE_KINDS = ("terrain", "chats", "notes", "area")
FLOOD_RINGS_M = (150, 400)
_FLOOD_LABEL = {"ru": {"low": "низкий", "medium": "средний", "high": "высокий"},
                "en": {"low": "low", "medium": "medium", "high": "high"}}


def flood_points(lat: float, lng: float) -> list[tuple[float, float]]:
    """The point, then 8 points on a 150 m ring and 8 on a 400 m ring (N, NE, E, …)."""
    pts = [(round(lat, 5), round(lng, 5))]
    k = 111_320.0
    for r in FLOOD_RINGS_M:
        for i in range(8):
            a = math.radians(i * 45)
            dlat = r * math.cos(a) / k
            dlng = r * math.sin(a) / (k * max(0.01, math.cos(math.radians(lat))))
            pts.append((round(lat + dlat, 5), round(lng + dlng, 5)))
    return pts


def terrain_level(diff: float) -> str:
    if diff <= -6:
        return "high"
    if diff <= -2.5:
        return "medium"
    return "low"


def combine_flood(terrain: str, area: str | None, chat_count: int = 0) -> str:
    """Max of the terrain and area levels; ≥ 3 chat mentions raise it by one level."""
    idx = FLOOD_LEVELS.index(terrain)
    if area in FLOOD_LEVELS:
        idx = max(idx, FLOOD_LEVELS.index(area))
    if chat_count >= 3:
        idx = min(idx + 1, len(FLOOD_LEVELS) - 1)
    return FLOOD_LEVELS[idx]


def _terrain_text(diff: float, lang: str) -> str:
    d = abs(diff)
    if lang == "ru":
        if d < 0.5:
            return "Вилла на одном уровне с окрестностями (16 точек в 150–400 м)."
        return f"Вилла на {d:.1f} м {'ниже' if diff < 0 else 'выше'} окрестностей (среднее 16 точек в 150–400 м)."
    if d < 0.5:
        return "The villa is level with its surroundings (16 points within 150–400 m)."
    return f"The villa is {d:.1f} m {'below' if diff < 0 else 'above'} its surroundings (mean of 16 points within 150–400 m)."


def _loc_text(v: Any, lang: str) -> str | None:
    if isinstance(v, dict):
        v = v.get(lang) or v.get("en") or next(iter(v.values()), None)
    return str(v).strip() if v else None


async def _elevations(points: list[tuple[float, float]], key: str, cache: dict, counter: list[int]) -> list[float] | None:
    if key in cache:
        return cache[key]
    lats = ",".join(f"{p[0]:.5f}" for p in points)
    lngs = ",".join(f"{p[1]:.5f}" for p in points)
    r = await _places._polite_request("open_meteo", "GET", f"{OPEN_METEO_ELEVATION_URL}?latitude={lats}&longitude={lngs}",
                              counter=counter, what="Open-Meteo elevation")
    if r.status_code >= 400:
        return None
    try:
        elev = (r.json() or {}).get("elevation")
    except ValueError:
        return None
    if not isinstance(elev, list) or len(elev) != len(points) or any(_places._num(e) is None for e in elev):
        return None
    cache[key] = [float(e) for e in elev]
    _places._json_cache_save("elevation_cache.json", cache)
    return cache[key]


@_base.mcp.tool()
async def flood_refresh(search_id: str, listing_ids: list[str] | None = None, chat_mentions: dict | None = None, force: bool = False) -> dict:
    """Estimate the flood risk of listings and store it (Mini App flood card): terrain from the free Open-Meteo
    elevation API (the point vs the mean of 8 points at 150 m and 8 at 400 m; ~90 m DEM, so a rough signal):
    ≥ 6 m below → high, ≥ 2.5 m below → medium, else low; combined (max) with the area default from districts.yaml
    (`flood`); ≥ 3 chat mentions raise it one level.
    chat_mentions: {listing_id: {count, text}} you collected from the region's chats ("floods every January,
    the street is knee-deep"). Texts are written in the hunter's language (GET /api/me → user.lang).
    Polite: ≥ 1 s between requests, elevations cached. Listings that already have a flood estimate are skipped
    unless force or they have chat_mentions. Returns {updated:[{listing_id, level, diff}], skipped, requests}."""
    _, region, country = await _places._search_region(search_id)
    me = await _base.api("GET", "/api/me")
    lang = "ru" if (((me or {}).get("user") or {}).get("lang") or "").lower().startswith("ru") else "en"
    cdir = _packs.regions_root() / country if country else None
    areas: dict = {}
    geo: dict = {}
    if cdir and (cdir / "districts.yaml").is_file():
        with contextlib.suppress(ToolError):
            areas = _packs._yaml(cdir / "districts.yaml").get("areas") or {}
    if cdir and (cdir / "districts.geojson").is_file():
        with contextlib.suppress(ValueError, OSError):
            geo = json.loads((cdir / "districts.geojson").read_text(encoding="utf-8"))
    mentions = {str(k): v for k, v in (chat_mentions or {}).items() if isinstance(v, dict)}
    listings = await _base.api("GET", f"/api/searches/{_base._q(search_id)}/listings")
    picked = [l for l in listings if l.get("lat") is not None and l.get("lng") is not None and l.get("status") != "closed"
              and (not listing_ids or l.get("id") in listing_ids)]
    cache = _places._json_cache_load("elevation_cache.json")
    counter = [0]
    updated: list[dict] = []
    skipped: list[dict] = []
    for l in picked:
        lid = l["id"]
        if not force and lid not in mentions and isinstance(l.get("flood"), dict) and l["flood"].get("level"):
            skipped.append({"listing_id": lid, "reason": "already estimated (force=True to redo)"})
            continue
        lat, lng = float(l["lat"]), float(l["lng"])
        pts = flood_points(lat, lng)
        elev = await _elevations(pts, f"{lat:.4f},{lng:.4f}", cache, counter)
        if elev is None:
            skipped.append({"listing_id": lid, "reason": "no elevation data"})
            continue
        ring_mean = sum(elev[1:]) / len(elev[1:])
        diff = round(elev[0] - ring_mean, 1)
        t_level = terrain_level(diff)
        area_id = _places.area_of_point(geo, lat, lng) if geo else None
        area = areas.get(area_id) if isinstance(areas.get(area_id), dict) else {}
        area_flood = area.get("flood") if isinstance(area.get("flood"), dict) else {}
        a_level = area_flood.get("level") if area_flood.get("level") in FLOOD_LEVELS else None
        m = mentions.get(lid) or {}
        count = int(_places._num(m.get("count")) or 0)
        level = combine_flood(t_level, a_level, count)
        ru = lang == "ru"
        sources = [{"kind": "terrain", "title": "Рельеф" if ru else "Terrain", "text": _terrain_text(diff, lang)}]
        if m.get("text") or count:
            sources.append({"kind": "chats", "title": (f"Чаты: {count} упоминаний" if ru else f"Chats: {count} mentions"),
                            "text": str(m.get("text") or "").strip() or ("Упоминания в чатах района" if ru else "Mentions in the area chats")})
        anote = _loc_text(area_flood.get("note"), lang)
        if anote:
            sources.append({"kind": "area", "title": _loc_text(area.get("name"), lang) or str(area_id), "text": anote})
        label = _FLOOD_LABEL[lang][level]
        summary = (f"Риск подтопления {label}. " if ru else f"Flood risk {label}. ") + sources[0]["text"]
        body = {"level": level, "summary": summary, "sources": sources,
                "terrain": {"elev": round(elev[0], 1), "ring_mean": round(ring_mean, 1), "diff": diff, "ring_m": FLOOD_RINGS_M[-1]}}
        bad = _deals.sensitive_findings(body)
        if bad:
            raise ToolError("Refused: chat_mentions text contains " + "; ".join(bad))
        await _base.api("PUT", f"/api/listings/{_base._q(lid)}/flood", body=body)
        updated.append({"listing_id": lid, "level": level, "diff": diff})
    return {"updated": updated, "skipped": skipped, "requests": counter[0]}


@_base.mcp.tool()
async def flood_set(listing_id: str, level: str, summary: str, sources: list[dict]) -> dict:
    """Set the flood risk of a listing by hand (e.g. after the owner admitted the street floods).
    level: low | medium | high. summary: one line in the hunter's language.
    sources: [{kind: terrain | chats | notes | area, title, text}]. Members' own notes are kept by the CRM."""
    if level not in FLOOD_LEVELS:
        raise ToolError("level must be low, medium or high.")
    if not summary or not str(summary).strip():
        raise ToolError("summary is required.")
    if not isinstance(sources, list):
        raise ToolError("sources must be a list of {kind, title, text}.")
    for i, s in enumerate(sources):
        if not isinstance(s, dict) or s.get("kind") not in FLOOD_SOURCE_KINDS or not s.get("title") or not s.get("text"):
            raise ToolError(f"sources[{i}] needs kind ({' | '.join(FLOOD_SOURCE_KINDS)}), title and text.")
    body = {"level": level, "summary": summary.strip(), "sources": sources}
    bad = _deals.sensitive_findings(body)
    if bad:
        raise ToolError("Refused: " + "; ".join(bad))
    return await _base.api("PUT", f"/api/listings/{_base._q(listing_id)}/flood", body=body)
