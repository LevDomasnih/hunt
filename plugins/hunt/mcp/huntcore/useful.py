"""Hunt core: useful (split from hunt_core.py)."""
from __future__ import annotations
import re
from huntcore.base import ToolError
from huntcore import base as _base, deals as _deals
# ---------------------------------------------------------------- wave 6 · Полезное (useful links per region)

USEFUL_CATEGORIES = ("chats_rent", "flea", "bikes", "news", "visas", "medicine", "food", "apps", "guides", "maps", "other")
_USEFUL_LANG = re.compile(r"^([a-z]{2,3}|multi)$")
_TG_HANDLE = re.compile(r"^@[A-Za-z0-9_]{4,64}$")


def useful_url(url: str) -> str:
    """'@handle' / 't.me/x' → https://t.me/x; otherwise an https:// link (no http, tg:, javascript:)."""
    s = (url or "").strip()
    if _TG_HANDLE.match(s):
        return f"https://t.me/{s[1:]}"
    if re.match(r"^(www\.)?(t\.me|telegram\.me)/", s, re.I):
        s = "https://" + re.sub(r"^www\.", "", s, flags=re.I)
    if not re.match(r"^https://[^\s/]+\.[^\s]+$", s, re.I):
        raise ToolError("url must be an https:// link or a Telegram @handle (http://, tg:// and other schemes are refused).")
    return s


def _useful_activity(activity: dict | None) -> dict | None:
    if activity is None:
        return None
    if not isinstance(activity, dict):
        raise ToolError("activity must be {members?, per_day?}.")
    out = {}
    for k in ("members", "per_day"):
        v = activity.get(k)
        if v is None:
            continue
        if isinstance(v, bool) or not isinstance(v, (int, float)) or v < 0:
            raise ToolError(f"activity.{k} must be a non-negative number.")
        out[k] = v
    if not out:
        raise ToolError("activity needs members and/or per_day.")
    return out


@_base.mcp.tool()
async def useful_get(country: str, city: str | None = None, include_rejected: bool = False) -> dict:
    """"Полезное" for a region (Mini App screen "Useful"): the pack's useful.yaml items merged with the instance's approved
    links, plus the pending suggestions you may decide. Returns {country, city, verified, items: [{id, source: pack|crm,
    pack_id, name, url, kind: telegram|app|web|hunt, category, about: {ru, en}, lang, last_checked, activity: {members,
    per_day, at} | null, attribution, status, suggested_by_name, search_id}], pending: [...same shape, status pending],
    rejected?: [...]}.

    Members suggest links in the Mini App ("+"); each suggestion arrives in that search's digest as event
    useful_suggested (data: title, url, category, about). Check it (open the link, read it; never join or post), then
    decide with useful_decide. Use these links when members ask "where do I find X" (bikes, visas, doctors...).

    Args:
        country: pack slug, e.g. "bali", "kz", "th" (the first part of a search region).
        city: sub-pack slug (e.g. "bukit") to include that city's items.
        include_rejected: also list the last 50 rejected links (to avoid re-suggesting them)."""
    params = {"country": country.strip().lower(), "city": (city or "").strip().lower() or None,
              "status": "rejected" if include_rejected else None}
    return await _base.api("GET", "/api/useful", params=params)


@_base.mcp.tool()
async def useful_add(
    country: str,
    name: str,
    url: str,
    category: str = "other",
    about_ru: str | None = None,
    about_en: str | None = None,
    lang: str | None = None,
    city: str | None = None,
    search_id: str | None = None,
    activity: dict | None = None,
    last_checked: str | None = None,
) -> dict:
    """Add a link to "Полезное" for every search in this country on the instance (approved at once). For links that
    belong in the region pack for everyone using Hunt, edit regions/<country>/useful.yaml instead (see hunt-region).

    Only real, working links you have checked; name it honestly (the chat's own title, shortened). Third-party guides and
    catalogs: add a LINK with attribution in about_* — never copy their content into Hunt; importing someone else's
    map/catalog needs its owner's permission.

    Args:
        url: https:// link or a Telegram @handle (becomes https://t.me/<handle>); kind is inferred (t.me → telegram,
            App Store / Google Play → app, else web).
        category: chats_rent | flea | bikes | news | visas | medicine | food | apps | guides | maps | other.
        about_ru / about_en: what it is for, a few words ("байки помесячно", "monthly scooters"), ≤ 200 chars.
        lang: ru | en | id | th | kk | multi — the language people write in there.
        city: sub-pack slug when it is only for one city; omit for the whole country.
        search_id: your search where this came up (optional).
        activity: {members, per_day} read from the Telegram MCP (read-only); last_checked: YYYY-MM-DD you checked it.
    Returns {link}."""
    if category not in USEFUL_CATEGORIES:
        raise ToolError(f"category must be one of {', '.join(USEFUL_CATEGORIES)}.")
    if lang is not None and not _USEFUL_LANG.match(str(lang)):
        raise ToolError("lang must be a language code (ru, en, id, th…) or multi.")
    if last_checked and not _deals._DATE.match(last_checked):
        raise ToolError("last_checked must be YYYY-MM-DD.")
    bad = _deals.sensitive_findings({"name": name, "about_ru": about_ru, "about_en": about_en})
    if bad:
        raise ToolError("Refused: " + "; ".join(bad))
    body = _base._clean({"country": country.strip().lower(), "name": name, "url": useful_url(url), "category": category,
                   "about_ru": about_ru, "about_en": about_en, "lang": lang, "city": city, "search_id": search_id,
                   "activity": _useful_activity(activity), "last_checked": last_checked})
    return await _base.api("POST", "/api/useful", body=body)


@_base.mcp.tool()
async def useful_decide(link_id: str, status: str) -> dict:
    """Approve or reject a member's suggestion (useful_suggested in the digest, pending in useful_get). Approved links
    show in "Полезное" of every search in that country on the instance; rejected ones disappear. Allowed for the owner of
    the search where it was suggested (also from the Mini App), the one who added it, or an instance admin.

    Before approving: open the link (Telegram: tg_resolve / tg_history read-only; never join a group or post to check
    it), make sure it is real, alive and what the name says, and not an agent's spam channel or a paid scheme.
    status: approved | rejected | pending. Returns {link}."""
    if status not in ("approved", "rejected", "pending"):
        raise ToolError("status must be approved, rejected or pending.")
    return await _base.api("PUT", f"/api/useful/{_base._q(link_id)}", body={"status": status})


@_base.mcp.tool()
async def useful_annotate(
    country: str | None = None,
    pack_id: str | None = None,
    link_id: str | None = None,
    activity: dict | None = None,
    last_checked: str | None = None,
) -> dict:
    """Refresh the activity hint and/or the check date of a "Полезное" item, shown as "проверено <date>" in the app.
    A pack item (useful.yaml) by country + pack_id (one shared annotation per item), or a CRM link by link_id.

    Fill activity from the Telegram MCP READ-ONLY: tg_resolve (members) and tg_history of a public chat or channel you
    can read without joining (messages per day over the last week). Never join a group, never post, never react to
    measure it; if the chat is not readable without joining, leave activity out. Do not touch chats on an account that
    hit FLOOD_WAIT / PEER_FLOOD.

    Args:
        activity: {members: int, per_day: number} (either or both).
        last_checked: YYYY-MM-DD, the day you actually checked the link (not a guess).
    Returns {annotation} (pack item) or {link} (CRM link)."""
    act = _useful_activity(activity)
    if last_checked and not _deals._DATE.match(last_checked):
        raise ToolError("last_checked must be YYYY-MM-DD.")
    if act is None and not last_checked:
        raise ToolError("Pass activity and/or last_checked.")
    if link_id:
        return await _base.api("PUT", f"/api/useful/{_base._q(link_id)}", body=_base._clean({"activity": act, "last_checked": last_checked}))
    if not (country and pack_id):
        raise ToolError("Pass country + pack_id (a useful.yaml item) or link_id (a CRM link).")
    return await _base.api("POST", "/api/useful", body=_base._clean({"country": country.strip().lower(), "pack_id": pack_id,
                                                          "activity": act, "last_checked": last_checked}))
