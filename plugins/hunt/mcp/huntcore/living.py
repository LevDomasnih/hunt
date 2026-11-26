"""Hunt core: living (split from hunt_core.py)."""
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
# ---------------------------------------------------------------- wave 5: surf, guest guide, renewal, negotiation, recap

@_base.mcp.tool()
async def surf_forecast(search_id: str, refresh: bool = False) -> dict:
    """Today's surf near the home (Mini App "Surf"): {home: {lat, lng, label, source: deal|anchor|districts} | null,
    date, tz, area_name, spots: [{id, name, tier, level: beginner|intermediate|advanced|null, bottom: reef|beach|null,
    faces, minutes, height (m), period (s), stars: 1|2|3, window: {from, to} | null, wind: {offshore_until,
    offshore_from, later: onshore|cross|null} | null, rated_wind}], best: <spot id> | null, updated_at, error}.

    Spots = the pack's surf places plus the search's own surf places within 30 min of the home (the deal listing,
    else the brief anchor(s), else the centre of the brief districts). Data: Open-Meteo marine + wind, hourly,
    cached by the CRM per spot (refreshed at most every 3 h). Stars: wave height in the spot's level range (beginner 0.5–1.3 m,
    intermediate 0.8–2.0 m, advanced 1.2–3.0 m), period ≥ 10 s good / ≥ 13 s great, offshore or light wind; window =
    the longest daylight run at the day's top rating. rated_wind false = the spot has no `faces`, wind not rated.
    Use it for the morning line ("Balangan 3★ 1.2 m 12 s, offshore until 10:30") — never invent a forecast.
    refresh=True bypasses the CRM cache (use sparingly; the free API is shared)."""
    return await _base.api("GET", f"/api/searches/{_base._q(search_id)}/surf", params={"refresh": 1 if refresh else None})


GUIDE_ICONS = ("smoke", "water", "zap", "trash", "moon", "key", "car", "dog", "pool", "shoe", "info")
MAX_GUIDE_RULES = 12


def normalize_rules(rules: list) -> list[dict]:
    """Guide rules → [{icon?, text}]: plain strings become {text}; icons must be in GUIDE_ICONS; at most 12."""
    if not isinstance(rules, list):
        raise ToolError("rules must be a list of strings or {icon?, text} objects.")
    if len(rules) > MAX_GUIDE_RULES:
        raise ToolError(f"At most {MAX_GUIDE_RULES} rules (got {len(rules)}); keep the ones guests actually need.")
    out: list[dict] = []
    for i, r in enumerate(rules):
        if isinstance(r, str):
            r = {"text": r}
        if not isinstance(r, dict):
            raise ToolError(f"rules[{i}] must be a string or {{icon?, text}}.")
        text = str(r.get("text") or "").strip()
        if not text:
            raise ToolError(f"rules[{i}] has no text.")
        icon = r.get("icon")
        if icon in (None, ""):
            out.append({"text": text})
            continue
        if icon not in GUIDE_ICONS:
            raise ToolError(f"rules[{i}].icon {icon!r} is unknown; use one of {', '.join(GUIDE_ICONS)} (or omit it).")
        out.append({"icon": icon, "text": text})
    return out


@_base.mcp.tool()
async def guide_get(search_id: str) -> dict:
    """The house guide for guests and new members: {guide: {address, map_url, wifi_name, wifi_password_set, rules:
    [{icon, text}], note, host: {user_id, name} | null, url | null, listing_id}}. The Wi-Fi password itself is not
    returned here (only whether it is set); url is the public guest-guide link (/g/<token>) once a member shared it."""
    return await _base.api("GET", f"/api/searches/{_base._q(search_id)}/guide")


@_base.mcp.tool()
async def guide_set(
    search_id: str,
    address: str | None = None,
    map_url: str | None = None,
    wifi_name: str | None = None,
    wifi_password: str | None = None,
    rules: list | None = None,
    note: str | None = None,
) -> dict:
    """Fill the house guide (Mini App "Guide", the public guest page /g/<token>). Omitted fields keep their values;
    "" clears a field; rules replaces the whole list ([] clears it).

    Fill it from the lease summary and the house chat: the address as a driver would need it, a map link, the
    Wi-Fi name and password, house rules. Never put passport/ID/card numbers or the owner's documents here (the
    guide is shown to guests): this tool and the CRM refuse text that looks like them.

    Args:
        map_url: an http(s) map link (Google Maps / OSM).
        wifi_password: the house Wi-Fi password (shown to members and to guests with the guide area; not returned by
            guide_get). Do not repeat it in chat messages or reports.
        rules: up to 12 items, each a plain string or {icon?, text}; icon one of smoke, water, zap, trash, moon, key,
            car, dog, pool, shoe, info. E.g. [{"icon": "shoe", "text": "Shoes off inside"}, "Quiet after 22:00"].
        note: one free paragraph (check-in, where the key is, who to call).
    Returns {guide}."""
    body: dict[str, Any] = _base._clean({"address": address, "map_url": map_url, "wifi_name": wifi_name,
                                   "wifi_password": wifi_password, "note": note})
    if rules is not None:
        body["rules"] = normalize_rules(rules)
    if not body:
        raise ToolError("Nothing to change: pass at least one field.")
    if map_url and not re.match(r"^https?://\S+$", map_url.strip()):
        raise ToolError("map_url must be an http(s) link.")
    # The Wi-Fi password is a secret by design: check it only for ID/card-like numbers, not for being a password.
    # map links carry long ids that can look like card numbers.
    check = {k: v for k, v in body.items() if k not in ("wifi_password", "map_url")}  # ggignore: a field name, not a secret
    if wifi_password:
        check["wifi"] = wifi_password
    bad = _deals.sensitive_findings(check)
    if bad:
        raise ToolError("Refused: the guide is shown to guests and looks like it contains sensitive numbers. "
                        "Remove them and retry. " + "; ".join(bad))
    return await _base.api("PUT", f"/api/searches/{_base._q(search_id)}/guide", body=body)


@_base.mcp.tool()
async def next_get(search_id: str) -> dict:
    """What happens when the lease ends (Mini App "What next"): {renewal: {id, status: open|decided, lease_to,
    deadline (lease_to − 28 days), weeks_left, note, choice: stay|new|leave|null, decided_how: majority|owner|null,
    decided_at, votes: [{user_id, name, choice, at}], voters, new_search_id} | null}.
    The CRM opens it 42 days before the lease end (deal terms.to); members vote stay / new / leave; the majority
    decides (early when one option has more than half of the voters; a full tie goes to the owner's vote).
    The decision arrives as a digest instruction next_stay / next_new / next_leave (see the hunt-deal skill)."""
    return await _base.api("GET", f"/api/searches/{_base._q(search_id)}/next")


@_base.mcp.tool()
async def next_note_set(search_id: str, note: str, lease_to: str | None = None) -> dict:
    """Add context to the "What next" vote (creates the open renewal if the cron has not yet): note = one or two lines
    the members see above the vote, e.g. "Owner wants 10% more for 2027; Nusa Dua listings are 15% cheaper".
    lease_to (YYYY-MM-DD) overrides the lease end when the deal has none. Returns {renewal}."""
    if lease_to and not _deals._DATE.match(lease_to):
        raise ToolError("lease_to must be YYYY-MM-DD.")
    bad = _deals.sensitive_findings({"note": note})
    if bad:
        raise ToolError("Refused: " + "; ".join(bad))
    return await _base.api("PUT", f"/api/searches/{_base._q(search_id)}/next", body=_base._clean({"note": note, "lease_to": lease_to}))


@_base.mcp.tool()
async def search_clone(search_id: str, title: str | None = None, move_in: str | None = None, term: str | None = None) -> dict:
    """Start the next search from this one (after the members chose "new" in What next): a new active search with
    the same region and brief, the same members (roles kept; guests are not copied) and the own places copied.
    move_in (YYYY-MM-DD) defaults to the old lease end; term like the brief's term ("6 months"); title defaults to
    the old one. Returns {search, invite_link, group_link}. Then continue with the usual new-search flow (brief check,
    sweep), pre-filling from the dossier of the current house, the members' notes and their places."""
    if move_in and not _deals._DATE.match(move_in):
        raise ToolError("move_in must be YYYY-MM-DD.")
    return await _base.api("POST", f"/api/searches/{_base._q(search_id)}/clone", body=_base._clean({"title": title, "move_in": move_in, "term": term}))


@_base.mcp.tool()
async def negotiation_get(listing_id: str) -> dict:
    """The price-talk helper for one listing (owner only). Call it before ANY message that discusses price.
    Returns {listing: {id, title, price, currency, district, bedrooms, property_type}, market: {districts, bedrooms,
    property_type, count, median, p25, p75, min, max, source: crm|pack} | null, history: [{date: YYYY-MM, price,
    currency, source, note, match: same|contact|photos|point|dossier, title}], offer: {price, months_upfront, capped}
    | null, arguments: [...], asked, budget_said}.

    Rules: never reveal or hint at budget_cap, the members' hidden ceiling (it is not in this response; never look it up for a message);
    never offer more than budget_said (offer.price already respects it, capped=true means it was lowered to it);
    open with offer.price or lower and move up only with the members' consent.
    arguments (use the ones present, in the contact's language, politely):
        median {value}: comparable listings in the area go for about this.
        not_included {items}: utilities not in the price (electricity, water, internet…): ask to include or lower.
        empty_since {date}: the place has been free since then.
        season {season: low|wet|high}: low/wet season — demand is down; high — don't push hard.
        term_upfront {months}: we take a long term / pay months upfront in exchange for a discount.
        long_listed {days}: the listing has been up this long.
        was_cheaper {price, date}: it was offered for this price before (from the history)."""
    return await _base.api("GET", f"/api/listings/{_base._q(listing_id)}/negotiation")


@_base.mcp.tool()
async def deal_prices_set(listing_id: str, asked: float | None = None, agreed: float | None = None) -> dict:
    """Record the asked vs the agreed monthly price of the deal (main currency units), for the recap "we saved".
    The CRM fills them itself from the first deal_set with terms.rent (agreed) and the first price seen for the
    listing (asked); call this when the talk changed them (e.g. asked 25M, agreed 22M after negotiation).
    Returns {asked, agreed, currency, saved_month, months, saved_term}."""
    for k, v in (("asked", asked), ("agreed", agreed)):
        if v is not None and (isinstance(v, bool) or not isinstance(v, (int, float)) or v <= 0):
            raise ToolError(f"{k} must be a positive number in main units (e.g. 22000000 for 22M IDR).")
    body = _base._clean({"asked": asked, "agreed": agreed})
    if not body:
        raise ToolError("Pass asked and/or agreed.")
    return await _base.api("PUT", f"/api/deals/{_base._q(listing_id)}/prices", body=body)


@_base.mcp.tool()
async def recap_get(search_id: str) -> dict:
    """The search recap (Mini App "Recap" card the members can share): {search: {id, title, region, region_name},
    members: [{user_id, name, animal}], days, created_at, deal_at, counts: {contacted, replied, viewings, deals},
    prices: {asked, agreed, currency, saved_month, months, saved_term} | null, listing: {id, title, photo} | null,
    complete, missing: [what is not filled yet]}. If missing lists prices, record them with deal_prices_set."""
    return await _base.api("GET", f"/api/searches/{_base._q(search_id)}/recap")


@_base.mcp.tool()
async def guests_get(search_id: str) -> dict:
    """Guests of the house (friends visiting for some days, invited by members in the Mini App): {guests: [{user_id,
    name, from, to, areas: {guide, places, contacts, issues}, status: active|revoked|expired, invited_by}]}.
    Guests only see the areas they were given (guide, places, house contacts, reporting issues) between from and to;
    never money, documents, the deal, threads, votes, drafts or listings — the CRM enforces it. Their issues arrive
    as instruction kind issue with data.guest=true; their requests to message a contact arrive as drafts kind guest."""
    return await _base.api("GET", f"/api/searches/{_base._q(search_id)}/guests")
