"""Hunt core: location (split from hunt_core.py)."""
from __future__ import annotations
import contextlib
import json
from typing import Any
from huntcore.base import ToolError
from huntcore import base as _base, packs as _packs, places as _places
# ---------------------------------------------------------------- wave 4: location score (isochrones)

VALHALLA_ISOCHRONE_URL = "https://valhalla1.openstreetmap.de/isochrone"
DEFAULT_RINGS = (10, 20, 40)  # minutes; pack.yaml `location.rings` overrides
DEFAULT_RING_WEIGHTS = (1.0, 0.7, 0.3)
MAX_ISOCHRONE_BYTES = 1_400_000
ISOCHRONE_CACHE = "isochrone_cache.json"


def location_rings(region: str) -> tuple[list[int], list[float]]:
    """The location-score ring set (minutes, ascending) and weights of a region: merged pack.yaml
    `location: {rings: [10, 20, 40], weights: [1.0, 0.7, 0.3]}` (a city pack may override), else that default.
    An invalid pack value falls back to the default (the CRM does the same when it builds regions.json)."""
    loc: Any = None
    with contextlib.suppress(ToolError, TypeError, ValueError):
        loc = (_packs.merged_pack(region) if region else {}).get("location")
    rings = (loc or {}).get("rings") if isinstance(loc, dict) else None
    weights = (loc or {}).get("weights") if isinstance(loc, dict) else None
    ok = (isinstance(rings, list) and rings and all(isinstance(r, int) and not isinstance(r, bool) and r > 0 for r in rings)
          and all(rings[k] < rings[k + 1] for k in range(len(rings) - 1))
          and isinstance(weights, list) and len(weights) == len(rings)
          and all(isinstance(w, (int, float)) and not isinstance(w, bool) and 0 <= w <= 1 for w in weights))
    if not ok:
        return list(DEFAULT_RINGS), list(DEFAULT_RING_WEIGHTS)
    return [int(r) for r in rings], [float(w) for w in weights]


def rush_note(rush: float) -> str:
    """'in rush hour roughly +30%' for rush_factor 1.3 (isochrones are free-flow; rush hour is only a note)."""
    pct = round((rush - 1) * 100)
    return f"Rings are free-flow travel times; in rush hour roughly +{pct}%." if pct > 0 else "Rings are free-flow travel times."


def _round_coords(c: Any, nd: int) -> Any:
    if isinstance(c, list):
        if c and all(isinstance(x, (int, float)) for x in c):
            return [round(float(x), nd) for x in c]
        return [_round_coords(x, nd) for x in c]
    return c


def isochrone_rings(geo: dict, rings: list[int], nd: int = 5) -> dict:
    """Valhalla isochrone FeatureCollection → one feature per ring with properties {ring: <minutes>} (rings = the
    pack ring set, e.g. [10, 20, 40]). Each feature goes to the ring closest to its `contour` (Valhalla returns the
    largest first; without a contour value that order is used)."""
    feats = [f for f in (geo or {}).get("features") or []
             if isinstance(f, dict) and (f.get("geometry") or {}).get("type") in ("Polygon", "MultiPolygon")]
    out: dict[int, dict] = {}
    for i, f in enumerate(feats):
        c = _places._num((f.get("properties") or {}).get("contour"))
        if c is not None:
            j = min(range(len(rings)), key=lambda k: abs(rings[k] - c))
        else:
            j = len(feats) - 1 - i
            if not 0 <= j < len(rings):
                continue
        ring = rings[j]
        if ring in out:
            continue
        g = f["geometry"]
        out[ring] = {"type": "Feature", "properties": {"ring": ring},
                     "geometry": {"type": g["type"], "coordinates": _round_coords(g.get("coordinates"), nd)}}
    return {"type": "FeatureCollection", "features": [out[r] for r in rings if r in out]}


def isochrone_body(lat: float, lng: float, costing: str, rings: list[int]) -> dict:
    """Valhalla isochrone request: free-flow contours at exactly the ring minutes (no rush-hour division)."""
    return {
        "locations": [{"lat": lat, "lon": lng, "search_filter": {"min_road_class": "tertiary", "max_road_class": "primary"}}],
        "costing": costing,
        "contours": [{"time": float(t)} for t in rings],
        "polygons": True,
        "denoise": 0.3,
        "generalize": 15,
    }


def isochrone_cache_key(costing: str, rings: list[int], lat: float, lng: float) -> str:
    """Disk cache key; includes the ring set so contours computed for another ring set (or the legacy
    rush-divided 5/10/30 ones, keyed costing|rush|lat,lng) are never reused."""
    return f"{costing}|r{'-'.join(str(r) for r in rings)}|{lat:.4f},{lng:.4f}"


@_base.mcp.tool()
async def location_refresh(search_id: str, listing_ids: list[str] | None = None, force: bool = False, max_requests: int = 40) -> dict:
    """Compute the location score of listings: FREE-FLOW isochrones (motor_scooter in Bali/Thailand, auto in
    Kazakhstan) at the region pack's ring minutes (pack.yaml `location.rings`, default 10/20/40) from the free public
    Valhalla API, stored in the CRM, which scores what is inside each ring: place = tier × ring weight (10 min 1,
    20 min 0.7, 40 min 0.3 by default) × type weight, own places ×1.5. The city pack's travel.rush_factor is only a
    note in the result ("in rush hour roughly +30%"); it is not applied to the contours. The search_filter snaps the
    start to a real road (tertiary..primary), not to a private lane.
    Polite: ≥ 1.1 s between requests, backoff 2/4/8 s on 429/5xx/timeouts, at most max_requests per call;
    polygons are cached in the Hunt config folder per ring set. listing_ids: default = every open listing with lat/lng;
    listings that already have isochrones for the current ring set are skipped unless force (force also bypasses the
    cache); listings the CRM marks stale (stored for another ring set, score null) are always recomputed.
    Returns {updated:[{listing_id, score, was_stale?}], skipped, requests, ring_set, ring_weights, rush_factor,
    rush_note, costing, note}."""
    _, region, country = await _places._search_region(search_id)
    costing = "auto" if _places._drive(country) == "car" else "motor_scooter"
    rush = _places._rush_factor(region)
    rings, weights = location_rings(region)
    locs = await _base.api("GET", f"/api/searches/{_base._q(search_id)}/locations")
    locs = locs if isinstance(locs, list) else (locs or {}).get("locations") or []
    has_iso = {x.get("listing_id"): bool(x.get("has_isochrones")) for x in locs if isinstance(x, dict)}
    stale = {x.get("listing_id"): bool(x.get("stale")) for x in locs if isinstance(x, dict)}
    listings = await _base.api("GET", f"/api/searches/{_base._q(search_id)}/listings")
    picked = [l for l in listings if l.get("lat") is not None and l.get("lng") is not None and l.get("status") != "closed"
              and (not listing_ids or l.get("id") in listing_ids)]
    cache = _places._json_cache_load(ISOCHRONE_CACHE)
    counter = [0]
    updated: list[dict] = []
    skipped: list[dict] = []
    note = None
    for l in picked:
        lid = l["id"]
        if not force and has_iso.get(lid) and not stale.get(lid):
            skipped.append({"listing_id": lid, "reason": "has isochrones (force=True to redo)"})
            continue
        lat, lng = float(l["lat"]), float(l["lng"])
        key = isochrone_cache_key(costing, rings, lat, lng)
        geo = None if force else cache.get(key)
        if geo is None:
            try:
                r = await _places._polite_request("valhalla", "POST", VALHALLA_ISOCHRONE_URL, json_body=isochrone_body(lat, lng, costing, rings),
                                          counter=counter, max_n=max_requests, what="Valhalla")
            except _places._OutOfBudget:
                note = f"max_requests ({max_requests}) reached; run again for the rest"
                break
            if r.status_code >= 400:
                skipped.append({"listing_id": lid, "reason": f"Valhalla {r.status_code}: {(r.text or '')[:120]}"})
                continue
            try:
                geo = isochrone_rings(r.json(), rings)
            except ValueError:
                skipped.append({"listing_id": lid, "reason": "Valhalla returned non-JSON"})
                continue
            if not geo["features"]:
                skipped.append({"listing_id": lid, "reason": "no isochrone polygons (point far from roads?)"})
                continue
            cache[key] = geo
            _places._json_cache_save(ISOCHRONE_CACHE, cache)
        if len(json.dumps(geo, separators=(",", ":"))) > MAX_ISOCHRONE_BYTES:
            geo = {"type": "FeatureCollection", "features": [
                {**f, "geometry": {**f["geometry"], "coordinates": _round_coords(f["geometry"]["coordinates"], 4)}} for f in geo["features"]]}
        try:
            res = await _base.api("PUT", f"/api/listings/{_base._q(lid)}/isochrones",
                            body={"costing": costing, "rush": rush, "rings": rings, "geo": geo})
        except ToolError as e:
            if "bad_rings" in str(e):
                raise ToolError(f"{e} The local region pack's ring set {rings} differs from the deployed CRM's; update the "
                                "Hunt plugin (region packs) or ask the owner to redeploy the CRM, then retry.")
            raise
        row = {"listing_id": lid, "score": ((res or {}).get("location") or {}).get("score")}
        if stale.get(lid):
            row["was_stale"] = True
        updated.append(row)
    return {"updated": updated, "skipped": skipped, "requests": counter[0], "ring_set": rings, "ring_weights": weights,
            "rush_factor": rush, "rush_note": rush_note(rush), "costing": costing, "note": note}


@_base.mcp.tool()
async def location_get(listing_id: str) -> dict:
    """The location score breakdown of a listing: {location: {score, base, groups:[{key, weight, s, points, n}],
    penalties, rings:{"10"|"20"|"40": {points, places}} (keys = the pack ring minutes), ring_set, ring_weights,
    rush_factor, anchors, quiet, at} | null, has_isochrones, ring_set, ring_weights, rush_factor, stale}.
    Rings are free-flow travel times; mention rush hour as roughly +(rush_factor-1)·100 %. stale = the stored
    isochrones were computed for another ring set (score null): run location_refresh.
    Use it to explain the score in the hunter's words ("2 beaches and Pepito within 10 minutes, no gym")."""
    return await _base.api("GET", f"/api/listings/{_base._q(listing_id)}/location")
