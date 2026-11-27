"""Hunt core: house (split from hunt_core.py)."""
from __future__ import annotations
import mimetypes
import re
from pathlib import Path
import httpx
from huntcore.base import ToolError
from huntcore import base as _base, deals as _deals, routes as _routes
# ---------------------------------------------------------------- life in the villa

ISSUE_STATUSES = ("open", "scheduled", "fixed")
HOUSE_ROLES = ("owner", "manager", "cleaning", "pool", "garden", "repair", "security", "internet", "other")


@_base.mcp.tool()
async def living_get(search_id: str) -> dict:
    """The house we live in: issues (open | scheduled | fixed), house contacts (owner, cleaning, pool… with cost,
    period, who pays, schedule), the deal and its dates. Members report issues in the Mini App ("Report"): that
    also arrives in search_digest as an instruction with kind "issue" — relay it to the owner in their language."""
    return await _base.api("GET", f"/api/searches/{_base._q(search_id)}/living")


@_base.mcp.tool()
async def issue_set(
    search_id: str,
    issue_id: str = "new",
    title: str | None = None,
    status: str | None = None,
    note: str | None = None,
    scheduled_at: str | None = None,
    fixed_at: str | None = None,
) -> dict:
    """Create (issue_id="new") or update a house issue. Omitted fields keep their values.
    status: open | scheduled (repair booked: set scheduled_at, ISO local time with offset) | fixed.
    note: one line about what happened, in the hunter's language ("wrote to Made in Indonesian", "Made sent a plumber")."""
    if status and status not in ISSUE_STATUSES:
        raise ToolError(f"status must be one of {', '.join(ISSUE_STATUSES)}.")
    if scheduled_at and not _deals._ISO_WITH_TZ.match(scheduled_at):
        raise ToolError("scheduled_at must be ISO local time with offset, e.g. 2026-11-21T10:00:00+08:00.")
    body = _base._clean({"search_id": search_id, "title": title, "status": status, "note": note, "scheduled_at": scheduled_at, "fixed_at": fixed_at})
    if issue_id == "new" and not title:
        raise ToolError("title is required for a new issue.")
    return await _base.api("PUT", f"/api/issues/{_base._q(issue_id)}", body=body)


@_base.mcp.tool()
async def house_contact_set(
    search_id: str,
    contact_id: str = "new",
    name: str | None = None,
    role: str | None = None,
    note: str | None = None,
    cost: int | None = None,
    currency: str | None = None,
    period: str | None = None,
    payer: str | None = None,
    schedule: str | None = None,
    channel: str | None = None,
    address: str | None = None,
    sort: int | None = None,
    delete: bool = False,
) -> dict:
    """Add or update a person of the house (Mini App "Contacts" with a button into their messenger).

    Args:
        role: owner | manager | cleaning | pool | garden | repair | security | internet | other.
        note: "repairs at his cost". cost + currency + period (month | week | visit | once): what they cost.
        payer: rent (included in the rent) | us (we pay them). schedule: "Tue, Fri".
        channel + address: whatsapp/+62…, telegram/@user, phone/+62… (the button opens it).
        delete: true removes this contact (contact_id required).
    """
    if delete:
        if contact_id == "new":
            raise ToolError("contact_id is required to delete.")
        return await _base.api("DELETE", f"/api/house-contacts/{_base._q(contact_id)}")
    if role and role not in HOUSE_ROLES:
        raise ToolError(f"role must be one of {', '.join(HOUSE_ROLES)}.")
    if period and period not in ("month", "week", "visit", "once"):
        raise ToolError("period must be month, week, visit or once.")
    if payer and payer not in ("rent", "us"):
        raise ToolError("payer must be rent or us.")
    body = _base._clean({"search_id": search_id, "name": name, "role": role, "note": note, "cost": cost, "currency": currency, "period": period,
                   "payer": payer, "schedule": schedule, "channel": channel, "address": address, "sort": sort})
    if contact_id == "new" and not name:
        raise ToolError("name is required for a new contact.")
    return await _base.api("PUT", f"/api/house-contacts/{_base._q(contact_id)}", body=body)


# ---------------------------------------------------------------- documents and deal dates

DOC_KINDS = ("lease", "receipt", "owner_consent", "movein_video", "moveout_video", "other")
DOC_STATUSES = ("have", "request", "due")
DATE_KINDS = ("payment", "notice", "moveout", "deposit_return", "other")
MAX_DOC_BYTES = 49 * 1024 * 1024  # Bot API sendDocument limit is 50 MB; getFile reads up to 20 MB


@_base.mcp.tool()
async def doc_list(search_id: str, listing_id: str | None = None) -> list:
    """Deal documents of a search: [{id, listing_id, kind, title, status, due_date, version, doc_date, signed_at, pages,
    note, summary, has_file, file_kind, file_name, mime}]. Files live in Telegram (the CRM keeps only the file id):
    members send them to the bot DM, and they show up here with has_file=true and a "document" digest event."""
    return await _base.api("GET", f"/api/searches/{_base._q(search_id)}/documents", params={"listing_id": listing_id})


@_base.mcp.tool()
async def doc_get(doc_id: str, out_dir: str | None = None) -> dict:
    """Get a document and download its file (from Telegram through the CRM, nothing is stored there) to a local path,
    default <config>/docs/. Read the file, then doc_summary_set and deal_dates_set. Returns {document, path}."""
    meta = await _base.api("GET", f"/api/documents/{_base._q(doc_id)}")
    doc = meta.get("document") or {}
    if not doc.get("has_file"):
        return {"document": doc, "path": None, "note": "No file yet (status request/due)."}
    url, token = _base._creds()
    try:
        async with httpx.AsyncClient(base_url=url, transport=_base._TRANSPORT, timeout=120) as c:
            r = await c.get(f"/api/documents/{_base._q(doc_id)}/file", headers=_base._crm_headers(token))
    except httpx.HTTPError as e:
        raise ToolError(f"Cannot download document {doc_id} ({type(e).__name__}).")
    if r.status_code >= 400:
        raise ToolError(f"CRM {r.status_code} while downloading document {doc_id}: {r.text[:200]}")
    folder = Path(out_dir).expanduser() if out_dir else _base.config_dir() / "docs"
    folder.mkdir(parents=True, exist_ok=True)
    name = doc.get("file_name") or ""
    if not name:
        ext = mimetypes.guess_extension((r.headers.get("content-type") or "").split(";")[0].strip()) or ".bin"
        name = f"{doc_id}{ext}"
    safe = re.sub(r"[^\w.\- ]+", "_", name)
    path = folder / f"{doc_id}-{safe}"
    path.write_bytes(r.content)
    return {"document": doc, "path": str(path)}


@_base.mcp.tool()
async def doc_set(
    listing_id: str,
    doc_id: str = "new",
    kind: str | None = None,
    title: str | None = None,
    status: str | None = None,
    due_date: str | None = None,
    version: int | None = None,
    doc_date: str | None = None,
    signed_at: str | None = None,
    pages: int | None = None,
    note: str | None = None,
    term_seq: int | None = None,
) -> dict:
    """Create (doc_id="new") or update a deal document row (no file): e.g. the move-in video that is due on Monday.
    kind: lease | receipt | owner_consent | movein_video | other. status: have | request | due (with due_date).
    note: one line under the title ("Without it the sublease is a risk"). Dates YYYY-MM-DD.
    term_seq: the lease term the document belongs to (omit for the first contract; 2, 3… for an extension, see deal_term_set).
    title in the hunter's language, never with ID/passport numbers."""
    if kind and kind not in DOC_KINDS:
        raise ToolError(f"kind must be one of {', '.join(DOC_KINDS)}.")
    if status and status not in DOC_STATUSES:
        raise ToolError(f"status must be one of {', '.join(DOC_STATUSES)}.")
    for _name, v in (("due_date", due_date), ("doc_date", doc_date), ("signed_at", signed_at)):
        if v:
            _routes._parse_date(v)
    if doc_id == "new" and not title:
        raise ToolError("title is required for a new document.")
    body = _base._clean({"listing_id": listing_id, "kind": kind, "title": title, "status": status, "due_date": due_date, "version": version,
                   "doc_date": doc_date, "signed_at": signed_at, "pages": pages, "note": note, "term_seq": term_seq})
    bad = _deals.sensitive_findings(body)
    if bad:
        raise ToolError("Refused: " + "; ".join(bad))
    return await _base.api("PUT", f"/api/documents/{_base._q(doc_id)}", body=body)


@_base.mcp.tool()
async def doc_request(listing_id: str, kind: str, title: str, note: str | None = None, doc_id: str | None = None) -> dict:
    """Mark a document as "request" (shown with a "Request" chip) and then ask the owner for it with draft_create.
    When a place is taken, request: the lease, a receipt for EVERY cash payment, the owner's written consent if it is
    a sublease, and plan the move-in video + meter photos (doc_set status="due"). doc_id updates an existing row."""
    if kind not in DOC_KINDS:
        raise ToolError(f"kind must be one of {', '.join(DOC_KINDS)}.")
    body = _base._clean({"listing_id": listing_id, "kind": kind, "title": title, "status": "request", "note": note})
    return await _base.api("PUT", f"/api/documents/{_base._q(doc_id or 'new')}", body=body)


@_base.mcp.tool()
async def doc_summary_set(
    doc_id: str,
    sections: list[dict],
    changes: str | None = None,
    changes_from: int | None = None,
    version: int | None = None,
    pages: int | None = None,
    doc_date: str | None = None,
    signed_at: str | None = None,
) -> dict:
    """Write the document summary the members read in the Mini App ("Key points").

    Args:
        sections: 3–6 items [{icon, title, text}], short, in the hunter's language. icon: users (who rents it out) |
            calendar (term) | wallet (money) | shield (deposit) | zap (utilities) | home | key | file | alert | receipt | info.
        changes: for a new version, what changed vs the previous one (1–2 lines); changes_from = that version number.
    Never include passport/ID/card/bank numbers or anyone's date of birth: refused locally and by the CRM.
    Then extract the dates with deal_dates_set.
    """
    if not isinstance(sections, list) or not sections:
        raise ToolError("sections must be a non-empty list of {icon, title, text}.")
    for i, x in enumerate(sections):
        if not isinstance(x, dict) or not x.get("title") or not x.get("text"):
            raise ToolError(f"sections[{i}] needs title and text.")
    summary = _base._clean({"sections": sections, "changes": changes, "changes_from": changes_from})
    body = _base._clean({"summary": summary, "version": version, "pages": pages, "doc_date": doc_date, "signed_at": signed_at})
    bad = _deals.sensitive_findings(body)
    if bad:
        raise ToolError("Refused: the summary looks like it contains sensitive numbers. Remove them. " + "; ".join(bad))
    return await _base.api("PUT", f"/api/documents/{_base._q(doc_id)}", body=body)


@_base.mcp.tool()
async def doc_upload(
    listing_id: str,
    path: str,
    kind: str = "other",
    title: str | None = None,
    version: int | None = None,
    pages: int | None = None,
    doc_date: str | None = None,
    signed_at: str | None = None,
    note: str | None = None,
    term_seq: int | None = None,
) -> dict:
    """Send a local file (e.g. the lease converted from .docx to PDF) to the deal: the bot sends it to the hunter's
    Telegram DM and the CRM keeps only the Telegram file id (the file is not stored by Hunt). Members can then open
    it in the Mini App or get it in their own DM. Max 49 MB. term_seq: 2, 3… for an extension's contract (deal_term_set).
    Returns {document}."""
    fp = Path(path).expanduser()
    if not fp.is_file():
        raise ToolError(f"File not found: {fp}")
    if kind not in DOC_KINDS:
        raise ToolError(f"kind must be one of {', '.join(DOC_KINDS)}.")
    size = fp.stat().st_size
    if size > MAX_DOC_BYTES:
        raise ToolError(f"{fp.name} is {size / 1e6:.1f} MB; Telegram bots send files up to 50 MB.")
    meta = _base._clean({"kind": kind, "title": title or fp.stem, "version": version, "pages": pages, "doc_date": doc_date, "signed_at": signed_at, "note": note, "term_seq": term_seq})
    bad = _deals.sensitive_findings(meta)
    if bad:
        raise ToolError("Refused: " + "; ".join(bad))
    mime = mimetypes.guess_type(fp.name)[0] or "application/octet-stream"
    files = [("file", (fp.name, fp.read_bytes(), mime))] + [(k, (None, str(v))) for k, v in meta.items()]
    return await _base.api("POST", f"/api/listings/{_base._q(listing_id)}/documents", files=files, timeout=180)


@_base.mcp.tool()
async def deal_dates_set(listing_id: str, dates: list[dict]) -> dict:
    """Save the deal dates extracted from the lease (replaces deal.dates, keeps the rest of the deal). The bot reminds
    every member: payment 7 and 2 days before and the morning of the day; notice 14 and 3 days before; move-out 3 days
    before; deposit return on the day and again 3 days later unless done (then you also get a "date_due" digest event:
    write to the landlord).

    dates: [{date: YYYY-MM-DD, kind: payment | notice | moveout | deposit_return | other, title, amount?, currency?,
             note?, done?}]; mark paid payments / returned deposit with done=true.
    """
    if not isinstance(dates, list):
        raise ToolError("dates must be a list.")
    for i, d in enumerate(dates):
        if not isinstance(d, dict) or d.get("kind") not in DATE_KINDS or not d.get("title"):
            raise ToolError(f"dates[{i}] needs date, kind ({'|'.join(DATE_KINDS)}) and title.")
        _routes._parse_date(d.get("date", ""))
    return await _base.api("PUT", f"/api/deals/{_base._q(listing_id)}/dates", body={"dates": dates})
