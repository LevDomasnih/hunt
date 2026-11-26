"""Hunt core: home (split from hunt_core.py)."""
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
# ---------------------------------------------------------------- wave 3: people notes

@_base.mcp.tool()
async def contact_get(contact_id: str, search_id: str | None = None) -> dict:
    """A person's card: channels, listings, notes about them from your own searches (owners, agents) and stats
    {searches, notes, reply_minutes (median time to answer us), messages}. With search_id, `notes_elsewhere` holds the
    notes written in other searches: read them before writing to a known person."""
    return await _base.api("GET", f"/api/contacts/{_base._q(contact_id)}", params={"search_id": search_id})


@_base.mcp.tool()
async def contact_note_add(contact_id: str, text: str, sentiment: int = 0, search_id: str | None = None) -> dict:
    """Add a note about an owner / agent, shared across the whole Hunt instance (every search sees it).
    sentiment: 1 good, -1 bad, 0 neutral. Short facts in the hunter's language ("recalculated per night on early
    move-out, 500k/night", "repairs at his cost, answers within an hour"). Never ID, passport or card numbers."""
    if sentiment not in (-1, 0, 1):
        raise ToolError("sentiment must be 1, 0 or -1.")
    bad = _deals.sensitive_findings(text)
    if bad:
        raise ToolError("The note contains " + "; ".join(bad) + ". Remove it.")
    return await _base.api("POST", f"/api/contacts/{_base._q(contact_id)}/notes", body=_base._clean({"text": text, "sentiment": sentiment, "search_id": search_id}))


# ---------------------------------------------------------------- wave 3: rooms and the shared budget

@_base.mcp.tool()
async def rooms_set(search_id: str, rooms: list[dict] | None, others_equal: bool = True) -> dict:
    """Split the rent by rooms (Mini App "Who pays what"). rooms: [{"name": "Master, en-suite, view", "user_id": "u_x"
    or null (shared), "share": 55}], shares are percents of the rent and add up to 100 (a shared room with a share is
    split equally). Rent expenses without their own split follow the rooms; other expenses are equal (others_equal)
    or follow shares_set. rooms=None removes the split."""
    if rooms is not None:
        if not isinstance(rooms, list) or not rooms:
            raise ToolError("rooms must be a non-empty list, or None to remove.")
        total = sum(float(r.get("share") or 0) for r in rooms if isinstance(r, dict))
        if abs(total - 100) > 1:
            raise ToolError(f"Room shares must add up to 100 (now {total:g}).")
    body = {"rooms": None if rooms is None else {"rooms": rooms, "others_equal": others_equal}}
    return await _base.api("PATCH", f"/api/searches/{_base._q(search_id)}", body=body)


@_base.mcp.tool()
async def money_mode_set(search_id: str, mode: str) -> dict:
    """How the group handles money: 'split' (default: who paid what, balances, "settle up", shares, rooms) or
    'shared' (one common wallet: the money screen shows only totals by month and category and the expense list)."""
    if mode not in ("split", "shared"):
        raise ToolError("mode must be split or shared.")
    return await _base.api("PATCH", f"/api/searches/{_base._q(search_id)}", body={"money_mode": mode})


# ---------------------------------------------------------------- wave 3: power meter

@_base.mcp.tool()
async def power_get(search_id: str, download_photos: bool = True) -> dict:
    """Power meter of the house we live in: balance now (kWh, estimated from the last reading), daily use, days_left,
    runout, last four weeks, month_kwh, and readings. A member's meter photo arrives as an instruction kind
    "meter_photo" (and a reading row kind "photo" with `photo` = KV key): with download_photos the photos waiting
    for a value are saved locally (`photo_paths`) — look at the photo, read the kWh balance on the display and record
    it with power_reading_set(photo=<key>)."""
    out = await _base.api("GET", f"/api/searches/{_base._q(search_id)}/power")
    if download_photos and isinstance(out, dict):
        waiting = [r["photo"] for r in out.get("readings") or [] if r.get("kind") == "photo" and r.get("photo")]
        out["photo_paths"] = {k: await _deals._download_media(k, "meter") for k in waiting[-3:]}
    return out


@_base.mcp.tool()
async def power_reading_set(
    search_id: str,
    kwh: float,
    kind: str = "reading",
    at: str | None = None,
    photo: str | None = None,
    amount: int | None = None,
    currency: str | None = None,
    note: str | None = None,
) -> dict:
    """Record a meter value. kind: reading (kWh balance left on a prepaid meter, e.g. read from a member's photo:
    pass its `photo` key so the photo row becomes this reading) | topup (kWh bought; amount + currency = what was paid —
    also log the money with expense_add kind power). at: when the meter showed it (ISO), default now. note: one short
    observation in the hunter's language ("most of it is the ACs at night"). Members get a DM when ≤ 3 days are left."""
    if kind not in ("reading", "topup"):
        raise ToolError("kind must be reading or topup.")
    if kwh is None or kwh < 0:
        raise ToolError("kwh must be a non-negative number.")
    body = _base._clean({"kind": kind, "kwh": kwh, "at": at, "photo": photo, "amount": amount, "currency": currency, "note": note})
    return await _base.api("POST", f"/api/searches/{_base._q(search_id)}/power", body=body)


# ---------------------------------------------------------------- wave 3: move-out and re-let

MOVEOUT_STEPS = ("notice", "keys", "video", "cleaning", "deposit")


@_base.mcp.tool()
async def moveout_set(search_id: str, date: str | None = None, steps: dict | None = None, pushback: dict | None = None, clear_pushback: bool = False) -> dict:
    """Plan the move-out of the current home (Mini App "Handing back the villa"). Omitted parts keep their values.

    Args:
        date: move-out day YYYY-MM-DD (default: the lease `moveout` date).
        steps: {notice|keys|video|cleaning|deposit: {status: done | wait | todo | info, note, date?, at?, channel?}};
            note is one line in the hunter's language ("20.11 on WhatsApp, reason and date", "Sat 21.11, waiting for
            the time from Erna"). The video step turns done by itself when a member sends the move-out video to the bot
            (document kind moveout_video); deposit falls back to the lease deposit_return date.
        pushback: when the owner pushes back: {who: "Erna", to: "Эрне" (name as the hunter would address it in
            "Draft a reply to …"), quote: "you signed for 6 months", points: talking points from the lease and the
            region rules}. The members' "Draft a reply" button sends an instruction kind "moveout_reply".
        clear_pushback: remove the pushback card.
    """
    if date and not _deals._DATE.match(date):
        raise ToolError("date must be YYYY-MM-DD.")
    for k, v in (steps or {}).items():
        if k not in MOVEOUT_STEPS:
            raise ToolError(f"Unknown step {k!r}; use {', '.join(MOVEOUT_STEPS)}.")
        if v is not None and (not isinstance(v, dict) or v.get("status", "todo") not in ("done", "wait", "todo", "info")):
            raise ToolError(f"steps.{k} must be {{status: done|wait|todo|info, note}}.")
    bad = _deals.sensitive_findings({"steps": steps, "pushback": pushback})
    if bad:
        raise ToolError("Move-out data contains " + "; ".join(bad) + ". Remove it.")
    body: dict[str, Any] = _base._clean({"date": date, "steps": steps})
    if pushback is not None or clear_pushback:
        body["pushback"] = None if clear_pushback else pushback
    return await _base.api("PUT", f"/api/searches/{_base._q(search_id)}/moveout", body=body)


@_base.mcp.tool()
async def moveout_get(search_id: str) -> dict:
    """The move-out plan with the facts merged in (lease dates, the move-out video document)."""
    return await _base.api("GET", f"/api/searches/{_base._q(search_id)}/moveout")


@_base.mcp.tool()
async def relet_set(
    search_id: str,
    date_from: str | None = None,
    date_to: str | None = None,
    price: int | None = None,
    currency: str | None = None,
    consent: str | None = None,
    consent_note: str | None = None,
    ad_text: str | None = None,
    photos: list | None = None,
    channels: list[dict] | None = None,
    status: str | None = None,
) -> dict:
    """Re-let the remaining term of the current home (Mini App "Finding someone to take over"). Omitted fields keep
    their values.

    Args:
        date_from / date_to: the remaining term (YYYY-MM-DD). price + currency: monthly price for the newcomers.
        consent: yes | asked | no | unknown (the owner's consent to a re-let; never post before "yes").
        consent_note: one line ("Erna agrees, same price for the newcomers").
        ad_text: the ad you composed from the listing and the house (hunter approves it before posting).
        photos: photo refs like the listing's photos ([{"url"|"kv"|"file_id": …}]); default the listing photos.
        channels: where it is posted: [{"kind": "telegram", "count": 6}, {"kind": "facebook", "count": 2}, {"kind": "marketplace"}].
        status: draft | posted | found | closed.
    """
    if consent and consent not in ("yes", "asked", "no", "unknown"):
        raise ToolError("consent must be yes, asked, no or unknown.")
    if status and status not in ("draft", "posted", "found", "closed"):
        raise ToolError("status must be draft, posted, found or closed.")
    for d in (date_from, date_to):
        if d and not _deals._DATE.match(d):
            raise ToolError("dates must be YYYY-MM-DD.")
    bad = _deals.sensitive_findings({"ad": ad_text, "note": consent_note})
    if bad:
        raise ToolError("The ad contains " + "; ".join(bad) + ". Remove it.")
    body = _base._clean({"date_from": date_from, "date_to": date_to, "price": price, "currency": currency, "consent": consent, "consent_note": consent_note,
                   "ad_text": ad_text, "photos": photos, "channels": channels, "status": status})
    return await _base.api("PUT", f"/api/searches/{_base._q(search_id)}/relet", body=body)


@_base.mcp.tool()
async def relet_lead_set(
    search_id: str,
    lead_id: str = "new",
    name: str | None = None,
    status: str | None = None,
    note: str | None = None,
    channel: str | None = None,
    address: str | None = None,
    contact_id: str | None = None,
) -> dict:
    """Add (lead_id="new") or update someone who answered the re-let ad. status: new | reply (they wait for our
    answer) | viewing (viewing agreed: say when, and that the owner knows) | agreed | not_suitable. note: one line
    ("viewing tomorrow 15:00, Erna knows", "only needs a month"). channel + address open their chat from the app."""
    if status and status not in ("new", "reply", "viewing", "agreed", "not_suitable"):
        raise ToolError("status must be new, reply, viewing, agreed or not_suitable.")
    if lead_id == "new" and not name:
        raise ToolError("name is required for a new lead.")
    body = _base._clean({"name": name, "status": status, "note": note, "channel": channel, "address": address, "contact_id": contact_id})
    return await _base.api("PUT", f"/api/searches/{_base._q(search_id)}/relet/leads/{_base._q(lead_id)}", body=body)


# ---------------------------------------------------------------- wave 3: contacts directory

DIR_GROUPS = ("home", "bikes", "food", "services", "health")


@_base.mcp.tool()
async def directory_get(search_id: str) -> dict:
    """Contacts directory near the home: {groups (custom), entries}. Built-in groups: home, bikes, food, services,
    health. House contacts (house_contact_set) show as the group "home". Members ask you to write to an entry with an
    instruction kind "dir_message" ("order 2 gallons of water"): draft it with draft_create (normal approval)."""
    return await _base.api("GET", f"/api/searches/{_base._q(search_id)}/directory")


@_base.mcp.tool()
async def dir_entry_set(
    search_id: str,
    entry_id: str = "new",
    group: str | None = None,
    name: str | None = None,
    subtitle: str | None = None,
    channel: str | None = None,
    address: str | None = None,
    phone: str | None = None,
    map_url: str | None = None,
    lat: float | None = None,
    lng: float | None = None,
    icon: str | None = None,
    delete: bool = False,
) -> dict:
    """Add or update a directory entry (bike rental, water delivery, laundry, a market, a clinic…).
    group: home | bikes | food | services | health | a custom group key (dir_group_add). subtitle: price / hours /
    what matters ("Scoopy from 1.4M/mo · delivers home"). channel: whatsapp | telegram | phone | map; address: the
    number or @handle for it; phone: for the call button (whatsapp entries call the same number); map_url or lat/lng
    for the map button. icon: a lucide name (bike, wrench, shopping-cart, fish, shirt, droplet, pill, store…)."""
    if delete:
        if entry_id == "new":
            raise ToolError("entry_id is required to delete.")
        return await _base.api("DELETE", f"/api/searches/{_base._q(search_id)}/directory/{_base._q(entry_id)}")
    if channel and channel not in ("whatsapp", "telegram", "phone", "map"):
        raise ToolError("channel must be whatsapp, telegram, phone or map.")
    if entry_id == "new" and not name:
        raise ToolError("name is required for a new entry.")
    body = _base._clean({"grp": group, "name": name, "subtitle": subtitle, "channel": channel, "address": address, "phone": phone,
                   "map_url": map_url, "lat": lat, "lng": lng, "icon": icon})
    return await _base.api("PUT", f"/api/searches/{_base._q(search_id)}/directory/{_base._q(entry_id)}", body=body)


@_base.mcp.tool()
async def dir_group_add(search_id: str, name: str) -> dict:
    """Add a custom group to the contacts directory (e.g. "Kids", "Sport"); returns {groups:[{key, name}]}."""
    return await _base.api("POST", f"/api/searches/{_base._q(search_id)}/directory-groups", body={"name": name})
