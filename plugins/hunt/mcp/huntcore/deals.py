"""Hunt core: deals (split from hunt_core.py)."""
from __future__ import annotations
import re
from typing import Any
import httpx
from huntcore.base import ToolError
from huntcore import base as _base, packs as _packs, routes as _routes
# ---------------------------------------------------------------- viewings

VIEWING_STATUSES = ("proposed", "confirmed", "done", "cancelled")
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_ISO_WITH_TZ = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$")


@_base.mcp.tool()
async def viewing_set(
    search_id: str,
    listing_id: str,
    viewing_id: str = "new",
    starts_at: str | None = None,
    status: str | None = None,
    meet_note: str | None = None,
    outcome: str | None = None,
) -> dict:
    """Create (viewing_id="new") or update a viewing.

    Args:
        starts_at: LOCAL time of the place with offset, e.g. "2026-11-18T10:00:00+08:00" (the day plan
            groups by the local date). Use time_info(tz) for the region's timezone.
        status: proposed | confirmed | done | cancelled.
        meet_note: "front office at villa 2", "current tenants will meet".
        outcome: after the viewing, what you/they saw and decided.
    When updating, omitted fields keep their current values.
    """
    if status and status not in VIEWING_STATUSES:
        raise ToolError(f"status must be one of {', '.join(VIEWING_STATUSES)}.")
    if starts_at and not _ISO_WITH_TZ.match(starts_at):
        raise ToolError("starts_at must be ISO local time with offset, e.g. 2026-11-18T10:00:00+08:00.")
    body: dict[str, Any] = {"search_id": search_id, "listing_id": listing_id}
    if viewing_id != "new":
        # The API overwrites every column on update; carry the current values over.
        lg = await _base.api("GET", f"/api/listings/{_base._q(listing_id)}")
        cur = next((v for v in lg.get("viewings", []) if v.get("id") == viewing_id), None)
        if cur:
            for k in ("starts_at", "status", "meet_note", "outcome"):
                if cur.get(k) is not None:
                    body[k] = cur[k]
    body.update(_base._clean({"starts_at": starts_at, "status": status, "meet_note": meet_note, "outcome": outcome}))
    if not body.get("starts_at"):
        raise ToolError("starts_at is required for a new viewing.")
    return await _base.api("PUT", f"/api/viewings/{_base._q(viewing_id)}", body=body)


@_base.mcp.tool()
async def viewings_day(search_id: str, date: str) -> dict:
    """Viewings of a search on a local date (YYYY-MM-DD) in time order, with a Google Maps route link
    through the non-cancelled ones. Returns {viewings, route}."""
    _routes._parse_date(date)
    return await _base.api("GET", f"/api/searches/{_base._q(search_id)}/viewings", params={"date": date})


@_base.mcp.tool()
async def day_plan_post(search_id: str, date: str) -> dict:
    """Post the day plan (viewings with times, places and the route) to the search chat, or to the
    owner's DM if no group is connected. date: local YYYY-MM-DD."""
    _routes._parse_date(date)
    return await _base.api("POST", f"/api/searches/{_base._q(search_id)}/day-plan", body={"date": date})


# ---------------------------------------------------------------- deals

_SECRET_KEY = re.compile(r"password|passwd|пароль|(?<![a-z])pin(?![a-z])|pin_?code|cvv|cvc|secret|token", re.I)
_ID_KEY = re.compile(
    r"passport|паспорт|paspor|pasport|(?<![a-z])(nik|ktp|iin|ssn|iban|swift)(?![a-z])|иин|card_?(num|no)|^card$|"
    r"account_?(num|no)|routing", re.I)
_PASSPORT_IN_TEXT = re.compile(
    r"(passport|паспорт\w*|paspor|pasport|\bnik\b|\bktp\b|id\s*card|\biin\b|иин)\s*"
    r"(no\.?|number|num|#|№|номер|nomor)?\s*[:#№-]?\s*([A-Z]{0,2}\s?\d{6,12}|\d{2}\s?\d{2}\s?\d{6})(?!\d)", re.I)
_CARD_CANDIDATE = re.compile(r"(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)")


def _luhn(digits: str) -> bool:
    total, alt = 0, False
    for ch in reversed(digits):
        d = int(ch)
        if alt:
            d *= 2
            if d > 9:
                d -= 9
        total += d
        alt = not alt
    return total % 10 == 0


def sensitive_findings(data: Any) -> list[str]:
    """Reasons why data looks like it holds passport/ID/card/bank numbers or secrets (empty = fine)."""
    found: list[str] = []

    def walk(v: Any, path: str, key: str) -> None:
        if isinstance(v, dict):
            for k, x in v.items():
                walk(x, f"{path}.{k}" if path else str(k), str(k))
            return
        if isinstance(v, list):
            for i, x in enumerate(v):
                walk(x, f"{path}[{i}]", key)
            return
        if v is None or isinstance(v, bool) or v == "":
            return
        s = str(v)
        if _SECRET_KEY.search(key):
            found.append(f"{path}: looks like a password/PIN/secret")
            return
        if _ID_KEY.search(key) and len(re.sub(r"\D", "", s)) >= 6:
            found.append(f"{path}: field looks like an ID, card or bank number")
            return
        if _PASSPORT_IN_TEXT.search(s):
            found.append(f"{path}: text contains what looks like a passport/ID number")
        for m in _CARD_CANDIDATE.finditer(s):
            if m.start() > 0 and s[m.start() - 1] == "+":  # phone number
                continue
            digits = re.sub(r"\D", "", m.group(0))
            if 13 <= len(digits) <= 19 and _luhn(digits) and len(set(digits)) > 1:
                found.append(f"{path}: text contains what looks like a payment card number")
                break

    walk(data, "", "")
    return found


@_base.mcp.tool()
async def deal_set(listing_id: str, data: dict) -> dict:
    """Save the deal for the chosen listing: name (what the members call the house, e.g. "House in Ungasan"),
    terms {type, from, to, rent, currency}, deposit{}, checklist[{text, done}], dates[] (or use deal_dates_set),
    contract_versions[] (summaries; files go through doc_upload / the bot). Replaces the whole deal object.
    When data.terms.rent is present the CRM records it as the agreed price automatically (if none is set yet) and
    takes the first price seen for the listing as the asked price (feeds the recap "saved"); correct either with
    deal_prices_set.
    Members tick checklist items in the Mini App (digest event "checklist"): read the current deal with
    listing_get(listing_id)["deal"] and keep their "done" flags when you rewrite it.

    Never put passport/ID numbers, card numbers, bank account numbers or passwords here: this tool
    refuses data that looks like them. Write "passport copy sent to landlord" instead of the number.
    """
    if not isinstance(data, dict):
        raise ToolError("data must be an object.")
    bad = sensitive_findings(data)
    if bad:
        raise ToolError("Refused: deal data looks like it contains sensitive numbers. Remove them and retry. " + "; ".join(bad))
    try:
        return await _base.api("PUT", f"/api/deals/{_base._q(listing_id)}", body=data)
    except ToolError as e:
        if "sensitive" in str(e):
            raise ToolError(
                f"{e} Note: the CRM refuses any deal that mentions 'passport' together with a 6+ digit number "
                "(IDR amounts count). Reword without the word passport (e.g. 'ID document copy') or split amounts."
            )
        raise


# ---------------------------------------------------------------- ratings after viewings

_AUDIO_EXT = {"audio/webm": ".webm", "audio/ogg": ".ogg", "audio/mp4": ".m4a", "audio/mpeg": ".mp3", "audio/wav": ".wav", "audio/x-m4a": ".m4a"}


_IMG_EXT = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/heic": ".heic"}


async def _download_voice(key: str) -> str:
    """Fetch a rating voice note once into <config>/voice/ and return the local path."""
    return await _download_media(key, "voice", "/api/voice")


async def _download_media(key: str, sub: str, path: str = "/api/media") -> str:
    """Fetch a KV media file (voice note, on-site photo, receipt) once into <config>/<sub>/ and return the local path."""
    url, token = _base._creds()
    safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", key)
    folder = _base.config_dir() / sub
    for p in folder.glob(safe + ".*") if folder.exists() else []:
        return str(p)
    try:
        async with httpx.AsyncClient(base_url=url, transport=_base._TRANSPORT, timeout=60) as c:
            r = await c.get(path, params={"key": key},
                            headers=_base._crm_headers(token))
    except httpx.HTTPError as e:
        raise ToolError(f"Cannot download {key} ({type(e).__name__}).")
    if r.status_code >= 400:
        raise ToolError(f"CRM {r.status_code} while downloading {key}.")
    ctype = r.headers.get("content-type", "").split(";")[0].strip()
    ext = _AUDIO_EXT.get(ctype) or _IMG_EXT.get(ctype) or ".bin"
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / (safe + ext)
    path.write_bytes(r.content)
    return str(path)


def checklist_items(region: str | None) -> dict[str, dict]:
    """On-site checklist items of the region's country pack (checklist.yaml), by id."""
    if not region:
        return {}
    try:
        parts = _packs._check_path(region)
    except ToolError:
        return {}
    f = _packs.regions_root() / parts[0] / "checklist.yaml"
    if not f.is_file():
        return {}
    items = _packs._yaml(f).get("items") or []
    return {str(i.get("id")): i for i in items if isinstance(i, dict) and i.get("id")}


@_base.mcp.tool()
async def ratings_get(search_id: str, download_voice: bool = True, download_photos: bool = False) -> dict:
    """Group interest (votes before viewing) and ratings (after viewing) per listing, best first.

    interest: {score, max, votes, by:[{user_id, decision}]}; weights take +3, want_view +2, thinking +1,
    not_interested -2; max = 3 x members who can vote.
    rating: {score (1 decimal, mean of member scores), by_member:[{user_id, display_name, score, overall, area,
    inside, quiet}], criteria:{overall, area, inside, quiet} (group means, 1-5), weak:[criteria < 3],
    notes:[{user_id, note, voice?}]} or null when nobody rated yet.
    Voice notes (key in notes[].voice) are downloaded to the local config folder when download_voice is true;
    their paths come back as notes[].voice_path, so you can transcribe them.
    onsite: the on-site checklist members ticked at the viewing: {items:{<item id>: {label, ok, not_ok,
    notes:[{name, ok, note}]}}, photos:[KV keys]} or null; labels come from the pack checklist.yaml.
    download_photos=true saves the on-site photos to <config>/onsite/ (photo_paths).
    checks: your scam check of the listing (listing_checks_set) or null.
    Use it after viewings: rank by score, then price and interest, and name the weak spots
    (low criteria, "not ok" checklist items with their notes).
    Returns {region, voters, listings:[{listing_id, title, district, price, currency, decision, status, interest,
    rating, onsite, checks}]}.
    """
    data = await _base.api("GET", f"/api/searches/{_base._q(search_id)}/ratings")
    labels = checklist_items(data.get("region"))
    for row in data.get("listings", []):
        os_ = row.get("onsite")
        if not os_:
            continue
        for item_id, it in (os_.get("items") or {}).items():
            lab = (labels.get(item_id) or {}).get("label")
            if lab:
                it["label"] = lab
        if download_photos:
            paths = []
            for k in os_.get("photos") or []:
                try:
                    paths.append(await _download_media(k, "onsite"))
                except ToolError as e:
                    os_.setdefault("photo_errors", []).append(str(e))
            os_["photo_paths"] = paths
    if download_voice:
        for row in data.get("listings", []):
            for n in (row.get("rating") or {}).get("notes", []):
                if n.get("voice"):
                    try:
                        n["voice_path"] = await _download_voice(n["voice"])
                    except ToolError as e:
                        n["voice_error"] = str(e)
    return data
