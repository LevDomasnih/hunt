"""Hunt core: stage (split from hunt_core.py)."""
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
from huntcore import base as _base, deals as _deals, house as _house, routes as _routes
# ---------------------------------------------------------------- wave 6: the project pipeline, lease terms

STAGES = ("start", "search", "viewings", "choice", "deal", "movein", "living", "extension", "next", "moveout", "closed")
TERM_STATUS = ("draft", "signed", "active", "ended")
DEPOSIT_PREV = ("returned", "carried", "pending", "kept")


@_base.mcp.tool()
async def stage_get(search_id: str, today: str | None = None) -> dict:
    """Where the project (search) is in its lifecycle: start → search → viewings → choice → deal → movein → living →
    (extension) → next → moveout → closed. Returns {stage: {key, idx (1-9), n: 9, derived_key, manual, manual_key, closed,
    date (the key date: move-in, lease end, move-out…), home_listing_id, home, terms: [{seq, kind, from, to, rent, currency,
    deposit, deposit_prev, deposit_prev_amount, landlord, status, current}], rows: [{key, status: done|current|todo, date,
    date_to, go, facts}], history: [{stage, at, by, manual}]}, derived: {key, choice}}.
    The CRM derives the stage from the data (deal, lease document signed + payments before move-in done, move-in evidence,
    "what next" votes, deal terms ≥ 2, move-out, re-let) on every Mini App open, after your writes and in the cron; members
    get a short DM on deal / move-in / what next / move-out / closed. today (YYYY-MM-DD) previews the derivation on another
    day without storing anything."""
    if today and not _deals._DATE.match(today):
        raise ToolError("today must be YYYY-MM-DD.")
    return await _base.api("GET", f"/api/searches/{_base._q(search_id)}/stage", params=_base._clean({"today": today}))


@_base.mcp.tool()
async def stage_set(search_id: str, stage: str, note: str | None = None, listing_id: str | None = None) -> dict:
    """Override the project stage when the data can't show it yet (e.g. the members moved in but nobody uploaded the move-in
    video), or close / reopen the project.

    stage: one of start, search, viewings, choice, deal, movein, living, extension, next, moveout (a manual stage stays until
    the derived stage reaches it, then the CRM drops it); "closed" archives the project: read-only in the Mini App, guests lose
    access, members get a DM — call it only after the move-out is finished and the house dossier is final (dossier_set /
    dossier_item_add); "auto" clears the override (and reopens a closed project).
    listing_id pins the chosen home when no deal/vote shows it (with stage choice or later). note = one line for the feed.
    Returns {stage, changed}."""
    if stage not in STAGES + ("auto",):
        raise ToolError(f"stage must be one of {', '.join(STAGES)} or auto.")
    if note:
        bad = _deals.sensitive_findings({"note": note})
        if bad:
            raise ToolError("Refused: " + "; ".join(bad))
    return await _base.api("PUT", f"/api/searches/{_base._q(search_id)}/stage", body=_base._clean({"stage": stage, "note": note, "listing_id": listing_id}))


@_base.mcp.tool()
async def deal_terms_get(search_id: str) -> dict:
    """Every lease term of the project home: seq 1 = the first contract (from the deal: deal_set / deal_dates_set), seq 2, 3…
    = extensions (the same home after "stay" in What next, possibly with a new landlord, e.g. the owner directly instead of the
    sublessor). Returns {terms: [{seq, kind: lease|sublease, from, to, rent, currency, deposit, deposit_prev: returned|carried|
    pending|kept, deposit_prev_amount, landlord, landlord_contact_id, status: draft|signed|active|ended, current, signed,
    dates: [DealDate + term_seq, index], checklist, note, listing_id}]}."""
    return await _base.api("GET", f"/api/searches/{_base._q(search_id)}/terms")


@_base.mcp.tool()
async def deal_term_set(
    search_id: str,
    seq: int | str = "new",
    date_from: str | None = None,
    date_to: str | None = None,
    kind: str | None = None,
    rent: float | None = None,
    currency: str | None = None,
    deposit: float | None = None,
    deposit_prev: str | None = None,
    deposit_prev_amount: float | None = None,
    landlord: str | None = None,
    landlord_contact_id: str | None = None,
    status: str | None = None,
    dates: list[dict] | None = None,
    checklist: list[dict | str] | None = None,
    note: str | None = None,
    listing_id: str | None = None,
) -> dict:
    """Create or update an extension term (seq ≥ 2, or "new" for the next number) of the project home after the members chose
    "stay": the new contract's dates, money and landlord. The first term stays in the deal (deal_set) — seq 1 is refused.

    date_from / date_to: YYYY-MM-DD (from is required for a new term). kind: lease | sublease. rent / deposit: per month /
    the new deposit, main units. deposit_prev: what happened to the previous term's deposit — returned (paid back),
    carried (moved into this term's deposit), pending (still to come back), kept (the landlord kept it); with
    deposit_prev_amount. landlord: a name only ("Made, owner"), never ID numbers; landlord_contact_id links a contact.
    status: draft (talking) → signed (contract signed; upload it with doc_upload / doc_set and term_seq=<seq>) → active →
    ended. dates: this term's payments / notice / move-out / deposit return in the deal_dates_set shape (the bot reminds
    members). checklist: [{text, done}]. The project stage returns to living once a signed term has started.
    Returns {term, terms}."""
    body: dict[str, Any] = {}
    if date_from is not None:
        _routes._parse_date(date_from)
        body["from"] = date_from
    if date_to is not None:
        _routes._parse_date(date_to)
        body["to"] = date_to
    if kind is not None and kind not in ("lease", "sublease"):
        raise ToolError("kind must be lease or sublease.")
    if status is not None and status not in TERM_STATUS:
        raise ToolError(f"status must be one of {', '.join(TERM_STATUS)}.")
    if deposit_prev is not None and deposit_prev not in DEPOSIT_PREV:
        raise ToolError(f"deposit_prev must be one of {', '.join(DEPOSIT_PREV)}.")
    if str(seq) == "1":
        raise ToolError("seq 1 is the first contract: change it with deal_set / deal_dates_set.")
    if str(seq) != "new" and (not str(seq).isdigit() or int(seq) < 2):
        raise ToolError("seq must be 2, 3, … or 'new'.")
    for k, v in (("rent", rent), ("deposit", deposit), ("deposit_prev_amount", deposit_prev_amount)):
        if v is not None and (isinstance(v, bool) or not isinstance(v, (int, float)) or v < 0):
            raise ToolError(f"{k} must be a positive number in main units.")
    if dates is not None:
        if not isinstance(dates, list):
            raise ToolError("dates must be a list.")
        for i, d in enumerate(dates):
            if not isinstance(d, dict) or d.get("kind") not in _house.DATE_KINDS or not d.get("title"):
                raise ToolError(f"dates[{i}] needs date, kind ({'|'.join(_house.DATE_KINDS)}) and title.")
            _routes._parse_date(d.get("date", ""))
    body.update(_base._clean({"kind": kind, "rent": rent, "currency": currency, "deposit": deposit, "deposit_prev": deposit_prev,
                        "deposit_prev_amount": deposit_prev_amount, "landlord": landlord, "landlord_contact_id": landlord_contact_id,
                        "status": status, "dates": dates, "checklist": checklist, "note": note, "listing_id": listing_id}))
    bad = _deals.sensitive_findings({"landlord": landlord, "note": note, "dates": dates, "checklist": checklist})
    if bad:
        raise ToolError("Refused: " + "; ".join(bad))
    return await _base.api("PUT", f"/api/searches/{_base._q(search_id)}/terms/{_base._q(str(seq))}", body=body)
