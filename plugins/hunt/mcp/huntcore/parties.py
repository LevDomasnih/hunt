"""Hunt core: parties (split from hunt_core.py)."""
from __future__ import annotations
import re
from typing import Any
from huntcore.base import ToolError
from huntcore import base as _base, deals as _deals, events as _events
# ---------------------------------------------------------------- wave 9: parties ("Своя тусовка"), "Как было?"

PARTY_VIBES = ("chill", "dance", "dinner", "pool", "games", "sunset")
PARTY_STATUS = ("active", "cancelled", "done")
PARTY_NOTICE_TO = ("owner", "neighbours")
PARTY_NOTICE_CHANNELS = ("telegram", "whatsapp", "instagram", "facebook", "email", "phone")
PARTY_TEMPLATE_LANGS = ("en", "ru", "id")
_PARTY_TEXT = {"title": 80, "theme": 80, "dress_code": 60, "note": 300, "address": 200, "how_to": 300}
_PARTY_BOOL = ("plus_one", "byob", "wifi")
PARTY_FIELDS = frozenset(set(_PARTY_TEXT) | set(_PARTY_BOOL) | {"starts_at", "ends_at", "vibe", "capacity", "status"})
_PARTY_ID = re.compile(r"^pt_[A-Za-z0-9_-]{1,60}$")


def _party_id(party_id: str) -> str:
    if not isinstance(party_id, str) or not _PARTY_ID.match(party_id):
        raise ToolError("party_id must be a party id (pt_…); list them with party_get(search_id).")
    return party_id


def validate_party(fields: Any, create: bool) -> dict:
    """Check party fields against the wave 9 contract; return a cleaned copy (None values dropped). create=True needs
    title and starts_at."""
    if not isinstance(fields, dict):
        raise ToolError("fields must be an object of party fields.")
    unknown = set(fields) - PARTY_FIELDS
    if unknown:
        raise ToolError(f"fields: unknown keys {sorted(unknown)}; allowed: {', '.join(sorted(PARTY_FIELDS))}.")
    out = {k: v for k, v in fields.items() if v is not None}
    if create:
        missing = [k for k in ("title", "starts_at") if out.get(k) in (None, "")]
        if missing:
            raise ToolError(f"A new party needs {', '.join(missing)}.")
    for k, n in _PARTY_TEXT.items():
        if k in out:
            if not isinstance(out[k], str) or not out[k].strip():
                raise ToolError(f"{k} must be a non-empty string.")
            out[k] = out[k].strip()
            if len(out[k]) > n:
                raise ToolError(f"{k} is longer than {n} characters; keep it short.")
    for k in _PARTY_BOOL:
        if k in out and not isinstance(out[k], bool):
            raise ToolError(f"{k} must be true or false.")
    if "vibe" in out and out["vibe"] not in PARTY_VIBES:
        raise ToolError(f"vibe must be one of {', '.join(PARTY_VIBES)}.")
    if "status" in out and out["status"] not in PARTY_STATUS:
        raise ToolError(f"status must be one of {', '.join(PARTY_STATUS)}.")
    if "capacity" in out:
        c = out["capacity"]
        if isinstance(c, bool) or not isinstance(c, int) or not 1 <= c <= 300:
            raise ToolError("capacity must be an integer 1..300 (heads, +1s included).")
    starts = _events._iso_offset(out["starts_at"], "starts_at") if "starts_at" in out else None
    if "ends_at" in out:
        ends = _events._iso_offset(out["ends_at"], "ends_at")
        if starts and ends <= starts:
            raise ToolError("ends_at must be after starts_at.")
    bad = _deals.sensitive_findings(out)
    if bad:
        raise ToolError("Refused: " + "; ".join(bad))
    return out


@_base.mcp.tool()
async def party_get(search_id: str, party_id: str | None = None) -> dict:
    """Parties of a home ("Своя тусовка", wave 9): the members' own events at the villa, in Афиша (category party/home).
    Without party_id: {parties: [Party]} (upcoming + the last 14 days, newest first). With party_id: {party, guests,
    items, ratings, recap, rules}.

    Party = {id (pt_…), search_id, title, starts_at, ends_at, theme, vibe, dress_code, capacity, plus_one, byob, note,
    status (active | cancelled | done), cover, address, how_to, wifi, link (the public invite URL or null), counts: {going,
    maybe, no, plus_ones, heads, left}, created_by, created_at, updated_at}. guests = [{id, name, answer: going | maybe |
    no, plus_one, came, removed}] (no contacts, no secrets). items = the checklist (drinks, ice, food, music, cups,
    cleanup, other) with who brings it and its cost (costs go to Money as expenses). ratings = members' 1–5 after the
    party; recap = {came, heads, spent, currency, rating, n_ratings, photos}. rules = the region pack's events.party
    ({quiet_after, hint_ru, hint_en, notice_owner, notice_neighbours, fines_ru?, fines_en?}) or null.

    The members run their party in the Mini App themselves (invite link, RSVP, checklist, photos). You help when asked:
    fix a field with party_set, and draft the notice to the house owner / neighbours (party_notice_draft) when the rules
    say so or a member asks (digest event party_notice_requested). The guests' address, how-to and Wi-Fi are shown only
    to guests who answered "Иду" on their personal link; never paste them into chats."""
    if party_id is None:
        return await _base.api("GET", "/api/parties", params={"search_id": search_id})
    out = await _base.api("GET", f"/api/parties/{_base._q(_party_id(party_id))}")
    sid = ((out or {}).get("party") or {}).get("search_id")
    if sid and sid != search_id:
        raise ToolError(f"Party {party_id} belongs to search {sid}, not {search_id}.")
    return out


@_base.mcp.tool()
async def party_set(search_id: str, fields: dict, party_id: str | None = None) -> dict:
    """Create a party (no party_id) or change one (party_id). Members usually do this in the Mini App; use it when a
    member asks you ("собираем тусовку в субботу в 7, тема белая") or to fix a detail.

    fields: title (≤ 80, required on create), starts_at (local ISO WITH the region's offset, e.g.
    2026-11-28T19:00:00+08:00; required on create; use time_info for the offset, never guess), ends_at?, theme? (≤ 80,
    "Белая вечеринка"), vibe? (chill | dance | dinner | pool | games | sunset), dress_code? (≤ 60), capacity? (1..300 heads),
    plus_one? (default true), byob?, note? (≤ 300), address? (≤ 200) and how_to? (≤ 300) — shown ONLY to guests who
    answered "Иду" on their personal link — wifi? (true: show the house guide's Wi-Fi to those guests), status? (active |
    cancelled | done). Omitted fields keep their values. Passport/ID/card numbers are refused locally.

    Respect the region's party rules (party_get → rules: quiet after HH:MM, notice the owner/neighbours): mention them to
    the members, and offer the notice draft. Returns {party}."""
    body = validate_party(fields, create=party_id is None)
    if party_id is None:
        return await _base.api("POST", "/api/parties", body={"search_id": search_id, **body})
    if not body:
        raise ToolError("fields has nothing to change.")
    return await _base.api("PUT", f"/api/parties/{_base._q(_party_id(party_id))}", body=body)


@_base.mcp.tool()
async def party_guests_get(party_id: str) -> dict:
    """Guest list of a party: {guests: [{id, name, answer: going | maybe | no, plus_one: 0 | 1, came: true | false | null,
    removed, created_at, updated_at}], counts: {going, maybe, no, plus_ones, heads, left}}. Guests answer on the public
    invite page without Telegram; there are no contacts here and you never message guests. heads = going + their +1s;
    left = capacity − heads (null without a capacity)."""
    return await _base.api("GET", f"/api/parties/{_base._q(_party_id(party_id))}/guests")


@_base.mcp.tool()
async def party_notice_draft(
    party_id: str,
    to: str,
    channel: str,
    address: str,
    contact_id: str | None = None,
    lang: str | None = None,
    text: str | None = None,
    reason: str | None = None,
) -> dict:
    """Draft a heads-up about a party to the house owner or the neighbours (POST /api/parties/:id/notice-draft). It is an
    APPROVAL DRAFT only (drafts.kind party_notice): the humans approve or edit it in Telegram, then drafts_ready → send
    final_text with the channel tool → draft_mark. NEVER auto-send it, never send it without the approval, never send it
    on a member's word alone in chat.

    When: the region pack's party rules (party_get → rules: notice_owner / notice_neighbours, quiet_after) say so, or a
    member asked (digest event party_notice_requested {to, party_id}). Usually a day or two before; not at night.
    Tone: short, warm and polite, like a good neighbour: the date and time, roughly how many people, that you keep it
    quiet after the local quiet hour (rules.quiet_after) and end on time, a contact for "too loud, please". No excuses,
    no legal talk, no promises you cannot keep. Language: the OWNER'S language from the thread with them (read
    tg_history / wa_history first; messages with dir='in' only) — for neighbours the local language (in Bali often
    Indonesian, English as a fallback). Local custom first: in Bali the banjar (village community) may fine noisy
    parties; rules.hint_* / fines_* say what the pack knows — never invent amounts.

    Args:
        to: owner | neighbours.
        channel / address: telegram | whatsapp | instagram | facebook | email | phone and the address (the owner's
            channel from the house contacts; for neighbours whatever the members gave you).
        contact_id: link the house contact when you have it.
        lang: 2-letter language; without text the CRM writes a short default from its template (en | ru | id).
        text: your own message (preferred when you know the owner's language and manner).
        reason: one line for the approver ("owner asked to warn about parties; Sat 19:00, ~15 people").
    Returns {draft}."""
    _party_id(party_id)
    if to not in PARTY_NOTICE_TO:
        raise ToolError(f"to must be one of {', '.join(PARTY_NOTICE_TO)}.")
    if channel not in PARTY_NOTICE_CHANNELS:
        raise ToolError(f"channel must be one of {', '.join(PARTY_NOTICE_CHANNELS)}.")
    if not isinstance(address, str) or not address.strip():
        raise ToolError("address is required (where the notice will be sent: @handle, +62…, email).")
    if lang is not None and not re.match(r"^[a-z]{2}$", lang):
        raise ToolError("lang must be a 2-letter language code (en, ru, id …).")
    if text is not None and not text.strip():
        raise ToolError("text is empty.")
    if not text and lang is not None and lang not in PARTY_TEMPLATE_LANGS:
        raise ToolError(f"The CRM template exists only for {', '.join(PARTY_TEMPLATE_LANGS)}; write text yourself for {lang}.")
    if text and len(text) > 1500:
        raise ToolError("text is longer than 1500 characters; a notice is a few lines.")
    bad = _deals.sensitive_findings({"text": text, "reason": reason, "address": address})
    if bad:
        raise ToolError("Refused: " + "; ".join(bad))
    body = _base._clean({"to": to, "channel": channel, "address": address.strip(), "contact_id": contact_id, "lang": lang,
                   "text": text.strip() if text else None, "reason": reason})
    return await _base.api("POST", f"/api/parties/{_base._q(party_id)}/notice-draft", body=body)
