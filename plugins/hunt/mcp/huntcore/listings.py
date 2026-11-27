"""Hunt core: listings (split from hunt_core.py)."""
from __future__ import annotations
import mimetypes
import re
from pathlib import Path
from typing import Any
from huntcore.base import ToolError
from huntcore import base as _base
# ---------------------------------------------------------------- listings

LISTING_STATUSES = ("new", "contacted", "talking", "needs_you", "viewing", "rejected", "taken", "closed")


def _listing_body(**kw: Any) -> dict[str, Any]:
    b = _base._clean(kw)
    if "status" in b and b["status"] not in LISTING_STATUSES:
        raise ToolError(f"status must be one of {', '.join(LISTING_STATUSES)}.")
    return b


@_base.mcp.tool()
async def listing_upsert(
    search_id: str,
    listing_id: str,
    title: str | None = None,
    district: str | None = None,
    area_text: str | None = None,
    lat: float | None = None,
    lng: float | None = None,
    map_url: str | None = None,
    property_type: str | None = None,
    bedrooms: int | None = None,
    bathrooms: int | None = None,
    size_m2: float | None = None,
    price: int | None = None,
    currency: str | None = None,
    price_note: str | None = None,
    includes: list[str] | None = None,
    available: str | None = None,
    fields: dict | None = None,
    source: str | None = None,
    source_url: str | None = None,
    summary: str | None = None,
    status: str | None = None,
    next_step: str | None = None,
) -> dict:
    """Create or update a listing in a search (PUT, idempotent). Only given fields are written.

    Args:
        listing_id: stable slug from the source, e.g. "fb-1722243245987208", "krisha-12345", "tg-odegalle-1".
            Re-using the id updates the same listing; the same id in another search is refused.
        title: required when the listing is new.
        district: district slug from the region pack (region_get → districts).
        price: per month, local currency, main units (23000000 for 23M IDR).
        fields: region pack listing_fields values, e.g. {"living_room": "closed_ac", "pool": "private"}.
        includes: e.g. ["wifi", "water", "cleaning"].
        property_type: villa | house | apartment | condo | townhouse | room.
        status: new | contacted | talking | needs_you | viewing | rejected | taken | closed.
        summary: your 1–3 line take for humans. next_step: what happens next, human readable.
    Humans set `decision` by voting; photos go through listing_photos.
    Returns {listing, created}.
    """
    body = _listing_body(
        title=title, district=district, area_text=area_text, lat=lat, lng=lng, map_url=map_url,
        property_type=property_type, bedrooms=bedrooms, bathrooms=bathrooms, size_m2=size_m2, price=price,
        currency=currency, price_note=price_note, includes=includes, available=available, fields=fields,
        source=source, source_url=source_url, summary=summary, status=status, next_step=next_step,
    )
    return await _base.api("PUT", f"/api/searches/{_base._q(search_id)}/listings/{_base._q(listing_id)}", body=body)


@_base.mcp.tool()
async def listing_list(
    search_id: str,
    status: str | None = None,
    decision: str | None = None,
    district: str | None = None,
    q: str | None = None,
) -> list:
    """List listings of a search (newest update first, max 500), optionally filtered.
    decision: want_view | thinking | not_interested | take. q searches title, summary and area_text."""
    return await _base.api("GET", f"/api/searches/{_base._q(search_id)}/listings",
                     params={"status": status, "decision": decision, "district": district, "q": q})


@_base.mcp.tool()
async def listing_get(listing_id: str) -> dict:
    """Get a listing with its contacts, the last 30 logged messages, viewings and votes."""
    return await _base.api("GET", f"/api/listings/{_base._q(listing_id)}")


@_base.mcp.tool()
async def listing_update(
    listing_id: str,
    title: str | None = None,
    district: str | None = None,
    area_text: str | None = None,
    lat: float | None = None,
    lng: float | None = None,
    map_url: str | None = None,
    property_type: str | None = None,
    bedrooms: int | None = None,
    bathrooms: int | None = None,
    size_m2: float | None = None,
    price: int | None = None,
    currency: str | None = None,
    price_note: str | None = None,
    includes: list[str] | None = None,
    available: str | None = None,
    fields: dict | None = None,
    source: str | None = None,
    source_url: str | None = None,
    summary: str | None = None,
    status: str | None = None,
    next_step: str | None = None,
    short_name: str | None = None,
) -> dict:
    """Patch a listing; only given fields change. `fields` replaces the whole fields object
    (read with listing_get and send the merged dict). Same field meanings as listing_upsert.
    short_name: once the group picked this home, a short house name for the Mini App titles (max 40 chars), e.g.
        "Дом в Унгасане" or "Вилла с бассейном"; "" clears it (the app then shows "Дом в <district>").
    Call listing_publish afterwards to refresh the card in the search chat."""
    body = _listing_body(
        title=title, district=district, area_text=area_text, lat=lat, lng=lng, map_url=map_url,
        property_type=property_type, bedrooms=bedrooms, bathrooms=bathrooms, size_m2=size_m2, price=price,
        currency=currency, price_note=price_note, includes=includes, available=available, fields=fields,
        source=source, source_url=source_url, summary=summary, status=status, next_step=next_step,
    )
    if short_name is not None:
        body["short_name"] = short_name.strip() or None
    if not body:
        raise ToolError("Nothing to update.")
    return await _base.api("PATCH", f"/api/listings/{_base._q(listing_id)}", body=body)


MAX_PHOTO_BYTES = 10 * 1024 * 1024  # Telegram photo limit
PHOTO_EXT = {".jpg", ".jpeg", ".png", ".webp"}


async def _search_chat(listing_id: str) -> tuple[dict, dict]:
    lg = await _base.api("GET", f"/api/listings/{_base._q(listing_id)}")
    s = await _base.api("GET", f"/api/searches/{_base._q(lg['listing']['search_id'])}")
    return lg, s.get("search", {})


@_base.mcp.tool()
async def listing_photos(listing_id: str, paths: list[str] | None = None, urls: list[str] | None = None) -> dict:
    """Attach photos to a listing. They are stored in the CRM (Cloudflare KV) and shown in the
    Mini App; if the search has a Telegram group, the album is also posted there. Each call
    REPLACES the listing's photos, max 10: pick the best (outside, living room, bedroom,
    bathroom, kitchen, pool, view).

    Args:
        paths: local image files (jpg/png/webp, ≤10 MB each), e.g. from tg_media.
        urls: public image URLs (used as-is).
    """
    paths = paths or []
    urls = urls or []
    if bool(paths) == bool(urls):
        raise ToolError("Give either paths (local files) or urls, not both and not neither.")
    items = paths or urls
    if len(items) > 10:
        raise ToolError(f"{len(items)} photos given; max 10 per listing (one Telegram album). Pick the best 10.")
    if urls:
        bad = [u for u in urls if not re.match(r"^https?://", u)]
        if bad:
            raise ToolError(f"Not http(s) URLs: {bad}")
        return await _base.api("POST", f"/api/listings/{_base._q(listing_id)}/photos", body={"urls": urls}, timeout=90)
    files = []
    for p in paths:
        fp = Path(p).expanduser()
        if not fp.is_file():
            raise ToolError(f"File not found: {fp}")
        if fp.suffix.lower() not in PHOTO_EXT:
            raise ToolError(f"Not a photo (jpg/png/webp): {fp.name}. Videos cannot go into the card album.")
        size = fp.stat().st_size
        if size > MAX_PHOTO_BYTES:
            raise ToolError(f"{fp.name} is {size / 1e6:.1f} MB; Telegram photos must be ≤10 MB. Resize it first.")
        files.append((fp, mimetypes.guess_type(fp.name)[0] or "image/jpeg"))
    multipart = [("photo", (fp.name, fp.read_bytes(), mime)) for fp, mime in files]
    return await _base.api("POST", f"/api/listings/{_base._q(listing_id)}/photos", files=multipart, timeout=120)


@_base.mcp.tool()
async def listing_publish(listing_id: str) -> dict:
    """Post the listing card to the search chat, or refresh it in place if already posted
    (after listing_update). Humans vote on the card (want_view / thinking / not_interested)."""
    _, search = await _search_chat(listing_id)
    out = await _base.api("POST", f"/api/listings/{_base._q(listing_id)}/publish", body={})
    if not search.get("tg_chat_id"):
        out = {**out, "posted": False,
               "note": "No Telegram group for this search: the listing is visible in the Mini App only."}
    else:
        out = {**out, "posted": True}
    return out
