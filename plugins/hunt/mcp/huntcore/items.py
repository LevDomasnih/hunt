"""Hunt core: items (split from hunt_core.py)."""
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
from huntcore import base as _base, deals as _deals, routes as _routes
# ---------------------------------------------------------------- wave 4: bikes

BIKE_PERIODS = ("month", "week", "day")
BIKE_CHANNELS = ("whatsapp", "telegram", "phone")
BIKE_STATUSES = ("active", "returned")
BIKE_CHECKLIST = ("video", "helmets", "stnk", "fuel")
_PASSPORT_WORD = re.compile(r"паспорт|passport|paspor", re.I)
_COPY_WORD = re.compile(r"копи|copy|copie|salinan|fotokop|scan|скан", re.I)


def deposit_is_original_passport(deposit: str | None) -> bool:
    d = deposit or ""
    return bool(_PASSPORT_WORD.search(d)) and not _COPY_WORD.search(d)


@_base.mcp.tool()
async def bike_set(
    search_id: str,
    bike_id: str = "new",
    model: str | None = None,
    plate: str | None = None,
    rider_id: str | None = None,
    price: float | None = None,
    currency: str | None = None,
    period: str | None = None,
    paid_until: str | None = None,
    deposit: str | None = None,
    rental_name: str | None = None,
    channel: str | None = None,
    address: str | None = None,
    phone: str | None = None,
    checklist: dict | None = None,
    status: str | None = None,
    date_from: str | None = None,
    return_date: str | None = None,
    note: str | None = None,
    pay: dict | None = None,
    delete: bool = False,
) -> dict:
    """Add (bike_id="new") or update a rented bike/scooter; omitted fields keep their values. The bot reminds about
    the payment 2 days before paid_until and on the day, and about the return on return_date.

    Args:
        model: "Honda Scoopy 2023". plate: "DK 1234 AB". rider_id: the member's user_id who rides it (none = shared).
        price + currency + period (month | week | day): the rent. paid_until / date_from / return_date: YYYY-MM-DD.
        deposit: what was left ("1M IDR cash", "passport copy"). NEVER the original passport: refused.
        rental_name, channel (whatsapp | telegram | phone), address (number or @handle), phone: the rental contact.
        checklist: {video|helmets|stnk|fuel: {done, note?}} (video of scratches at pick-up, 2 helmets, STNK papers, fuel).
        status: active | returned.
        pay: {amount, paid_by, until, date?, currency?} also logs a payment (a "transport" expense) and moves
            paid_until to `until`.
        delete: remove the bike.
    Returns {bike, warning?, payment?}."""
    if delete:
        if bike_id == "new":
            raise ToolError("bike_id is required to delete.")
        return await _base.api("DELETE", f"/api/searches/{_base._q(search_id)}/bikes/{_base._q(bike_id)}")
    if deposit_is_original_passport(deposit):
        raise ToolError("Refused: the deposit looks like the original passport. Never leave the original passport with a "
                        "rental (it is illegal to withhold it and the classic way to extort 'damage' money); leave a copy and "
                        "a cash deposit instead. If it really is a copy, say so: deposit='passport copy + 1M IDR'.")
    if period and period not in BIKE_PERIODS:
        raise ToolError("period must be month, week or day.")
    if channel and channel not in BIKE_CHANNELS:
        raise ToolError("channel must be whatsapp, telegram or phone.")
    if status and status not in BIKE_STATUSES:
        raise ToolError("status must be active or returned.")
    for v in (paid_until, date_from, return_date):
        if v:
            _routes._parse_date(v)
    if price is not None and (not isinstance(price, (int, float)) or price < 0):
        raise ToolError("price must be a non-negative number in main units.")
    if checklist is not None:
        if not isinstance(checklist, dict):
            raise ToolError("checklist must be {video|helmets|stnk|fuel: {done, note?}}.")
        for k, v in checklist.items():
            if k not in BIKE_CHECKLIST or not isinstance(v, dict) or not isinstance(v.get("done"), bool):
                raise ToolError(f"checklist.{k} must be one of {', '.join(BIKE_CHECKLIST)} with {{done: true|false, note?}}.")
    if bike_id == "new" and not model:
        raise ToolError("model is required for a new bike.")
    if pay is not None:
        if not isinstance(pay, dict) or not isinstance(pay.get("amount"), (int, float)) or pay["amount"] <= 0 \
                or not pay.get("paid_by") or not pay.get("until"):
            raise ToolError("pay needs amount (> 0), paid_by (user_id) and until (YYYY-MM-DD); date and currency are optional.")
        _routes._parse_date(pay["until"])
        if pay.get("date"):
            _routes._parse_date(pay["date"])
    body = _base._clean({"model": model, "plate": plate, "rider_id": rider_id, "price": price, "currency": currency, "period": period,
                   "paid_until": paid_until, "deposit": deposit, "rental_name": rental_name, "channel": channel, "address": address,
                   "phone": phone, "checklist": checklist, "status": status, "date_from": date_from, "return_date": return_date,
                   "note": note})
    bad = _deals.sensitive_findings({k: body.get(k) for k in ("model", "plate", "deposit", "rental_name", "address", "note", "checklist")})
    if bad:
        raise ToolError("Refused: " + "; ".join(bad))
    if not body and pay is None:
        raise ToolError("Nothing to change.")
    out: dict[str, Any] = {}
    bid = bike_id
    if body or bike_id == "new":
        out = await _base.api("PUT", f"/api/searches/{_base._q(search_id)}/bikes/{_base._q(bike_id)}", body=body)
        bid = ((out or {}).get("bike") or {}).get("id") or bike_id
    if pay is not None:
        if bid == "new":
            raise ToolError("The CRM did not return the new bike id; call bike_set again with bike_id and pay.")
        pbody = _base._clean({"amount": pay["amount"], "currency": pay.get("currency"), "date": pay.get("date"),
                        "paid_by": pay["paid_by"], "until": pay["until"]})
        out["payment"] = await _base.api("POST", f"/api/bikes/{_base._q(bid)}/pay", body=pbody)
        if isinstance(out["payment"], dict) and out["payment"].get("bike"):
            out["bike"] = out["payment"]["bike"]
    return out


@_base.mcp.tool()
async def bikes_get(search_id: str) -> dict:
    """Rented bikes of a search: {bikes:[{id, model, plate, rider_id, price, currency, period, paid_until, deposit,
    rental_name, channel, address, phone, checklist, status, date_from, return_date, note}]}."""
    return await _base.api("GET", f"/api/searches/{_base._q(search_id)}/bikes")


# ---------------------------------------------------------------- wave 4: 3D scans

SCAN_PHASES = ("movein", "moveout", "bike")
SCAN_STATUSES = ("ok", "redo", "todo")
MAX_SCAN_BYTES = 19 * 1024 * 1024  # Bot API getFile reads ≤ 20 MB
_SCAN_TIMEOUT = 600
_SCAN_STEPS = (
    ["--compress", "meshopt", "--texture-compress", "webp", "--texture-size", "2048"],
    ["--compress", "meshopt", "--texture-compress", "webp", "--texture-size", "1024"],
    ["--compress", "draco", "--texture-compress", "webp", "--texture-size", "1024", "--simplify", "true", "--simplify-error", "0.001"],
)


def _run_cmd(cmd: list[str], cwd: str, timeout: int) -> subprocess.CompletedProcess:
    """subprocess.run without a shell; tests replace it."""
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout, check=False)


def _mb(n: int) -> float:
    return round(n / 1024 / 1024, 2)


async def scan_prepare_impl(path: str, max_mb: float = 18) -> dict:
    fp = Path(path).expanduser()
    if not fp.is_file():
        raise ToolError(f"File not found: {fp}")
    ext = fp.suffix.lower()
    if ext == ".usdz":
        raise ToolError("USDZ is not supported (Apple-only and there is no converter here). In Scaniverse / Polycam / "
                        "3D Scanner App export the scan as GLB (Share → Export → GLB) and send that file.")
    if ext not in (".glb", ".gltf"):
        raise ToolError(f"{fp.name}: a 3D scan must be a .glb (or .gltf) file.")
    size = fp.stat().st_size
    limit = int(max_mb * 1024 * 1024)
    if ext == ".glb" and size <= limit:
        return {"path": str(fp), "size_mb": _mb(size), "compressed": False, "steps": []}
    npx = shutil.which("npx")
    if not npx:
        raise ToolError(f"{fp.name} is {_mb(size)} MB (limit {max_mb} MB) and compressing it needs Node.js (npx), which is "
                        "not installed. Install Node.js (https://nodejs.org) or re-export the scan with smaller textures.")
    out_dir = _base.config_dir() / "scans"
    out_dir.mkdir(parents=True, exist_ok=True)
    stem = re.sub(r"[^\w.-]+", "_", fp.stem)
    final = out_dir / f"{stem}.min.glb"
    steps: list[dict] = []
    with tempfile.TemporaryDirectory(prefix="hunt-scan-") as tmp:
        for i, flags in enumerate(_SCAN_STEPS):
            out = Path(tmp) / f"step{i + 1}.glb"
            cmd = [npx, "--yes", "@gltf-transform/cli", "optimize", str(fp), str(out), *flags]
            try:
                res = await asyncio.to_thread(_run_cmd, cmd, tmp, _SCAN_TIMEOUT)
            except subprocess.TimeoutExpired:
                raise ToolError(f"gltf-transform did not finish in {_SCAN_TIMEOUT // 60} minutes on {fp.name}.")
            except OSError as e:
                raise ToolError(f"Cannot run npx ({type(e).__name__}: {e}).")
            if res.returncode != 0 or not out.is_file():
                tail = ((res.stderr or "") + (res.stdout or "")).strip()[-400:]
                raise ToolError(f"gltf-transform failed on {fp.name} (exit {res.returncode}): {tail}")
            new = out.stat().st_size
            steps.append({"flags": " ".join(flags), "size_mb": _mb(new)})
            if new <= limit:
                shutil.copyfile(out, final)
                return {"path": str(final), "size_mb": _mb(new), "compressed": True, "steps": steps,
                        "original_mb": _mb(size)}
    raise ToolError(f"{fp.name} is still {steps[-1]['size_mb']} MB after compression (limit {max_mb} MB). Re-scan the room "
                    "in smaller parts or export with lower texture quality.")


@_base.mcp.tool()
async def scan_prepare(path: str, max_mb: float = 18) -> dict:
    """Get a local 3D scan ready for upload. .usdz is refused (export GLB from Scaniverse / Polycam instead).
    A .glb ≤ max_mb is returned as is; a bigger one (or a .gltf) is compressed with `npx @gltf-transform/cli optimize`
    (meshopt + WebP 2048 px textures, then 1024 px, then Draco + simplify) into the Hunt config folder.
    Needs Node.js only when compressing. Returns {path, size_mb, compressed, steps}."""
    return await scan_prepare_impl(path, max_mb)


@_base.mcp.tool()
async def scan_upload(
    listing_id: str,
    path: str,
    room: str,
    phase: str = "movein",
    bike_id: str | None = None,
    note: str | None = None,
    app: str | None = None,
    scan_id: str | None = None,
) -> dict:
    """Upload a 3D scan (GLB) of a room or a bike as part of the move-in/move-out act: compressed first if needed
    (scan_prepare), then the bot sends it to the hunter's Telegram DM and the CRM keeps the file id.
    room: "Bedroom 1", "Kitchen", "Pool". phase: movein | moveout | bike (with bike_id). app: Scaniverse / Polycam / ….
    scan_id: fills a planned scan (status todo). Returns {scan, document}."""
    if phase not in SCAN_PHASES:
        raise ToolError("phase must be movein, moveout or bike.")
    if not room or not room.strip():
        raise ToolError("room is required (e.g. 'Bedroom 1', 'Kitchen', or the bike plate).")
    prep = await scan_prepare_impl(path, 18)
    fp = Path(prep["path"])
    size = fp.stat().st_size
    if size > MAX_SCAN_BYTES:
        raise ToolError(f"{fp.name} is {_mb(size)} MB; the bot can read files up to 19 MB.")
    meta = _base._clean({"room": room.strip(), "phase": phase, "bike_id": bike_id, "note": note, "app": app, "scan_id": scan_id})
    bad = _deals.sensitive_findings(meta)
    if bad:
        raise ToolError("Refused: " + "; ".join(bad))
    name = fp.name if fp.suffix.lower() == ".glb" else f"{fp.stem}.glb"
    files = [("file", (name, fp.read_bytes(), "model/gltf-binary"))] + [(k, (None, str(v))) for k, v in meta.items()]
    out = await _base.api("POST", f"/api/listings/{_base._q(listing_id)}/scans", files=files, timeout=180)
    if isinstance(out, dict):
        out["prepared"] = {"size_mb": prep["size_mb"], "compressed": prep["compressed"]}
    return out


@_base.mcp.tool()
async def scan_set(
    search_id: str,
    scan_id: str = "new",
    room: str | None = None,
    phase: str | None = None,
    status: str | None = None,
    note: str | None = None,
    listing_id: str | None = None,
    bike_id: str | None = None,
    doc_id: str | None = None,
    app: str | None = None,
    sort: int | None = None,
) -> dict:
    """Plan or update a scan row of the 3D act: status todo = a room still to scan (no file), ok, redo (scan again).
    phase: movein | moveout | bike. sort orders the rooms. Files come via scan_upload or the bot DM (a .glb with the room
    as caption). Returns {scan}."""
    if phase and phase not in SCAN_PHASES:
        raise ToolError("phase must be movein, moveout or bike.")
    if status and status not in SCAN_STATUSES:
        raise ToolError("status must be ok, redo or todo.")
    if scan_id == "new" and not (room and phase):
        raise ToolError("room and phase are required for a new scan.")
    body = _base._clean({"listing_id": listing_id, "room": room, "phase": phase, "bike_id": bike_id, "status": status, "note": note,
                   "doc_id": doc_id, "app": app, "sort": sort})
    if not body:
        raise ToolError("Nothing to change.")
    bad = _deals.sensitive_findings(body)
    if bad:
        raise ToolError("Refused: " + "; ".join(bad))
    return await _base.api("PUT", f"/api/searches/{_base._q(search_id)}/scans/{_base._q(scan_id)}", body=body)


@_base.mcp.tool()
async def scans_get(search_id: str) -> dict:
    """3D scans of a search (move-in, move-out, bikes) with their documents: {scans:[{id, listing_id, room, phase,
    bike_id, status, note, app, sort, document}]}."""
    return await _base.api("GET", f"/api/searches/{_base._q(search_id)}/scans")


# ---------------------------------------------------------------- wave 4: house dossier

DOSSIER_ITEM_KINDS = ("issue", "power", "cleaning", "conflict", "good", "money", "other")
DOSSIER_STATS_KEYS = ("months", "price", "currency", "price_note", "issues")


@_base.mcp.tool()
async def dossier_match(listing_id: str) -> dict:
    """House dossiers (shared across the whole Hunt instance) that match a listing: the same listing, a point within
    80 m, the same owner identity or the same title. Check it before a viewing: earlier tenants' issues, power, money
    disputes. Returns {dossiers}."""
    return await _base.api("GET", "/api/dossiers/match", params={"listing_id": listing_id})


@_base.mcp.tool()
async def dossier_get(dossier_id: str) -> dict:
    """One house dossier with its items and the live issues of the linked listings: {dossier}."""
    return await _base.api("GET", f"/api/dossiers/{_base._q(dossier_id)}")


@_base.mcp.tool()
async def dossier_set(
    dossier_id: str = "new",
    title: str | None = None,
    listing_id: str | None = None,
    area_text: str | None = None,
    lat: float | None = None,
    lng: float | None = None,
    owner_contact_id: str | None = None,
    verdict_title: str | None = None,
    verdict: str | None = None,
    stats: dict | None = None,
) -> dict:
    """Create (dossier_id="new") or update a house dossier: what the house is really like to live in, kept for the
    next hunters of this Hunt. title: "Villa Kenanga, Ungasan". listing_id (one of your listings) links it (added to
    listing_ids) and is required for a new dossier; an existing dossier can be changed only once one of your listings is linked;
    owner_contact_id ties the owner's identity. verdict_title + verdict: the short conclusion in the hunter's language.
    stats: {months, price, currency, price_note, issues}. No ID/passport/card numbers. Returns {dossier}."""
    if dossier_id == "new" and not title:
        raise ToolError("title is required for a new dossier.")
    if (lat is None) != (lng is None):
        raise ToolError("Give both lat and lng, or neither.")
    if stats is not None:
        if not isinstance(stats, dict) or any(k not in DOSSIER_STATS_KEYS for k in stats):
            raise ToolError(f"stats keys must be among {', '.join(DOSSIER_STATS_KEYS)}.")
    body = _base._clean({"title": title, "listing_id": listing_id, "area_text": area_text, "lat": lat, "lng": lng,
                   "owner_contact_id": owner_contact_id, "verdict_title": verdict_title, "verdict": verdict, "stats": stats})
    if not body:
        raise ToolError("Nothing to change.")
    bad = _deals.sensitive_findings(body)
    if bad:
        raise ToolError("Refused: " + "; ".join(bad))
    return await _base.api("PUT", f"/api/dossiers/{_base._q(dossier_id)}", body=body)


@_base.mcp.tool()
async def dossier_item_add(
    dossier_id: str,
    kind: str,
    title: str,
    text: str | None = None,
    sentiment: int = 0,
    date: str | None = None,
    search_id: str | None = None,
) -> dict:
    """Add a fact to a house dossier. kind: issue | power | cleaning | conflict | good | money | other.
    sentiment: 1 good, -1 bad, 0 neutral. date: YYYY-MM-DD when it happened. Short, factual, in the hunter's language
    ("Pump broke twice in March, owner fixed it in 2 days"). search_id: your search the fact comes from (default: the
    search of your listing linked to the dossier; only you can delete the item later). Returns {item}."""
    if kind not in DOSSIER_ITEM_KINDS:
        raise ToolError(f"kind must be one of {', '.join(DOSSIER_ITEM_KINDS)}.")
    if sentiment not in (-1, 0, 1):
        raise ToolError("sentiment must be 1, 0 or -1.")
    if not title or not title.strip():
        raise ToolError("title is required.")
    if date:
        _routes._parse_date(date)
    body = _base._clean({"kind": kind, "title": title.strip(), "text": text, "sentiment": sentiment, "date": date, "search_id": search_id})
    bad = _deals.sensitive_findings(body)
    if bad:
        raise ToolError("Refused: " + "; ".join(bad))
    return await _base.api("POST", f"/api/dossiers/{_base._q(dossier_id)}/items", body=body)


@_base.mcp.tool()
async def dossier_item_delete(item_id: str) -> dict:
    """Delete one fact from a house dossier (only facts added from your own searches)."""
    return await _base.api("DELETE", f"/api/dossier-items/{_base._q(item_id)}")


# ---------------------------------------------------------------- wave 4: things bought with the villa

ITEM_STATUSES = ("have", "offered", "sold")


@_base.mcp.tool()
async def items_get(search_id: str) -> dict:
    """Things the group bought for the house (fan, kettle, mattress…): {items, total, currency, resale_target}
    (resale_target = Σ item targets, else 60 % of the unsold total). Offer them to the next tenants before moving out."""
    return await _base.api("GET", f"/api/searches/{_base._q(search_id)}/items")


@_base.mcp.tool()
async def item_set(
    search_id: str,
    item_id: str = "new",
    name: str | None = None,
    price: float | None = None,
    currency: str | None = None,
    seller: str | None = None,
    bought_at: str | None = None,
    icon: str | None = None,
    status: str | None = None,
    sold_price: float | None = None,
    resale_target: float | None = None,
    note: str | None = None,
    listing_id: str | None = None,
    delete: bool = False,
) -> dict:
    """Add (item_id="new") or update a thing bought for the house; omitted fields keep their values.
    price / sold_price / resale_target in main units; bought_at YYYY-MM-DD; icon: a lucide name (fan, bed, refrigerator,
    microwave, lamp…); status: have | offered | sold. delete=True removes it. Returns {item}."""
    if delete:
        if item_id == "new":
            raise ToolError("item_id is required to delete.")
        return await _base.api("DELETE", f"/api/searches/{_base._q(search_id)}/items/{_base._q(item_id)}")
    if status and status not in ITEM_STATUSES:
        raise ToolError("status must be have, offered or sold.")
    for k, v in (("price", price), ("sold_price", sold_price), ("resale_target", resale_target)):
        if v is not None and (not isinstance(v, (int, float)) or v < 0):
            raise ToolError(f"{k} must be a non-negative number in main units.")
    if bought_at:
        _routes._parse_date(bought_at)
    if item_id == "new" and not name:
        raise ToolError("name is required for a new item.")
    body = _base._clean({"name": name, "price": price, "currency": currency, "seller": seller, "bought_at": bought_at, "icon": icon,
                   "status": status, "sold_price": sold_price, "resale_target": resale_target, "note": note, "listing_id": listing_id})
    if not body:
        raise ToolError("Nothing to change.")
    bad = _deals.sensitive_findings(body)
    if bad:
        raise ToolError("Refused: " + "; ".join(bad))
    return await _base.api("PUT", f"/api/searches/{_base._q(search_id)}/items/{_base._q(item_id)}", body=body)
