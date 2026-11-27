"""Hunt core: events (split from hunt_core.py)."""
from __future__ import annotations
import re
from datetime import datetime
from typing import Any
from huntcore.base import ToolError
from huntcore import base as _base, deals as _deals
# ---------------------------------------------------------------- wave 7 · Афиша (events)

EVENT_CATEGORIES = ("culture", "nature", "sport", "dance", "music", "food", "workshop", "party", "wellness", "kids", "other",
                    "bar", "club", "beach_club", "social_sport", "meetup", "quiz")
EVENT_TOPICS = ("fire_show", "kecak", "sea", "snorkel", "diving", "boat", "surf", "surf_meetup", "volcano", "sunrise_hike", "yoga",
                "meditation", "wellness", "waterfall", "river", "rafting", "market", "food", "cooking_class", "temple", "ceremony",
                "cinema", "festival", "celebration", "kids", "stargazing", "night_tour", "jungle_night", "bar", "party", "club", "dj",
                "beach_club", "sunset_session", "live_music", "music", "dance", "padel", "night_sport", "volleyball", "run_club",
                "quiz", "karaoke", "open_mic", "pub_crawl", "language_exchange", "dating", "workshop")
EVENT_LANGS = ("ru", "en", "id", "mixed", "none")
EVENT_PRICE_KINDS = ("free", "paid", "on_site", "unknown")
EVENT_ENTRY = ("free", "fee", "min_spend", "guest_list")
EVENT_BOOKING = ("none", "message", "ticket")
EVENT_VIBES = ("chill", "party", "sport", "meet")
EVENT_CROWDS = ("expats", "locals", "mixed")
EVENT_TAGS = ("dinner_show", "hotel_lobby", "ballroom", "bus_tour", "buffet_evening", "timeshare", "tour_group", "seniors", "dj",
              "sunset", "festival", "rooftop", "beach_club", "meetup", "creative", "young_crowd", "alcohol_promo", "live")
EVENT_SOURCE_KINDS = ("telegram", "instagram", "facebook", "web", "place", "pack", "user")
EVENT_ORG_CHANNELS = ("telegram", "whatsapp", "instagram", "facebook", "email", "phone", "web")
EVENT_STATUS = ("active", "cancelled", "hidden")
BOOKING_STATUS = ("requested", "drafted", "asked", "booked", "declined", "cancelled", "attended")
BOOKING_SET_STATUS = ("asked", "booked", "declined", "cancelled", "attended")
RECUR_FREQ = ("daily", "weekly", "monthly", "seasonal")
EVENT_TEMPLATE_LANGS = ("en", "ru", "id")
EVENTS_MAX = 50

_TOPIC = re.compile(r"^[a-z_]{2,30}$")
_HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
_ISO_OFFSET = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?[+-]\d{2}:\d{2}$")
_HTTPS = re.compile(r"^https://[^\s/]+\.[^\s]+$", re.I)
_CURRENCY = re.compile(r"^[A-Z]{3}$")

_EV_TEXT = {"country": 40, "city": 40, "area": 60, "title": 140, "title_en": 140, "about_ru": 400, "about_en": 400,
            "place_name": 140, "place_id": 80, "price_note": 140, "organizer_name": 120, "organizer_address": 200,
            "organizer_contact_id": 80, "organizer_lang": 10, "source_name": 140, "photo_credit": 140, "dress_code": 80,
            "search_id": 80}
_EV_URL = ("map_url", "ticket_url", "source_url", "photo_url", "photo_source_url")
_EV_UNIT = ("source_rep", "photo_score", "quality")
_EV_BOOL = ("photo_reuse", "beginner", "outdoor", "sea")
_EV_ENUM = {"category": EVENT_CATEGORIES, "lang": EVENT_LANGS, "price_kind": EVENT_PRICE_KINDS, "entry": EVENT_ENTRY,
            "booking": EVENT_BOOKING, "vibe": EVENT_VIBES, "crowd": EVENT_CROWDS, "source_kind": EVENT_SOURCE_KINDS,
            "organizer_channel": EVENT_ORG_CHANNELS, "status": EVENT_STATUS}
EVENT_FIELDS = frozenset(set(_EV_TEXT) | set(_EV_URL) | set(_EV_UNIT) | set(_EV_BOOL) | set(_EV_ENUM)
                         | {"topic", "starts_at", "ends_at", "recurrence", "lat", "lng", "price", "currency", "age_min", "tags"})
EVENT_REQUIRED = ("country", "title", "about_ru", "category", "source_kind", "source_url")


def _iso_offset(v: Any, where: str) -> datetime:
    if not isinstance(v, str) or not _ISO_OFFSET.match(v):
        raise ToolError(f"{where} must be local ISO time with the region's offset, e.g. 2026-11-21T18:00:00+08:00.")
    try:
        return datetime.fromisoformat(v)
    except ValueError:
        raise ToolError(f"{where} is not a real date/time ({v}).")


def _recurrence(r: Any, where: str) -> dict:
    if not isinstance(r, dict):
        raise ToolError(f"{where} must be {{freq, time, end?, weekdays?, day?, nth?, months?, from?, until?}}.")
    extra = set(r) - {"freq", "time", "end", "weekdays", "day", "nth", "months", "from", "until"}
    if extra:
        raise ToolError(f"{where}: unknown keys {sorted(extra)}.")
    freq = r.get("freq")
    if freq not in RECUR_FREQ:
        raise ToolError(f"{where}.freq must be one of {', '.join(RECUR_FREQ)}.")
    for k in ("time", "end"):
        if k in r and (not isinstance(r[k], str) or not _HHMM.match(r[k])):
            raise ToolError(f"{where}.{k} must be HH:MM (24 h, local time).")
    if "time" not in r:
        raise ToolError(f"{where}.time is required (HH:MM local) for a recurring event.")

    def ints(k: str, lo: int, hi: int) -> list[int]:
        v = r.get(k)
        if not isinstance(v, list) or not v or any(isinstance(x, bool) or not isinstance(x, int) or not lo <= x <= hi for x in v):
            raise ToolError(f"{where}.{k} must be a non-empty list of integers {lo}..{hi}.")
        return v

    if "weekdays" in r:
        ints("weekdays", 1, 7)
    if "months" in r:
        ints("months", 1, 12)
    if freq == "weekly" and "weekdays" not in r:
        raise ToolError(f"{where}: a weekly event needs weekdays (ISO, 1 = Monday … 7 = Sunday).")
    if freq == "seasonal" and "months" not in r:
        raise ToolError(f"{where}: a seasonal event needs months (1..12).")
    if "day" in r and (isinstance(r["day"], bool) or not isinstance(r["day"], int) or not 1 <= r["day"] <= 31):
        raise ToolError(f"{where}.day must be 1..31.")
    if "nth" in r:
        if r["nth"] not in (1, 2, 3, 4, -1) or isinstance(r["nth"], bool):
            raise ToolError(f"{where}.nth must be 1..4 or -1 (last).")
        if "weekdays" not in r:
            raise ToolError(f"{where}: nth needs weekdays[0] (e.g. nth 1 + weekdays [5] = the first Friday).")
    if freq == "monthly" and "day" not in r and "nth" not in r:
        raise ToolError(f"{where}: a monthly event needs day or nth + weekdays.")
    for k in ("from", "until"):
        if k in r and (not isinstance(r[k], str) or not _deals._DATE.match(r[k])):
            raise ToolError(f"{where}.{k} must be YYYY-MM-DD.")
    return dict(r)


def validate_event(ev: Any, where: str = "event", partial: bool = False) -> dict:
    """Check one Event (events_upsert item or event_set fields) against the wave 7 contract; return a cleaned copy.
    Raises ToolError naming the field. partial=True (event_set) skips the required fields."""
    if not isinstance(ev, dict):
        raise ToolError(f"{where} must be an object.")
    unknown = set(ev) - EVENT_FIELDS
    if unknown:
        raise ToolError(f"{where}: unknown fields {sorted(unknown)}.")
    out = {k: v for k, v in ev.items() if v is not None}
    if not partial:
        missing = [k for k in EVENT_REQUIRED if out.get(k) in (None, "")]
        if missing:
            raise ToolError(f"{where}: missing {', '.join(missing)}.")
    for k, n in _EV_TEXT.items():
        if k in out:
            if not isinstance(out[k], str) or not out[k].strip():
                raise ToolError(f"{where}.{k} must be a non-empty string.")
            out[k] = out[k].strip()
            if len(out[k]) > n:
                raise ToolError(f"{where}.{k} is longer than {n} characters; keep it short.")
    for k in ("country", "city"):
        if k in out:
            out[k] = out[k].lower()
    for k, allowed in _EV_ENUM.items():
        if k in out and out[k] not in allowed:
            raise ToolError(f"{where}.{k} must be one of {', '.join(allowed)}.")
    if "topic" in out and (not isinstance(out["topic"], str) or not _TOPIC.match(out["topic"])):
        raise ToolError(f"{where}.topic must be a slug of a-z and _ (2-30 chars), e.g. {', '.join(EVENT_TOPICS[:6])}.")
    for k in _EV_URL:
        if k in out and (not isinstance(out[k], str) or not _HTTPS.match(out[k].strip())):
            raise ToolError(f"{where}.{k} must be an https:// link.")
    for k in _EV_UNIT:
        v = out.get(k)
        if v is not None and (isinstance(v, bool) or not isinstance(v, (int, float)) or not 0 <= v <= 1):
            raise ToolError(f"{where}.{k} must be a number 0..1.")
    for k in _EV_BOOL:
        if k in out and not isinstance(out[k], bool):
            raise ToolError(f"{where}.{k} must be true or false.")
    starts = _iso_offset(out["starts_at"], f"{where}.starts_at") if "starts_at" in out else None
    if "ends_at" in out:
        ends = _iso_offset(out["ends_at"], f"{where}.ends_at")
        if starts and ends < starts:
            raise ToolError(f"{where}.ends_at is before starts_at.")
    if "recurrence" in out:
        out["recurrence"] = _recurrence(out["recurrence"], f"{where}.recurrence")
    for k, lo, hi in (("lat", -90, 90), ("lng", -180, 180)):
        v = out.get(k)
        if v is not None and (isinstance(v, bool) or not isinstance(v, (int, float)) or not lo <= v <= hi):
            raise ToolError(f"{where}.{k} must be a number {lo}..{hi}.")
    if ("lat" in out) != ("lng" in out):
        raise ToolError(f"{where}: pass lat and lng together.")
    if "price" in out:
        v = out["price"]
        if isinstance(v, bool) or not isinstance(v, (int, float)) or v < 0:
            raise ToolError(f"{where}.price must be a non-negative number in main units.")
        out["price"] = int(round(v))
    if "currency" in out:
        if not isinstance(out["currency"], str) or not _CURRENCY.match(out["currency"].strip().upper()):
            raise ToolError(f"{where}.currency must be an ISO code like IDR, USD.")
        out["currency"] = out["currency"].strip().upper()
    if "age_min" in out and (out["age_min"] not in (18, 21) or isinstance(out["age_min"], bool)):
        raise ToolError(f"{where}.age_min must be 18 or 21.")
    if "tags" in out:
        tags = out["tags"]
        if not isinstance(tags, list) or any(t not in EVENT_TAGS for t in tags):
            raise ToolError(f"{where}.tags must be a list of: {', '.join(EVENT_TAGS)}.")
        out["tags"] = list(dict.fromkeys(tags))
    if out.get("booking") == "ticket" and not partial and not out.get("ticket_url"):
        raise ToolError(f"{where}: booking ticket needs ticket_url.")
    if out.get("photo_url") and out.get("photo_reuse") is not False and not out.get("photo_credit"):
        raise ToolError(f"{where}: photo_url needs photo_credit (who took it / whose page) and photo_source_url; "
                        "if the source does not allow reuse, send photo_reuse=false and only the link.")
    bad = _deals.sensitive_findings(out)
    if bad:
        raise ToolError(f"Refused ({where}): " + "; ".join(bad))
    return out


@_base.mcp.tool()
async def events_upsert(events: list[dict]) -> dict:
    """Add or refresh events in Афиша (wave 7): a daily curated feed for the members of a home (and for a search's areas
    before the deal). Up to 50 events per call. The CRM dedupes across sources (same country, similar title, start ±60 min,
    same place or ≤ 300 m → merged: empty fields filled, the better photo kept, the source added) and ranks them per member.

    DAILY SWEEP (once a day, e.g. in the morning run), sources in this order:
    1. Organizer / venue / ticket pages from the pack's events.yaml `sources:` that have `events_url` or `read`
       (wave 9): event_source_read(events_url or url) — one page per call, read-only, robots.txt + noindex honoured,
       ≤ 1 request/s per host, 6 h cache. JSON-LD gives the exact date, time, line-up, price and ticket link: these
       pages WIN over chat posts for date/time/line-up (when a chat post and the organizer's page disagree, the page is
       right). Upsert from its `suggested` dict (add country, about_ru, category, topic, tags); open `links` one by one
       only for events you will actually add.
    2. Telegram chats/channels flagged `events: true` in the region pack (useful.yaml items, sources.yaml telegram
       entries; region_doc(<country>, "useful.yaml")). READ ONLY with tg_history: only chats the hunter's account is
       already in or public channels readable without joining. Never join, never post, never react. Good for what has
       no page: house parties, meetups, one-off nights; confirm the time on the organizer's page when there is one.
    3. The rest of events.yaml `sources:` (venues, Instagram/Facebook pages, sites without events_url) and the places
       layer: base places with recurring events (e.g. the Uluwatu temple kecak at sunset), the members' Google-list
       places. Read as LINKS with attribution (source_url + source_name), one page at a time; never bulk-scrape or copy
       a third-party catalog/afisha site.
    Taste: event_feedback_get ("Как было?" — attended + rating) is the strongest signal; look at it before choosing.
    Extract per event the fields below; skip ads and scams, paid promos without a date or a place, MLM/timeshare pitches,
    and anything more than 60 min on a scooter from the home (or the search's areas before the deal). Recurring nights
    ("every Monday") only when a source shows them (the venue's own post/page, several recent posts); never invent a
    schedule. Dedupe your own batch before sending. Re-send an event when it changes (cancelled → status "cancelled").

    AUDIENCE: the members are young (≈20–30). Tag honestly, the CRM scores youth fit from tags, time and price and never
    hides anything: older/tour formats get dinner_show, hotel_lobby, ballroom, bus_tour, buffet_evening, timeshare,
    tour_group, seniors; young formats dj, sunset, festival, rooftop, beach_club, meetup, creative, young_crowd, live;
    alcohol promos get alcohol_promo (never recommended to members who opted out of nightlife).

    PHOTOS — LINK, DON'T STORE (wave 9): prefer the organizer's/venue's own recent photos (≤ 6 months) of the real
    event or place with real people; no stock, no clip-art, no random users' photos. A designed poster is fine when it
    is the organizer's own and its text covers < 45% (normal for parties), but a passing real atmosphere photo wins.
    - A public https image on the organizer's/venue's own page (JSON-LD image, og:image — event_source_read puts it in
      `suggested`): run event_photo_check(url), skip ok=false, and send photo_url = that image URL + photo_score +
      photo_credit (organizer/site) + photo_source_url (the page). Nothing is copied: the Mini App shows it through the
      Worker's image proxy (SSRF-checked, short edge cache, viewers' IPs hidden from the site).
    - STALE photos: events_get shows photo.stale = true + photo.fail (404 | refused | not_image | too_big | blocked)
      when the remote image broke. In the next sweep re-read the page and send the new photo_url (event_set or
      events_upsert; a new URL clears the mark). fail "refused" = hotlink protection: upload the file with
      event_photo_upload ONLY when it is the organizer's own promo image for this event; otherwise leave no photo.
    - Telegram-only photos (no public URL): tg_post_media on hunt-telegram (read only: all photos of the post/album),
      rank with event_photo_pick, upsert the event first, then event_photo_upload(event_id, path, credit, source_url)
      (quality gate + resize inside; stored in KV). Not for photos that have a public https URL.
    Always keep photo_credit and photo_source_url. When the source does not allow reuse (not the organizer's own
    material, no licence), send photo_reuse=false and the CRM keeps only the link (the app falls back to the place photo
    or a styled category card).

    Event fields (see core/API.md): country, city?, area?, title, title_en?, about_ru (one human line in Russian),
    about_en?, category (culture | nature | sport | dance | music | food | workshop | party | wellness | kids | other |
    bar | club | beach_club | social_sport | meetup | quiz), topic? (slug, e.g. fire_show, kecak, sea, snorkel, surf,
    yoga, market, temple, festival, dj, sunset_session, live_music, padel, run_club, quiz, karaoke, open_mic,
    language_exchange — it picks the photo effect), starts_at / ends_at (local ISO with offset, 2026-11-21T18:00:00+08:00;
    one-off events need starts_at), recurrence? ({freq: daily|weekly|monthly|seasonal, time: "HH:MM", end?, weekdays?:
    [1..7, 1 = Mon], day?, nth?: 1..4|-1, months?, from?, until?}), place_name? / place_id? (pack places.yaml id) /
    lat+lng? / map_url?, price_kind? (free | paid | on_site | unknown) + price? (main units) + currency? + price_note?,
    entry? (free | fee | min_spend | guest_list), lang? of the event (ru | en | id | mixed | none = no words, e.g. shows),
    booking? (none | message | ticket + ticket_url), organizer_name?, organizer_channel? (telegram | whatsapp | instagram
    | facebook | email | phone | web), organizer_address?, organizer_contact_id?, organizer_lang?, source_kind (telegram
    | instagram | facebook | web | place | pack | user), source_url (the message/post link), source_name?, source_rep?
    (0..1), photo_url?, photo_credit?, photo_source_url?, photo_score?, photo_reuse?, age_min? (18 | 21), dress_code?,
    vibe? (chill | party | sport | meet), crowd? (expats | locals | mixed), beginner?, outdoor?, sea? (needs calm sea),
    tags?, quality? (0..1 your hint), status? (active | cancelled | hidden), search_id? (the search you collected it for).
    Passport/ID/card numbers are refused locally.

    Returns {created, updated, merged, skipped: [{i, reason: no_date|no_place|bad_category|past|sensitive}], ids}."""
    if not isinstance(events, list) or not events:
        raise ToolError("events must be a non-empty list of events.")
    if len(events) > EVENTS_MAX:
        raise ToolError(f"At most {EVENTS_MAX} events per call; split the batch.")
    batch = [validate_event(ev, f"events[{i}]") for i, ev in enumerate(events)]
    return await _base.api("POST", "/api/events", body=batch)


@_base.mcp.tool()
async def events_get(
    country: str,
    city: str | None = None,
    search_id: str | None = None,
    from_date: str | None = None,
    to_date: str | None = None,
    status: str | None = None,
    q: str | None = None,
) -> dict:
    """Events in Афиша for a country (city: sub-pack slug). Check before a sweep what is already there (to update rather
    than duplicate) and after it what the members will see. Returns {events: [Event + {id, sources, photo, effect,
    created_by, created_at, updated_at}]}; with search_id also {occurrences: [...]} ranked for that search's members
    (taste, youth fit, distance, calendar, sea/weather, diversity). photo = {url, credit, source_url, score, stored,
    stale?, fail?}: stale = true (fail 404 | refused | not_image | too_big | blocked) means the linked remote image broke;
    refresh it in the sweep (see events_upsert, PHOTOS).

    Args:
        from_date / to_date: YYYY-MM-DD (local days).
        status: active | cancelled | hidden.
        q: free-text search in titles, places and organizers."""
    for k, v in (("from_date", from_date), ("to_date", to_date)):
        if v and not _deals._DATE.match(v):
            raise ToolError(f"{k} must be YYYY-MM-DD.")
    if status is not None and status not in EVENT_STATUS:
        raise ToolError(f"status must be one of {', '.join(EVENT_STATUS)}.")
    params = {"country": country.strip().lower(), "city": (city or "").strip().lower() or None, "search_id": search_id,
              "from": from_date, "to": to_date, "status": status, "q": q}
    return await _base.api("GET", "/api/events", params=params)


@_base.mcp.tool()
async def event_set(event_id: str, fields: dict) -> dict:
    """Change an event: fix a field, add the better photo, mark it cancelled or hidden (status), attach the organizer
    contact (organizer_contact_id from contact_upsert). fields = any Event fields of events_upsert (same vocabularies;
    omitted fields keep their values). Returns {event}."""
    if not isinstance(fields, dict) or not fields:
        raise ToolError("fields must be a non-empty object of Event fields.")
    body = validate_event(fields, "fields", partial=True)
    if not body:
        raise ToolError("fields has nothing to change.")
    return await _base.api("PUT", f"/api/events/{_base._q(event_id)}", body=body)


@_base.mcp.tool()
async def event_bookings_get(search_id: str | None = None, status: str | None = None) -> dict:
    """Event bookings ("Записаться" in the Mini App). Returns {bookings: [{id, event_id, occ, starts_at, search_id, title,
    organizer: {name, channel, address, lang, contact_id}, who: [{user_id, name}], guests, kind: join|guest_list|table|slot,
    note, status: requested|drafted|asked|booked|declined|cancelled|attended, draft_id, requested_by, created_at,
    updated_at}]}.

    Flow: a member presses Записаться → digest event event_book {booking_id, event_id, title, occ, starts_at, who, guests,
    kind, note} → event_book_draft (approval draft to the organizer) → after the human approved it, send final_text with
    the channel tool and draft_mark(sent) (booking → asked) → read the organizer's reply → event_booking_set(booked |
    declined). event_book_cancel {booking_id, title} in the digest: the member withdrew; if you already asked the organizer,
    draft a short cancellation the same way. event_want {event_id, title, occ, name}: a member wants to go, the others got
    one DM; nothing to do unless they ask you. Booking needs no message when the event has booking none: just mark it."""
    if status is not None and status not in BOOKING_STATUS:
        raise ToolError(f"status must be one of {', '.join(BOOKING_STATUS)}.")
    return await _base.api("GET", "/api/event-bookings", params={"search_id": search_id, "status": status})


@_base.mcp.tool()
async def event_book_draft(
    booking_id: str,
    text: str | None = None,
    lang: str | None = None,
    channel: str | None = None,
    address: str | None = None,
    contact_id: str | None = None,
    reason: str | None = None,
) -> dict:
    """Draft the message to the organizer for a booking (digest event event_book). It becomes a normal approval draft
    (kind event_book): the humans approve or edit it in Telegram, then drafts_ready → send final_text with the channel
    tool → draft_mark(sent), and the booking becomes "asked".

    Write like hunt-outreach: the organizer's language (read their posts/messages first), short and human, who and how
    many (names from the booking, + guests), the date/time, ask whether there is space / a guest list / a table or a
    padel slot. NEVER pay, never promise or arrange payment, never send card or ID data: payment is always by the humans
    on site ("оплата на месте, сами"). Respect the channel's pacing and quiet hours.

    Args:
        text: your own message; without it the CRM writes one from its template in lang.
        lang: the organizer's language (2 letters); the CRM template exists for en | ru | id.
        channel / address / contact_id: override the organizer's channel (telegram | whatsapp | instagram | facebook |
            email | phone) and address, or link a contact; default = the event's organizer.
        reason: one line for the approver ("guest list for 3 on Friday").
    Returns {draft, booking}."""
    if lang is not None and not re.match(r"^[a-z]{2}$", lang):
        raise ToolError("lang must be a 2-letter language code (en, ru, id …).")
    if not text and lang is not None and lang not in EVENT_TEMPLATE_LANGS:
        raise ToolError(f"The CRM template exists only for {', '.join(EVENT_TEMPLATE_LANGS)}; write text yourself for {lang}.")
    if channel is not None and channel not in EVENT_ORG_CHANNELS[:-1]:
        raise ToolError(f"channel must be one of {', '.join(EVENT_ORG_CHANNELS[:-1])}.")
    if text is not None and not text.strip():
        raise ToolError("text is empty.")
    bad = _deals.sensitive_findings({"text": text, "reason": reason, "address": address})
    if bad:
        raise ToolError("Refused: " + "; ".join(bad))
    body = _base._clean({"text": text.strip() if text else None, "lang": lang, "channel": channel, "address": address,
                   "contact_id": contact_id, "reason": reason})
    return await _base.api("POST", f"/api/event-bookings/{_base._q(booking_id)}/draft", body=body)


@_base.mcp.tool()
async def event_booking_set(booking_id: str, status: str, note: str | None = None) -> dict:
    """Record the booking outcome after the organizer replied: booked (space confirmed: shows in the home Plan, members
    get a reminder 2 h before), declined (full / no guest list), cancelled (the members withdrew and the organizer knows),
    attended (they went; after the date), asked (you sent the request outside event_book_draft). note: one line for the
    members ("guest list under Alex, until 23:00", "pay at the door"). Payments are always by the humans. Returns {booking}."""
    if status not in BOOKING_SET_STATUS:
        raise ToolError(f"status must be one of {', '.join(BOOKING_SET_STATUS)}.")
    if note:
        bad = _deals.sensitive_findings({"note": note})
        if bad:
            raise ToolError("Refused: " + "; ".join(bad))
    return await _base.api("PUT", f"/api/event-bookings/{_base._q(booking_id)}", body=_base._clean({"status": status, "note": note}))
