"""Hunt core: messages (split from hunt_core.py)."""
from __future__ import annotations
from typing import Any
from huntcore.base import ToolError
from huntcore import base as _base
# ---------------------------------------------------------------- contacts & messages

@_base.mcp.tool()
async def contact_resolve(channel: str | None = None, address: str | None = None, q: str | None = None, search_id: str | None = None) -> dict:
    """Find a known contact before creating one (avoid duplicates: one agent often has many listings).

    Args:
        channel: telegram | whatsapp | messenger | instagram | email | line | phone | portal:<name>.
        address: '@username' or numeric id (telegram), '+6281200000033' (whatsapp/phone), email, thread id.
            Phone-like addresses are normalized; a miss on the channel retries the address on any channel.
        q: free text instead of channel+address (matches name, address, display) among contacts of YOUR searches only;
            an exact channel+address finds a contact from any search on this Hunt (listings only from your searches,
            notes from other hunters' searches without their titles).
        search_id: the search you are working on: `notes_elsewhere` then lists notes about this person written
            in OTHER searches on this Hunt. If it is not empty, tell the hunter before writing ("Erna again: last time
            she recalculated per night on early move-out").
    Returns {contact, channels, listings, notes, notes_elsewhere, stats} or {contact: null}.
    """
    if channel and address:
        body: dict[str, Any] = {"channel": channel, "address": address}
    elif q:
        body = {"q": q}
    else:
        raise ToolError("Give channel+address, or q.")
    if search_id:
        body["search_id"] = search_id
    return await _base.api("POST", "/api/contacts/resolve", body=body)


@_base.mcp.tool()
async def contact_upsert(
    contact_id: str = "new",
    name: str | None = None,
    role: str | None = None,
    lang: str | None = None,
    notes: str | None = None,
    channels: list[dict] | None = None,
) -> dict:
    """Create (contact_id="new") or update a contact. Missing fields keep their old values.

    Args:
        role: owner | agent | agency | manager | relative | tenant_subletting.
        lang: language we write to them in (en, ru, id, th, kk).
        channels: [{"channel": "whatsapp", "address": "+62823...", "display": "Bali Villas"}]; an address
            already linked to another contact is never moved: the CRM answers 409 channel_taken with that contact's id
            (use it instead). Only your own contacts can be changed
            (404 otherwise).
    Returns {contact, channels, listings}. Call contact_resolve first.
    """
    for ch in channels or []:
        if not isinstance(ch, dict) or not ch.get("channel") or not ch.get("address"):
            raise ToolError("Each channel needs 'channel' and 'address'.")
    body = _base._clean({"name": name, "role": role, "lang": lang, "notes": notes, "channels": channels})
    return await _base.api("PUT", f"/api/contacts/{_base._q(contact_id)}", body=body)


@_base.mcp.tool()
async def contact_link(contact_id: str, listing_id: str, role: str = "primary") -> dict:
    """Link a contact to a listing (role: primary | secondary). One agent can be linked to many listings."""
    return await _base.api("POST", f"/api/contacts/{_base._q(contact_id)}/link", body={"listing_id": listing_id, "role": role})


@_base.mcp.tool()
async def contact_messages(contact_id: str, limit: int = 200) -> list:
    """Logged messages with a contact, oldest first (last `limit`). This is the CRM log; for the full
    live thread read the channel itself (tg_history)."""
    return await _base.api("GET", f"/api/contacts/{_base._q(contact_id)}/messages", params={"limit": max(1, min(int(limit), 1000))})


DIRECTIONS = ("in", "out", "call_missed")


@_base.mcp.tool()
async def messages_log(messages: list[dict]) -> dict:
    """Log messages (in and out, any channel) to the CRM. Re-logging is safe: rows are deduplicated
    by (channel, external_id), so always pass external_id (tg_inbox/tg_history give one per message).

    Each item: {channel, direction: in|out|call_missed, text, at (ISO), external_id,
                search_id and/or listing_id (one of YOUR searches, required), contact_id?, media?: [{type, filename|url, caption}],
                tr?: the text in the owner's language when the message is in another one (the site shows it first, the original
                small under it)}. Logging a message again only to add tr is fine.
    Passport / ID / card numbers in the text are masked by the CRM. Returns {inserted, skipped}.
    """
    if not isinstance(messages, list) or not messages:
        raise ToolError("messages must be a non-empty list.")
    missing_ext = 0
    for i, m in enumerate(messages):
        if not isinstance(m, dict):
            raise ToolError(f"messages[{i}] is not an object.")
        if not m.get("channel"):
            raise ToolError(f"messages[{i}] has no channel.")
        if m.get("direction") not in DIRECTIONS:
            raise ToolError(f"messages[{i}].direction must be one of {DIRECTIONS}.")
        if not m.get("search_id") and not m.get("listing_id"):
            raise ToolError(f"messages[{i}] needs search_id or listing_id (the CRM refuses messages without a search).")
        if not m.get("external_id"):
            missing_ext += 1
    inserted = skipped = 0
    for i in range(0, len(messages), 100):
        r = await _base.api("POST", "/api/messages", body=messages[i:i + 100], timeout=60)
        inserted += r.get("inserted", 0)
        skipped += r.get("skipped", 0)
    out: dict[str, Any] = {"inserted": inserted, "skipped": skipped}
    if missing_ext:
        out["warning"] = f"{missing_ext} message(s) without external_id cannot be deduplicated if logged again."
    return out


# ---------------------------------------------------------------- threads

THREAD_STATES = ("waiting_us", "waiting_them", "closed")


@_base.mcp.tool()
async def thread_set(
    search_id: str,
    contact_id: str,
    state: str,
    known: str | None = None,
    open: str | None = None,
    last: str | None = None,
    last_at: str | None = None,
    listing_id: str | None = None,
) -> dict:
    """Update the conversation summary with one contact (what the hunter and friends see in the Mini App
    "Messages" screen). Call it after EVERY incoming or outgoing message with that contact, right after
    messages_log: rewrite the summary, don't append.

    Args:
        state: waiting_us (they wrote, we owe a reply or a decision) | waiting_them (we wrote, waiting) |
            closed (no longer relevant: declined, taken elsewhere, stopped).
        known: facts agreed so far (price, what's included, dates, deposit, payment), 1-3 short lines.
        open: open questions, 1-3 short lines ("meeting time on Friday", "list of things for sale").
        last: one line about the last message ("The owner sent the updated contract").
        last_at: ISO time of that last message.
        listing_id: the place this conversation is about.
    Write known/open/last in the hunter's language (profile lang), short and plain, no budget_cap.
    Omitted fields keep their current values. Returns {thread, created}.
    """
    if state not in THREAD_STATES:
        raise ToolError(f"state must be one of {', '.join(THREAD_STATES)}.")
    for name, v in (("known", known), ("open", open), ("last", last)):
        if v is not None and len(v) > 600:
            raise ToolError(f"{name} is too long: keep it to 1-3 short lines.")
    body = _base._clean({"search_id": search_id, "contact_id": contact_id, "state": state, "known": known, "open": open,
                   "last": last, "last_at": last_at, "listing_id": listing_id})
    return await _base.api("PUT", "/api/threads", body=body)


# ---------------------------------------------------------------- drafts

DRAFT_KINDS = ("first_contact", "follow_up", "ask_details", "negotiate", "schedule", "running_late",
               "decline", "cancel", "found", "reply", "other")


@_base.mcp.tool()
async def draft_create(
    search_id: str,
    channel: str,
    address: str,
    text: str,
    kind: str = "other",
    reason: str | None = None,
    contact_id: str | None = None,
    listing_id: str | None = None,
    tr: str | None = None,
) -> dict:
    """Queue an outgoing message for approval. Never send to a landlord without a draft.
    In "ask" mode the owner gets it in the bot with Send / Edit / Skip; in "routine_auto" mode the
    routine kinds (schedule, running_late, decline, cancel, found) come back already approved.

    Args:
        channel/address: where it will be sent, e.g. telegram/@odegalle, whatsapp/+62823...
        text: the exact message, in the contact's language, short and human.
        kind: first_contact | follow_up | ask_details | negotiate | schedule | running_late | decline |
              cancel | found | reply | other.
        reason: one line for the approver: why this message, what it asks.
        tr: what the message says in the owner's language, when the message is in another one.
    Returns {draft}; check draft.status (pending or approved). Then poll drafts_ready.
    """
    if kind not in DRAFT_KINDS:
        raise ToolError(f"kind must be one of {', '.join(DRAFT_KINDS)}.")
    if not text.strip():
        raise ToolError("text is empty.")
    body = _base._clean({"search_id": search_id, "channel": channel, "address": address, "text": text, "kind": kind,
                   "reason": reason, "contact_id": contact_id, "listing_id": listing_id, "tr": tr})
    return await _base.api("POST", "/api/drafts", body=body)


def ready_drafts(rows: list[dict]) -> list[dict]:
    out = []
    for d in rows:
        edited = (d.get("edited_text") or "").strip()
        out.append({**d, "final_text": edited or d.get("text"), "was_edited": bool(edited)})
    return out


@_base.mcp.tool()
async def drafts_ready(search_id: str | None = None) -> list:
    """Drafts the owner approved (status approved or edited) and that still have to be sent.
    Send exactly `final_text` (the owner's edited version when was_edited is true, else the original),
    via the draft's channel and address, then call draft_mark(draft_id, "sent" | "failed").
    Drafts of kind "guest" (a guest of the house asked, via the Mini App, to message a directory contact; created by
    the CRM, `requested_by` = the guest, reason "Guest <name> asks to write to <contact>") are approved by a member
    or the owner and come back here like any other ready draft: send them the same way."""
    rows = await _base.api("GET", "/api/drafts", params={"search_id": search_id, "status": "ready"})
    return ready_drafts(rows)


@_base.mcp.tool()
async def draft_mark(draft_id: str, status: str, error: str | None = None) -> dict:
    """Mark an approved draft as sent or failed after trying to send it (status: sent | failed).
    Mark sent only after the channel confirmed (message id returned)."""
    if status not in ("sent", "failed"):
        raise ToolError("status must be 'sent' or 'failed'.")
    return await _base.api("PATCH", f"/api/drafts/{_base._q(draft_id)}", body=_base._clean({"status": status, "error": error}))


# ---------------------------------------------------------------- notify

@_base.mcp.tool()
async def notify(search_id: str, text: str, to: str = "owner") -> dict:
    """Send a short notice from the bot: to="owner" (owner's DM) or to="chat" (the search group; falls
    back to the owner's DM if no group). Telegram HTML allowed (<b>, <i>, <a href>). Use for things
    humans must know or decide now; routine progress belongs in listing cards and the digest."""
    if to not in ("owner", "chat"):
        raise ToolError("to must be 'owner' or 'chat'.")
    if not text.strip():
        raise ToolError("text is empty.")
    return await _base.api("POST", "/api/notify", body={"search_id": search_id, "text": text, "to": to})
