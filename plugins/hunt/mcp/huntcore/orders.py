"""Hunt core: orders (split from hunt_core.py)."""
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
from huntcore import base as _base, deals as _deals
# ---------------------------------------------------------------------------- wave 10: orders from suppliers

SUPPLIER_KINDS = ("fruit", "fish", "other")
SUPPLIER_CHANNELS = ("whatsapp", "telegram", "phone")
SUPPLIER_LANGS = ("id", "en")
_SUPPLIER_TEXT = {"name": 80, "delivery_note_ru": 200, "delivery_note_en": 200, "note_ru": 200, "note_en": 200, "address": 80}
SUPPLIER_FIELDS = frozenset(set(_SUPPLIER_TEXT) | {"kind", "channel", "hours", "min_free_delivery", "delivery_fee", "lang", "currency", "dir_entry_id", "sort", "hidden"})
ITEM_UNITS = ("kg", "pcs", "pack", "bunch", "30pcs")
ITEM_FIELDS = frozenset({"name_id", "name_ru", "name_en", "grp", "unit", "step", "price", "price_unsure", "by_request", "price_at", "toy", "top", "sort", "hidden"})
CATALOG_MAX_ITEMS = 500
CATALOG_MAX_BYTES = 1_000_000
ORDER_SET_STATUS = ("sent", "confirmed", "cancelled")
ORDER_STATUS = ("basket", "opened", "draft", "sent", "confirmed", "delivered", "cancelled")
_SUPPLIER_ID = re.compile(r"^su_[A-Za-z0-9_-]{1,60}$")
_ORDER_ID = re.compile(r"^or_[A-Za-z0-9_-]{1,60}$")
_HOURS = re.compile(r"^([01]?\d|2[0-3]):[0-5]\d\s*[-–]\s*([01]?\d|2[0-3]):[0-5]\d$")


def _supplier_id(supplier_id: str) -> str:
    if not isinstance(supplier_id, str) or not _SUPPLIER_ID.match(supplier_id):
        raise ToolError("supplier_id must be a supplier id (su_…); list them with catalog_get(search_id).")
    return supplier_id


def validate_supplier(fields: Any, create: bool) -> dict:
    """Check supplier fields; None values are kept (they clear the field), except name."""
    if not isinstance(fields, dict) or not fields:
        raise ToolError("fields must be an object of supplier fields.")
    unknown = set(fields) - SUPPLIER_FIELDS
    if unknown:
        raise ToolError(f"fields: unknown keys {sorted(unknown)}; allowed: {', '.join(sorted(SUPPLIER_FIELDS))}.")
    out = dict(fields)
    if create and not str(out.get("name") or "").strip():
        raise ToolError("A new supplier needs name.")
    if "name" in out and not str(out["name"] or "").strip():
        raise ToolError("name must not be empty.")
    for k, n in _SUPPLIER_TEXT.items():
        if out.get(k) is not None:
            out[k] = str(out[k]).strip()
            if len(out[k]) > n:
                raise ToolError(f"{k} is longer than {n} characters.")
    if out.get("kind") is not None and out["kind"] not in SUPPLIER_KINDS:
        raise ToolError(f"kind must be one of {', '.join(SUPPLIER_KINDS)}.")
    if out.get("channel") is not None and out["channel"] not in SUPPLIER_CHANNELS:
        raise ToolError(f"channel must be one of {', '.join(SUPPLIER_CHANNELS)}.")
    if out.get("lang") is not None and out["lang"] not in SUPPLIER_LANGS:
        raise ToolError(f"lang must be one of {', '.join(SUPPLIER_LANGS)} (the message template).")
    if out.get("hours") and not _HOURS.match(str(out["hours"])):
        raise ToolError("hours must be 'HH:MM-HH:MM' (local), or null when not known: never invent them.")
    for k in ("min_free_delivery", "delivery_fee"):
        m = out.get(k)
        if m is not None and (isinstance(m, bool) or not isinstance(m, int) or m <= 0):
            raise ToolError(f"{k} must be a positive integer (main currency units), or null.")
    bad = _deals.sensitive_findings(out)
    if bad:
        raise ToolError("Refused: " + "; ".join(bad))
    return out


def read_catalog(path: str) -> dict:
    """A price list file: a JSON list of items or {items: [...], price_at?, supplier?}."""
    fp = Path(path).expanduser()
    if not fp.is_file():
        raise ToolError(f"No file at {fp}.")
    if fp.suffix.lower() != ".json":
        raise ToolError("catalog_import reads a .json file; turn a PDF or a photo into JSON first (check every price against the source).")
    if fp.stat().st_size > CATALOG_MAX_BYTES:
        raise ToolError("The file is bigger than 1 MB.")
    try:
        data = json.loads(fp.read_text(encoding="utf-8"))
    except (ValueError, UnicodeDecodeError) as e:
        raise ToolError(f"{fp.name} is not valid JSON: {e}") from None
    if isinstance(data, list):
        data = {"items": data}
    if not isinstance(data, dict) or not isinstance(data.get("items"), list):
        raise ToolError(f"{fp.name} must be a list of items or an object with items.")
    return data


def validate_items(items: Any) -> list[dict]:
    """Price-list items before the import; a problem names the row."""
    if not isinstance(items, list) or not items:
        raise ToolError("items must be a non-empty list.")
    if len(items) > CATALOG_MAX_ITEMS:
        raise ToolError(f"At most {CATALOG_MAX_ITEMS} items per import.")
    seen: set[str] = set()
    out = []
    for i, x in enumerate(items):
        if not isinstance(x, dict):
            raise ToolError(f"items[{i}] must be an object.")
        unknown = set(x) - ITEM_FIELDS
        if unknown:
            raise ToolError(f"items[{i}]: unknown keys {sorted(unknown)}; allowed: {', '.join(sorted(ITEM_FIELDS))}.")
        name = re.sub(r"\s+", " ", str(x.get("name_id") or "")).strip()
        if not name:
            raise ToolError(f"items[{i}]: name_id (the name exactly as in the supplier's list) is required.")
        if name in seen:
            raise ToolError(f"items[{i}]: duplicate name_id {name!r}.")
        seen.add(name)
        if x.get("unit") is not None and x["unit"] not in ITEM_UNITS:
            raise ToolError(f"items[{i}]: unit must be one of {', '.join(ITEM_UNITS)}.")
        p = x.get("price")
        if p is not None and (isinstance(p, bool) or not isinstance(p, (int, float)) or p < 0):
            raise ToolError(f"items[{i}]: price must be a number in main units, or null when the list has none.")
        out.append({**x, "name_id": name})
    return out


@_base.mcp.tool()
async def supplier_set(search_id: str, fields: dict, supplier_id: str | None = None) -> dict:
    """Create a supplier of the home's orders ("Заказы", wave 10) or change one (supplier_id). A supplier = a shop the
    members order from themselves (fruit market, fish market): its catalog opens in the Mini App.

    fields: name (required on create), kind (fruit | fish | other), dir_entry_id (the contact in the directory,
    directory_get; its channel and number are taken from it), channel (whatsapp | telegram | phone), address, hours
    ('HH:MM-HH:MM' local or null), min_free_delivery (main units or null), delivery_fee (what a delivery under
    min_free_delivery costs, main units or null), delivery_note_ru / delivery_note_en,
    note_ru / note_en (≤ 200), lang (id | en: the language of the message template), currency, sort, hidden.
    Only facts the supplier or a member told you: unknown hours, minimums or delivery prices stay null. Returns {supplier}."""
    body = validate_supplier(fields, create=supplier_id is None)
    sid = "new" if supplier_id is None else _supplier_id(supplier_id)
    return await _base.api("PUT", f"/api/searches/{_base._q(search_id)}/suppliers/{_base._q(sid)}", body=body)


@_base.mcp.tool()
async def catalog_import(
    search_id: str,
    supplier_id: str,
    path: str | None = None,
    items: list[dict] | None = None,
    price_at: str | None = None,
    full: bool = False,
) -> dict:
    """Import a supplier's price list (wave 10): upsert by name_id. Use it whenever the supplier sends a new price list, or
    a member forwards one. Favourites, toys and translations are kept; every price change is stored old → new.

    Args:
        path: a local .json file: [item, …] or {items, price_at?}; or pass items directly (≤ 500).
        items: {name_id (EXACTLY as in the list; it goes into the message), name_ru, name_en, grp (water, fruit, veg,
            greens, spice, egg, grocery; fish, prawn, squid, crab, shell, meat, cheese, other), unit (kg | pcs | pack |
            bunch | 30pcs), step (0.5 for kg, else 1), price (main units; null or 0 = the list has no price), price_unsure
            (1 = looks like a typo in the source: shown as "уточнить"), by_request (1), toy (a goods slug), top (1..8 =
            big toys until there are favourites), sort}. A field you leave out keeps its old value (send only name_id +
            price for a price update).
        price_at: YYYY-MM-DD of the list.
        full: true = the list is complete: items it no longer has are hidden (never deleted). Default keeps them and
            returns them in `missing`.
    Never invent or round prices; read the source twice. Returns {imported, created, price_changes: [{name_id, from, to}],
    price_changes_n, hidden, missing}. Tell the members about big changes of their usual items."""
    _supplier_id(supplier_id)
    if (path is None) == (items is None):
        raise ToolError("Pass either path or items.")
    if path is not None:
        data = read_catalog(path)
        items, price_at = data["items"], price_at or data.get("price_at")
    if price_at is not None and not re.match(r"^\d{4}-\d{2}-\d{2}$", str(price_at)):
        raise ToolError("price_at must be YYYY-MM-DD.")
    rows = validate_items(items)
    bad = _deals.sensitive_findings({"items": rows})
    if bad:
        raise ToolError("Refused: " + "; ".join(bad))
    return await _base.api("POST", f"/api/searches/{_base._q(search_id)}/suppliers/{_base._q(supplier_id)}/import", body=_base._clean({"items": rows, "price_at": price_at, "full": full or None}))


@_base.mcp.tool()
async def catalog_get(search_id: str, supplier_id: str | None = None) -> dict:
    """Suppliers of the home (wave 10). Without supplier_id: {suppliers: [{id (su_…), name, kind, channel, address, hours,
    min_free_delivery, items (how many), price_at, …}]}. With it: {supplier, items: [{id, name_id, name_ru, name_en, grp,
    unit, step, price | null, price_unsure, by_request, price_at, toy, top, fav (in how many delivered orders), hidden}],
    price_history: [{name_id, old_price, new_price, at}]}."""
    if supplier_id is None:
        return await _base.api("GET", f"/api/searches/{_base._q(search_id)}/suppliers")
    return await _base.api("GET", f"/api/searches/{_base._q(search_id)}/suppliers/{_base._q(_supplier_id(supplier_id))}/catalog")


@_base.mcp.tool()
async def orders_get(search_id: str, status: str | None = None) -> dict:
    """Orders from suppliers (wave 10): the open baskets, the active orders and the last 20 finished ones. {orders: [{id
    (or_…), supplier, status (basket | opened | draft | sent | confirmed | delivered | cancelled), lines: [{name_id, qty,
    unit, price, by}], sum, unknown (lines without a price), day, time, note, text (what was sent), total, reply, …}]}.

    Members fill the basket, send it (WhatsApp opens with the text) and pay on delivery THEMSELVES. `draft` = they asked you
    to send it: it is an ordinary approval draft (drafts_ready → send final_text → draft_mark). You NEVER order, change a
    basket or pay on your own."""
    if status is not None and status not in ORDER_STATUS:
        raise ToolError(f"status must be one of {', '.join(ORDER_STATUS)}.")
    return await _base.api("GET", f"/api/searches/{_base._q(search_id)}/orders", params=_base._clean({"status": status}))


@_base.mcp.tool()
async def sets_get(search_id: str, supplier_id: str | None = None) -> dict:
    """The members' saved baskets ("Наборы"), read only. {sets: [{id (os_…), supplier_id, name, repeat (none | weekly |
    biweekly), days (weekday bitmask: 1 = Monday … 64 = Sunday), time (HH:MM local), anchor (biweekly: a Monday of a week that
    fires), next {day, time} | null (the next reminder), last_sent, skipped (a day someone tapped Пропустить), lines: [{item_id,
    name_id, name_ru, name_en, qty, unit, price | null (live), gone (no longer on the price list)}]}]}.

    Members make, change and fill sets themselves; on its day Hunt's bot only reminds them in Telegram and they send the order
    as usual. You NEVER create, change or delete a set, and never turn a set into an order on your own. Use it to answer
    questions ("что у нас в наборе на неделю?") or to notice that a set's item left the price list (`gone`)."""
    params = _base._clean({"supplier_id": _supplier_id(supplier_id) if supplier_id is not None else None})
    return await _base.api("GET", f"/api/searches/{_base._q(search_id)}/sets", params=params)


@_base.mcp.tool()
async def order_set(
    search_id: str,
    order_id: str,
    status: str | None = None,
    total: int | None = None,
    deliver_time: str | None = None,
    deliver_day: str | None = None,
    reply: str | None = None,
    reply_tr: str | None = None,
) -> dict:
    """Record the supplier's ANSWER to an order (wave 10), after reading it in the inbox. status: confirmed (they will
    bring it; the members get one DM), cancelled (they cannot), sent (the approved draft went out; draft_mark does it
    too). total = the sum they named, delivery included (main units); deliver_time HH:MM, deliver_day YYYY-MM-DD (time_info,
    never guess); reply = their words, reply_tr = the translation for the members. Omitted fields keep their values.
    Not possible here on purpose: creating an order, changing the basket, marking it delivered or paying (a member taps
    "Привезли, оплатил", which writes one expense). Returns {order}."""
    if not isinstance(order_id, str) or not _ORDER_ID.match(order_id):
        raise ToolError("order_id must be an order id (or_…); see orders_get.")
    if status is not None and status not in ORDER_SET_STATUS:
        raise ToolError(f"status must be one of {', '.join(ORDER_SET_STATUS)}; members order, receive and pay themselves.")
    if total is not None and (isinstance(total, bool) or not isinstance(total, int) or total <= 0):
        raise ToolError("total must be a positive integer (main currency units).")
    if deliver_time is not None and not re.match(r"^([01]\d|2[0-3]):[0-5]\d$", deliver_time):
        raise ToolError("deliver_time must be HH:MM.")
    if deliver_day is not None and not re.match(r"^\d{4}-\d{2}-\d{2}$", deliver_day):
        raise ToolError("deliver_day must be YYYY-MM-DD.")
    for k, v in (("reply", reply), ("reply_tr", reply_tr)):
        if v is not None and len(v) > 1000:
            raise ToolError(f"{k} is longer than 1000 characters.")
    body = _base._clean({"status": status, "total": total, "deliver_time": deliver_time, "deliver_day": deliver_day, "reply": reply, "reply_tr": reply_tr})
    if not body:
        raise ToolError("Nothing to set.")
    bad = _deals.sensitive_findings(body)
    if bad:
        raise ToolError("Refused: " + "; ".join(bad))
    return await _base.api("PATCH", f"/api/searches/{_base._q(search_id)}/orders/{_base._q(order_id)}", body=body)


@_base.mcp.tool()
async def event_feedback_get(search_id: str, from_date: str | None = None, to_date: str | None = None) -> dict:
    """"Как было?" — what the members said after events (wave 9): the bot asks each member who was going the next morning
    (≥ 09:00 local, buttons 1–5 + an optional note), the Mini App has the same. Returns {feedback: [{event_id, title, occ,
    user_id, name, attended, rating 1..5 | null, note, liked, nope, want, updated_at}], venues: [{kind: place | organizer,
    key, name, avg 1..5, n}]} (venues = instance-wide ratings of places and organizers).

    The STRONGEST taste signal you have: attended + a rating beats likes and wants. Use it in the sweep (more from
    organizers/places rated 4–5, fewer from those rated 1–2, never drop a whole category for one bad night) and when a
    member asks "куда сходить". Notes are the members' words; quote them only to the same group.

    Args:
        from_date / to_date: YYYY-MM-DD local days (default: the CRM's window)."""
    for k, v in (("from_date", from_date), ("to_date", to_date)):
        if v is not None and not _deals._DATE.match(v):
            raise ToolError(f"{k} must be YYYY-MM-DD.")
    if from_date and to_date and from_date > to_date:
        raise ToolError("from_date is after to_date.")
    return await _base.api("GET", "/api/event-feedback", params={"search_id": search_id, "from": from_date, "to": to_date})
