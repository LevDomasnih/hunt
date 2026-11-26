"""Hunt core: money (split from hunt_core.py)."""
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
# ---------------------------------------------------------------- scam check

VERDICTS = ("ok", "caution", "danger")
SIGNAL_STATUSES = ("ok", "warn", "todo")


@_base.mcp.tool()
async def listing_checks_set(listing_id: str, verdict: str, signals: list[dict], advice: str | None = None) -> dict:
    """Save the scam check of a listing (run it before proposing a viewing; rules in region_doc(region, "scam.md")).
    Members see it on the listing screen; caution/danger show a warning banner and go into the morning digest.

    Args:
        verdict: ok (nothing suspicious) | caution (pay nothing before the viewing and the owner check) |
            danger (looks like a scam: stop, no viewing without documents).
        signals: [{status: ok|warn|todo, title, detail?}], one per check, in the hunter's language, short
            (title ≤ 60 chars, detail ≤ 120): duplicates across agents, reverse image search, price vs district,
            prepayment before viewing, owner documents (todo until checked).
        advice: optional one line under the banner title (default text per verdict).
    Never put ID/passport/card numbers here (refused).
    """
    if verdict not in VERDICTS:
        raise ToolError(f"verdict must be one of {', '.join(VERDICTS)}.")
    if not isinstance(signals, list) or not signals:
        raise ToolError("signals must be a non-empty list.")
    for i, x in enumerate(signals):
        if not isinstance(x, dict) or x.get("status") not in SIGNAL_STATUSES or not str(x.get("title") or "").strip():
            raise ToolError(f"signals[{i}] needs status (ok|warn|todo) and title.")
    body = _base._clean({"verdict": verdict, "signals": signals, "advice": advice})
    bad = _deals.sensitive_findings(body)
    if bad:
        raise ToolError("Refused: the check looks like it contains sensitive numbers. " + "; ".join(bad))
    return await _base.api("PUT", f"/api/listings/{_base._q(listing_id)}/checks", body=body)


# ---------------------------------------------------------------- shared money

EXPENSE_KINDS = ("rent", "deposit", "power", "water", "internet", "cleaning", "pool", "repair", "food", "transport", "other")


@_base.mcp.tool()
async def expense_add(
    search_id: str,
    title: str,
    amount: int,
    paid_by: str,
    currency: str | None = None,
    date: str | None = None,
    kind: str = "other",
    method: str | None = None,
    split: dict | None = None,
    note: str | None = None,
    listing_id: str | None = None,
) -> dict:
    """Log a shared expense (what the group paid: rent, deposit, power tokens, cleaning, pool, repairs).
    Members see it in the Mini App "Money" screen with balances ("Sam owes you 11.4M").

    Args:
        amount: main units of the currency (22000000 for 22M IDR).
        paid_by: the member's user_id who paid (search_get → members).
        currency: defaults to the brief currency. date: YYYY-MM-DD (local), default today.
        kind: rent | deposit | power | water | internet | cleaning | pool | repair | food | transport | other.
        method: cash | transfer | card.
        split: {user_id: weight} for this expense only; omit to split by the search shares (shares_set, default equal).
    Log every cash payment you learn about, and ask for a receipt (doc_request kind="receipt").
    """
    if kind not in EXPENSE_KINDS:
        raise ToolError(f"kind must be one of {', '.join(EXPENSE_KINDS)}.")
    if method and method not in ("cash", "transfer", "card"):
        raise ToolError("method must be cash, transfer or card.")
    if not isinstance(amount, (int, float)) or amount <= 0:
        raise ToolError("amount must be a positive number in main units.")
    if date:
        _routes._parse_date(date)
    body = _base._clean({"title": title, "amount": int(round(amount)), "paid_by": paid_by, "currency": currency, "date": date, "kind": kind,
                   "method": method, "split": split, "note": note, "listing_id": listing_id})
    bad = _deals.sensitive_findings(body)
    if bad:
        raise ToolError("Refused: " + "; ".join(bad))
    return await _base.api("POST", f"/api/searches/{_base._q(search_id)}/expenses", body=body)


@_base.mcp.tool()
async def expenses_get(search_id: str) -> dict:
    """Shared money of a search: expenses, settlements ("we settled up"), shares (split weights per member),
    balances per currency {net:{user_id: +owed to them / -they owe}, transfers:[{from, to, amount}]} and totals
    (total, per_member, equal_share, power_per_month)."""
    return await _base.api("GET", f"/api/searches/{_base._q(search_id)}/expenses")


@_base.mcp.tool()
async def shares_set(search_id: str, shares: dict) -> dict:
    """Set how shared expenses are split: {user_id: weight}, e.g. {"u_a": 2, "u_b": 1} when one person has the
    big bedroom (split rent by rooms). Members can also edit it in the Mini App. Applies to every expense without
    its own split, past and future."""
    if not isinstance(shares, dict) or not shares:
        raise ToolError("shares must be {user_id: weight}.")
    return await _base.api("PATCH", f"/api/searches/{_base._q(search_id)}", body={"shares": shares})
