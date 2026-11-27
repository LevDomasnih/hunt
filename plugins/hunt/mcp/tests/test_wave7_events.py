"""Wave 7 · Афиша tools (events_upsert, events_get, event_set, event_bookings_get, event_book_draft, event_booking_set)
against a mocked CRM, the local photo quality gate (event_photo_check) on synthetic Pillow images, and the region packs'
events.yaml / `events: true` flags. No network."""
from _regions import GENERIC, real_regions
import asyncio
import json
import random
import re
from pathlib import Path

import httpx
import pytest
import yaml

from huntcore import base, event_photos, events as events_mod
from huntcore.base import ToolError

PIL = pytest.importorskip("PIL")
from PIL import Image, ImageDraw, ImageFilter, ImageFont  # noqa: E402

URL = "https://crm.test"
TOKEN = "hunt_test_token"
ROOT = Path(__file__).resolve().parents[4]
REGIONS = real_regions()
SHADERS = ROOT / "design" / "shaders"
if not SHADERS.is_dir():  # the open repository ships only the built shaders
    SHADERS = SHADERS.parents[1] / "crm" / "public" / "fx"
KNOWN_SHADERS = {"embers", "caustics", "bokeh", "foam", "mist", "rays", "droplets", "steam", "smoke", "grain", "confetti",
                 "stars", "fireflies", "neon", "floodlight", "none"}


def run(coro):
    return asyncio.run(coro)


class FakeNet:
    """Routes requests by (METHOD, path) or (METHOD, host, path); records every request."""

    def __init__(self):
        self.requests: list[httpx.Request] = []
        self.routes = {}

    def on(self, method, path, fn_or_data, status=200):
        self.routes[(method, path)] = (fn_or_data, status)

    def __call__(self, req: httpx.Request) -> httpx.Response:
        self.requests.append(req)
        key = (req.method, req.url.path)
        if key not in self.routes:
            return httpx.Response(404, json={"error": "not_found", "message": f"{req.method} {req.url.path}"})
        h, status = self.routes[key]
        data = h(req) if callable(h) else h
        return data if isinstance(data, httpx.Response) else httpx.Response(status, json=data)

    def last(self, method, path):
        hits = [r for r in self.requests if r.method == method and r.url.path == path]
        assert hits, f"no request {method} {path}"
        return hits[-1]


def body(req):
    return json.loads(req.content)


@pytest.fixture
def net(monkeypatch, isolated):
    fake = FakeNet()
    monkeypatch.setattr(base, "_TRANSPORT", httpx.MockTransport(fake))
    base.update_config(lambda c: c.__setitem__("api_url", URL))
    isolated.set_password("hunt", URL, TOKEN)
    return fake


def kecak(**kw):
    ev = {"country": "Bali", "city": "Bukit", "title": "Kecak & Fire Dance", "about_ru": "Кечак на закате над океаном",
          "category": "culture", "topic": "kecak", "recurrence": {"freq": "daily", "time": "18:00", "end": "19:00"},
          "place_name": "Uluwatu Temple", "place_id": "trip-uluwatu-temple", "lat": -8.82937, "lng": 115.08434,
          "price_kind": "paid", "price": 150000, "currency": "idr", "lang": "none", "booking": "none",
          "source_kind": "place", "source_url": "https://www.openstreetmap.org/way/707659668", "tags": ["sunset"],
          "outdoor": True}
    ev.update(kw)
    return ev


# ---------------------------------------------------------------- tools → HTTP

def test_events_upsert_posts_a_cleaned_batch(net):
    net.on("POST", "/api/events", lambda r: {"created": len(body(r)), "updated": 0, "merged": 0, "skipped": [],
                                              "ids": [f"ev_{i}" for i in range(len(body(r)))]})
    party = {"country": "bali", "title": "Sunset session", "about_ru": "Диджей на закате", "category": "beach_club",
             "topic": "sunset_session", "starts_at": "2026-11-22T16:00:00+08:00", "ends_at": "2026-11-22T22:00+08:00",
             "place_name": "La Brisa", "source_kind": "instagram", "source_url": "https://www.instagram.com/p/abc/",
             "photo_url": "https://cdn.example.com/a.jpg", "photo_credit": "La Brisa", "photo_source_url": "https://www.instagram.com/p/abc/",
             "photo_score": 0.8, "entry": "free", "age_min": 18, "vibe": "party", "crowd": "mixed", "tags": ["dj", "sunset", "dj"],
             "search_id": "s_1"}
    out = run(events_mod.events_upsert([kecak(), party]))
    assert out["created"] == 2 and out["ids"] == ["ev_0", "ev_1"]
    req = net.last("POST", "/api/events")
    assert req.headers["authorization"] == f"Bearer {TOKEN}"
    sent = body(req)
    assert isinstance(sent, list) and len(sent) == 2
    assert sent[0]["country"] == "bali" and sent[0]["city"] == "bukit" and sent[0]["currency"] == "IDR"
    assert sent[0]["recurrence"] == {"freq": "daily", "time": "18:00", "end": "19:00"}
    assert sent[1]["tags"] == ["dj", "sunset"]


def test_events_upsert_validation(net):
    n = len(net.requests)
    cases = [
        ([], "non-empty"),
        ([kecak()] * 51, "At most 50"),
        (["x"], "object"),
        ([kecak(category="casino")], "category"),
        ([kecak(lang="fr")], "lang"),
        ([kecak(price_kind="cheap")], "price_kind"),
        ([kecak(entry="vip")], "entry"),
        ([kecak(booking="call")], "booking"),
        ([kecak(vibe="wild")], "vibe"),
        ([kecak(crowd="tourists")], "crowd"),
        ([kecak(source_kind="tiktok")], "source_kind"),
        ([kecak(organizer_channel="line")], "organizer_channel"),
        ([kecak(status="deleted")], "status"),
        ([kecak(topic="Fire Show")], "topic"),
        ([kecak(tags=["vip"])], "tags"),
        ([kecak(age_min=16)], "age_min"),
        ([kecak(source_url="http://example.com/x")], "https"),
        ([kecak(ticket_url="javascript:alert(1)")], "https"),
        ([kecak(starts_at="2026-11-21 18:00")], "offset"),
        ([kecak(starts_at="2026-11-21T18:00:00Z")], "offset"),
        ([kecak(starts_at="2026-11-21T18:00:00+08:00", ends_at="2026-11-21T17:00:00+08:00")], "before starts_at"),
        ([kecak(recurrence={"freq": "weekly", "time": "21:00"})], "weekdays"),
        ([kecak(recurrence={"freq": "weekly", "time": "25:00", "weekdays": [1]})], "HH:MM"),
        ([kecak(recurrence={"freq": "weekly", "time": "21:00", "weekdays": [0]})], "1..7"),
        ([kecak(recurrence={"freq": "monthly", "time": "21:00"})], "day or nth"),
        ([kecak(recurrence={"freq": "monthly", "time": "21:00", "nth": 1})], "nth needs"),
        ([kecak(recurrence={"freq": "seasonal", "time": "21:00"})], "months"),
        ([kecak(recurrence={"freq": "daily"})], "time is required"),
        ([kecak(recurrence={"freq": "daily", "time": "18:00", "every": 2})], "unknown keys"),
        ([kecak(lat=-8.8, lng=None)], "together"),
        ([kecak(lat=123, lng=115)], "lat"),
        ([kecak(price=-5)], "price"),
        ([kecak(currency="rupiah")], "currency"),
        ([kecak(photo_score=1.5)], "0..1"),
        ([kecak(outdoor="yes")], "true or false"),
        ([kecak(booking="ticket")], "ticket_url"),
        ([kecak(photo_url="https://cdn.example.com/a.jpg")], "photo_credit"),
        ([kecak(about_ru=None)], "missing about_ru"),
        ([kecak(weird=1)], "unknown fields"),
        ([kecak(organizer_address="passport 4510123456")], "Refused"),
        ([kecak(price_note="pay to card 4111 1111 1111 1111")], "Refused"),
    ]
    for events, msg in cases:
        with pytest.raises(ToolError, match=msg):
            run(events_mod.events_upsert(events))
    assert len(net.requests) == n, "refused calls must not reach the CRM"


def test_events_upsert_photo_without_reuse_and_errors_name_the_item(net):
    net.on("POST", "/api/events", {"created": 1, "updated": 0, "merged": 0, "skipped": [], "ids": ["ev_1"]})
    run(events_mod.events_upsert([kecak(photo_url="https://cdn.example.com/a.jpg", photo_reuse=False)]))
    with pytest.raises(ToolError, match=r"events\[1\]\.category"):
        run(events_mod.events_upsert([kecak(), kecak(category="nope")]))


def test_events_get_params(net):
    net.on("GET", "/api/events", {"events": [{"id": "ev_1"}], "occurrences": []})
    out = run(events_mod.events_get(" Bali ", city="Bukit", search_id="s_1", from_date="2026-11-20", to_date="2026-11-27",
                            status="active", q="kecak"))
    assert out["events"][0]["id"] == "ev_1"
    p = net.last("GET", "/api/events").url.params
    assert (p["country"], p["city"], p["search_id"], p["from"], p["to"], p["status"], p["q"]) == \
        ("bali", "bukit", "s_1", "2026-11-20", "2026-11-27", "active", "kecak")
    run(events_mod.events_get("kz"))
    p = net.last("GET", "/api/events").url.params
    assert dict(p) == {"country": "kz"}
    with pytest.raises(ToolError, match="YYYY-MM-DD"):
        run(events_mod.events_get("bali", from_date="20.11.2026"))
    with pytest.raises(ToolError, match="status"):
        run(events_mod.events_get("bali", status="past"))


def test_event_set(net):
    net.on("PUT", "/api/events/ev_7", lambda r: {"event": {"id": "ev_7", **body(r)}})
    out = run(events_mod.event_set("ev_7", {"status": "cancelled", "photo_score": 0.7, "currency": "usd"}))
    assert out["event"]["status"] == "cancelled"
    assert body(net.last("PUT", "/api/events/ev_7")) == {"status": "cancelled", "photo_score": 0.7, "currency": "USD"}
    with pytest.raises(ToolError, match="non-empty"):
        run(events_mod.event_set("ev_7", {}))
    with pytest.raises(ToolError, match="category"):
        run(events_mod.event_set("ev_7", {"category": "casino"}))
    with pytest.raises(ToolError, match="Invalid id"):
        run(events_mod.event_set("../x", {"status": "hidden"}))


def test_event_bookings_get(net):
    net.on("GET", "/api/event-bookings", {"bookings": [{"id": "eb_1", "status": "requested"}]})
    assert run(events_mod.event_bookings_get(search_id="s_1", status="requested"))["bookings"][0]["id"] == "eb_1"
    p = net.last("GET", "/api/event-bookings").url.params
    assert p["search_id"] == "s_1" and p["status"] == "requested"
    run(events_mod.event_bookings_get())
    assert dict(net.last("GET", "/api/event-bookings").url.params) == {}
    with pytest.raises(ToolError, match="status"):
        run(events_mod.event_bookings_get(status="paid"))


def test_event_book_draft(net):
    net.on("POST", "/api/event-bookings/eb_1/draft",
           lambda r: {"draft": {"id": "d_1", "kind": "event_book"}, "booking": {"id": "eb_1", "status": "drafted"}}, 201)
    out = run(events_mod.event_book_draft("eb_1", lang="id", reason="guest list for 3"))
    assert out["booking"]["status"] == "drafted"
    assert body(net.last("POST", "/api/event-bookings/eb_1/draft")) == {"lang": "id", "reason": "guest list for 3"}
    run(events_mod.event_book_draft("eb_1", text="  Hi! Is there space for 3 on Friday?  ", lang="en", channel="instagram",
                            address="labrisabali"))
    assert body(net.last("POST", "/api/event-bookings/eb_1/draft")) == {
        "text": "Hi! Is there space for 3 on Friday?", "lang": "en", "channel": "instagram", "address": "labrisabali"}
    run(events_mod.event_book_draft("eb_1", text="Bonjour, il reste de la place ?", lang="fr"))
    n = len(net.requests)
    with pytest.raises(ToolError, match="template"):
        run(events_mod.event_book_draft("eb_1", lang="fr"))
    with pytest.raises(ToolError, match="2-letter"):
        run(events_mod.event_book_draft("eb_1", lang="english"))
    with pytest.raises(ToolError, match="channel"):
        run(events_mod.event_book_draft("eb_1", channel="web"))
    with pytest.raises(ToolError, match="empty"):
        run(events_mod.event_book_draft("eb_1", text="   "))
    with pytest.raises(ToolError, match="Refused"):
        run(events_mod.event_book_draft("eb_1", text="my card 4111 1111 1111 1111"))
    assert len(net.requests) == n


def test_event_booking_set(net):
    net.on("PUT", "/api/event-bookings/eb_1", lambda r: {"booking": {"id": "eb_1", **body(r)}})
    assert run(events_mod.event_booking_set("eb_1", "booked", note="guest list under Alex"))["booking"]["status"] == "booked"
    assert body(net.last("PUT", "/api/event-bookings/eb_1")) == {"status": "booked", "note": "guest list under Alex"}
    run(events_mod.event_booking_set("eb_1", "declined"))
    assert body(net.last("PUT", "/api/event-bookings/eb_1")) == {"status": "declined"}
    for bad in ("drafted", "requested", "paid"):
        with pytest.raises(ToolError, match="status"):
            run(events_mod.event_booking_set("eb_1", bad))
    with pytest.raises(ToolError, match="Refused"):
        run(events_mod.event_booking_set("eb_1", "booked", note="passport 4510123456"))


def test_docstrings_teach_the_rules():
    doc = events_mod.events_upsert.__doc__ or ""
    for s in ("READ ONLY", "Never join", "never post", "60 min", "never invent", "≤ 6 months", "event_photo_check",
              "photo_reuse=false", "bulk-scrape", "young"):
        assert s in doc, s
    d = events_mod.event_book_draft.__doc__ or ""
    assert "NEVER pay" in d and "on site" in d and "language" in d
    assert "event_book_cancel" in (events_mod.event_bookings_get.__doc__ or "") and "event_want" in (events_mod.event_bookings_get.__doc__ or "")
    assert "HEURISTIC" in (event_photos.event_photo_check.__doc__ or "")


# ---------------------------------------------------------------- photo quality gate

def scene(w=1600, h=1000, seed=1):
    """A busy, sharp synthetic 'photo': many overlapping shapes in varied mid tones."""
    rnd = random.Random(seed)
    im = Image.new("RGB", (w, h), (120, 140, 150))
    d = ImageDraw.Draw(im)
    for _ in range(500):
        x, y = rnd.randrange(w), rnd.randrange(h)
        r = rnd.randrange(8, 120)
        c = tuple(rnd.randrange(40, 230) for _ in range(3))
        (d.ellipse if rnd.random() < 0.5 else d.rectangle)([x - r, y - r, x + r, y + r], fill=c)
    return im


def save(im, tmp_path, name):
    p = tmp_path / name
    im.save(p, quality=92)
    return str(p)


def test_photo_sharp_scene_passes(tmp_path):
    out = run(event_photos.event_photo_check(save(scene(), tmp_path, "sharp.jpg")))
    assert out["ok"], out["reasons"]
    assert out["short_side"] == 1000 and out["width"] == 1600 and out["score"] >= 0.5
    assert out["sharpness"] >= event_photos.PHOTO_SHARP_MIN and out["text_area"] < 0.2
    c = out["crop"]
    assert c["w"] * 9 == pytest.approx(c["h"] * 16, abs=16) and c["x"] >= 0 and c["y"] >= 0
    assert c["x"] + c["w"] <= 1600 and c["y"] + c["h"] <= 1000
    c3 = out["crops"]["3:2"]
    assert c3["w"] * 2 == pytest.approx(c3["h"] * 3, abs=3)


def test_photo_blurred_fails(tmp_path):
    out = run(event_photos.event_photo_check(save(scene().filter(ImageFilter.GaussianBlur(8)), tmp_path, "blur.jpg")))
    assert not out["ok"] and out["sharpness"] < event_photos.PHOTO_SHARP_MIN
    assert any("blurry" in r for r in out["reasons"]) and out["score"] <= 0.49


def test_photo_dark_fails(tmp_path):
    dark = scene().point(lambda v: v // 10)
    out = run(event_photos.event_photo_check(save(dark, tmp_path, "dark.jpg")))
    assert not out["ok"] and any("too dark" in r for r in out["reasons"])
    assert out["exposure"]["mean"] < event_photos.PHOTO_MEAN_MIN


def test_photo_blown_fails(tmp_path):
    out = run(event_photos.event_photo_check(save(Image.new("RGB", (1600, 1000), (252, 252, 252)), tmp_path, "white.png")))
    assert not out["ok"] and any("blown" in r for r in out["reasons"])


def test_photo_text_heavy_flyer_fails(tmp_path):
    im = Image.new("RGB", (1600, 1000), (250, 235, 40))
    d = ImageDraw.Draw(im)
    try:
        font = ImageFont.load_default(size=40)
    except TypeError:  # Pillow < 10.1: fixed-size bitmap font, scale the flyer instead
        font = None
    for y in range(20, 950, 55):
        d.text((30, y), "PARTY FRIDAY 22:00 DJ LINEUP FREE ENTRY BEFORE 23 GUEST LIST", fill=(10, 10, 10), font=font)
    out = run(event_photos.event_photo_check(save(im, tmp_path, "flyer.png")))
    assert out["text_area"] >= 0.2 and not out["ok"]
    assert any("text-heavy" in r for r in out["reasons"])


def test_photo_small_fails(tmp_path):
    out = run(event_photos.event_photo_check(save(scene(800, 500), tmp_path, "small.jpg")))
    assert not out["ok"] and out["short_side"] == 500 and any("too small" in r for r in out["reasons"])


def test_photo_crop_follows_the_subject(tmp_path):
    im = Image.new("RGB", (2400, 1000), (128, 140, 150))
    im.paste(scene(500, 1000, seed=3), (1850, 0))  # all the detail on the right
    out = run(event_photos.event_photo_check(save(im, tmp_path, "right.jpg")))
    c = out["crop"]
    assert c["x"] + c["w"] / 2 > 1200, c


def test_photo_url_download(net, tmp_path):
    p = save(scene(), tmp_path, "net.jpg")
    data = Path(p).read_bytes()
    net.on("GET", "/img/a.jpg", httpx.Response(200, content=data, headers={"content-type": "image/jpeg"}))
    net.on("GET", "/post", httpx.Response(200, content=b"<html>", headers={"content-type": "text/html"}))
    out = run(event_photos.event_photo_check("https://cdn.example.com/img/a.jpg"))
    assert out["ok"] and out["bytes"] == len(data) and out["source"] == "https://cdn.example.com/img/a.jpg"
    with pytest.raises(ToolError, match="Not an image"):
        run(event_photos.event_photo_check("https://cdn.example.com/post"))
    for bad in ("http://cdn.example.com/a.jpg", "https://localhost/a.jpg", "https://192.168.1.2/a.jpg", "ftp://x.y/a.jpg"):
        with pytest.raises(ToolError, match="https"):
            run(event_photos.event_photo_check(bad))
    with pytest.raises(ToolError, match="No such file"):
        run(event_photos.event_photo_check(str(tmp_path / "missing.jpg")))
    (tmp_path / "junk.jpg").write_bytes(b"not an image")
    with pytest.raises(ToolError, match="Cannot read"):
        run(event_photos.event_photo_check(str(tmp_path / "junk.jpg")))


def test_photo_size_cap(net, monkeypatch):
    monkeypatch.setattr(event_photos, "PHOTO_MAX_BYTES", 1000)
    net.on("GET", "/big.jpg", httpx.Response(200, content=b"x" * 5000, headers={"content-type": "image/jpeg"}))
    with pytest.raises(ToolError, match="larger"):
        run(event_photos.event_photo_check("https://cdn.example.com/big.jpg"))


def flyer(w=1600, h=1000, lines=18, bg=(250, 235, 40)):
    im = Image.new("RGB", (w, h), bg)
    d = ImageDraw.Draw(im)
    try:
        font = ImageFont.load_default(size=40)
    except TypeError:
        font = None
    for y in range(20, 20 + 55 * lines, 55):
        if y > h - 40:
            break
        d.text((30, y), "PARTY FRIDAY 22:00 DJ LINEUP FREE ENTRY BEFORE 23 GUEST LIST", fill=(10, 10, 10), font=font)
    return im


def poster(w=1000, h=1250):
    """A designed poster: a busy picture with a title band (text well under 45%)."""
    im = scene(w, h, seed=7)
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, w, 260], fill=(250, 235, 40))
    try:
        font = ImageFont.load_default(size=44)
    except TypeError:
        font = None
    for y in (30, 90, 150):
        d.text((30, y), "SUNSET PARTY SAT 21.11 DJ", fill=(10, 10, 10), font=font)
    return im


def test_photo_min_short_side_900(tmp_path):
    out = run(event_photos.event_photo_check(save(scene(1400, 900), tmp_path, "s900.jpg")))
    assert out["ok"] and out["kind"] == "photo", out["reasons"]
    out = run(event_photos.event_photo_check(save(scene(1300, 850), tmp_path, "s850.jpg")))
    assert not out["ok"] and any("< 900" in r for r in out["reasons"])


def test_poster_needs_organizer_own_and_little_text(tmp_path):
    p = save(flyer(), tmp_path, "flyer.png")
    out = run(event_photos.event_photo_check(p))
    assert out["kind"] == "poster" and not out["ok"] and any("organizer_own" in r for r in out["reasons"])
    out = run(event_photos.event_photo_check(p, organizer_own=True))
    assert not out["ok"] and out["text_area"] >= event_photos.POSTER_TEXT_MAX and any("max 45%" in r for r in out["reasons"])
    six = run(event_photos.event_photo_check(save(flyer(lines=6), tmp_path, "six.png"), organizer_own=True))
    assert six["ok"] and six["kind"] == "poster" and event_photos.PHOTO_TEXT_MAX <= six["text_area"] < event_photos.POSTER_TEXT_MAX
    q = save(poster(), tmp_path, "poster.jpg")
    out = run(event_photos.event_photo_check(q, organizer_own=True, kind="poster"))
    assert out["ok"] and out["kind"] == "poster" and 0.5 <= out["score"] <= event_photos.POSTER_FACTOR, out
    small = save(poster(560, 700), tmp_path, "poster_small.jpg")
    out = run(event_photos.event_photo_check(small, organizer_own=True, kind="poster"))
    assert not out["ok"] and any("< 700" in r for r in out["reasons"])
    blurred = save(poster().filter(ImageFilter.GaussianBlur(8)), tmp_path, "poster_blur.jpg")
    assert not run(event_photos.event_photo_check(blurred, organizer_own=True, kind="poster"))["ok"]
    with pytest.raises(ToolError, match="kind"):
        run(event_photos.event_photo_check(q, kind="banner"))


def test_pick_prefers_real_photos(tmp_path):
    ph = save(scene(1400, 950, seed=4), tmp_path, "atmos.jpg")
    po = save(flyer(lines=6), tmp_path, "poster.png")  # ~28% text: a passing organizer poster
    bad = save(scene().filter(ImageFilter.GaussianBlur(8)), tmp_path, "blur.jpg")
    out = run(event_photos.event_photo_pick([po, bad, ph], organizer_own=True))
    assert out["best"]["path"] == ph and out["best"]["kind"] == "photo"
    assert [r["path"] for r in out["ranked"]][-1] == bad
    out = run(event_photos.event_photo_pick([po, bad], organizer_own=True))
    assert out["best"]["kind"] == "poster"
    assert run(event_photos.event_photo_pick([bad, str(tmp_path / "nope.jpg")]))["best"] is None


def test_prepare_resizes_to_1600_jpeg(tmp_path):
    big = scene(3200, 2000)
    jpg = event_photos.prepare_event_photo(big)
    im = Image.open(__import__("io").BytesIO(jpg))
    assert im.format == "JPEG" and max(im.size) == 1600 and len(jpg) <= event_photos.EVENT_UPLOAD_MAX
    rgba = Image.new("RGBA", (800, 900), (10, 200, 30, 128))
    assert Image.open(__import__("io").BytesIO(event_photos.prepare_event_photo(rgba))).mode == "RGB"


def test_event_photo_upload_multipart_and_dry_run(net, tmp_path):
    p = save(scene(2400, 1500), tmp_path, "tg.jpg")
    net.on("POST", "/api/events/ev_abc123/photo", lambda r: httpx.Response(201, json={"event": {"id": "ev_abc123"}, "key": "e/ev_abc123/x"}))
    out = run(event_photos.event_photo_upload("ev_abc123", p, "Savaya Bali", "https://t.me/balichatparties/83340"))
    assert out["key"] == "e/ev_abc123/x"
    req = net.last("POST", "/api/events/ev_abc123/photo")
    assert req.headers["content-type"].startswith("multipart/form-data")
    raw = req.content
    assert b'name="credit"' in raw and b"Savaya Bali" in raw and b'name="source_url"' in raw and b'name="score"' in raw
    assert b'filename="event.jpg"' in raw and b"image/jpeg" in raw
    n = len(net.requests)
    d = run(event_photos.event_photo_upload("ev_abc123", p, "Savaya Bali", "https://t.me/balichatparties/83340", dry_run=True,
                                  out_path=str(tmp_path / "out" / "a.jpg")))
    assert d["dry_run"] and len(net.requests) == n and Path(d["out_path"]).is_file()
    assert max(Image.open(d["out_path"]).size) == 1600
    blur = save(scene().filter(ImageFilter.GaussianBlur(8)), tmp_path, "blur.jpg")
    for args, msg in (((blur, "X", "https://t.me/a/1"), "quality gate"), ((p, "", "https://t.me/a/1"), "credit"),
                      ((p, "X", "http://t.me/a/1"), "source_url"), ((p, "паспорт 4510 123456", "https://t.me/a/1"), "Refused")):
        with pytest.raises(ToolError, match=msg):
            run(event_photos.event_photo_upload("ev_abc123", *args))
    with pytest.raises(ToolError, match="event_id"):
        run(event_photos.event_photo_upload("../x", p, "X", "https://t.me/a/1"))
    assert len(net.requests) == n


def test_event_photo_fetch_og_image(net, tmp_path):
    img = Path(save(scene(1600, 1000), tmp_path, "og.jpg")).read_bytes()
    page = ('<html><head><meta property="og:title" content="Frost Moon Beach Party">'
            '<meta property="og:site_name" content="Sundays">'
            '<meta property="og:image" content="/img/frost.jpg"><meta name="twitter:image" content="http://cdn.example.com/x.jpg">'
            '</head></html>')
    net.on("GET", "/events/frost/", httpx.Response(200, text=page, headers={"content-type": "text/html; charset=utf-8"}))
    net.on("GET", "/img/frost.jpg", httpx.Response(200, content=img, headers={"content-type": "image/jpeg"}))
    out = run(event_photos.event_photo_fetch("https://www.example.com/events/frost/", str(tmp_path / "c")))
    assert out["title"] == "Frost Moon Beach Party" and out["found"] == 1  # the http:// twitter image is dropped
    f = out["files"][0]
    assert f["image_url"] == "https://www.example.com/img/frost.jpg" and f["check"]["ok"] and Path(f["path"]).is_file()
    # a redirect to a private address is refused hop by hop
    net.on("GET", "/go", httpx.Response(302, headers={"location": "https://127.0.0.1/admin"}))
    with pytest.raises(ToolError, match="public https"):
        run(event_photos.event_photo_fetch("https://www.example.com/go", str(tmp_path / "c")))
    for bad in ("http://www.example.com/", "https://10.0.0.5/", "https://localhost/x", "https://[::1]/", "https://169.254.169.254/latest"):
        with pytest.raises(ToolError, match="public https"):
            run(event_photos.event_photo_fetch(bad, str(tmp_path / "c")))
    with pytest.raises(ToolError, match="tg_post_media"):
        run(event_photos.event_photo_fetch("https://t.me/balichatparties/83340", str(tmp_path / "c")))


def test_public_host_rejects_private_ips(monkeypatch):
    monkeypatch.setattr(base, "_TRANSPORT", None)
    assert not event_photos._public_host("127.0.0.1") and not event_photos._public_host("100.64.1.1") and not event_photos._public_host("fd00::1")
    assert event_photos._public_host("8.8.8.8")


# ---------------------------------------------------------------- the real packs

def events_files():
    return sorted(REGIONS.glob("*/events.yaml")) + sorted(REGIONS.glob("*/*/events.yaml"))


def test_generic_events_yaml_exists():
    assert (GENERIC / "events.yaml").is_file()
    assert (REGIONS / "bali" / "events.yaml").is_file()


@pytest.mark.parametrize("path", events_files(), ids=lambda p: str(p.relative_to(REGIONS)))
def test_events_yaml_effects_and_sources(path):
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    assert set(data) <= {"effects", "sources", "party"}, set(data)
    for key, v in (data.get("effects") or {}).items():
        assert re.match(r"^[a-z_]{2,30}$", key), key
        shader = v["shader"] if isinstance(v, dict) else v
        assert shader in KNOWN_SHADERS, (key, shader)
        if isinstance(v, dict):
            assert set(v) <= {"shader", "mix"} and 0 <= v.get("mix", 1) <= 1
        if shader != "none":
            assert (SHADERS / f"{shader}.glsl").is_file(), shader
    ids = set()
    for s in data.get("sources") or []:
        assert re.match(r"^[a-z0-9-]+$", s["id"]) and s["id"] not in ids
        ids.add(s["id"])
        assert s["name"] and s["url"].startswith("https://")
        assert s["kind"] in {"venue", "instagram", "facebook", "web", "place", "ticket"}
        for t in s.get("topics") or []:
            assert re.match(r"^[a-z_]{2,30}$", t)
    for line in path.read_text(encoding="utf-8").splitlines():  # strict subset for copy-art.mjs
        if line.lstrip().startswith("- "):
            assert line.strip().startswith("- {") and line.rstrip().endswith("}"), line


def test_generic_effects_cover_the_contract_defaults():
    eff = yaml.safe_load((GENERIC / "events.yaml").read_text(encoding="utf-8"))["effects"]
    shader = lambda k: eff[k]["shader"] if isinstance(eff[k], dict) else eff[k]  # noqa: E731
    assert shader("kecak") == "embers" and shader("sea") == "caustics" and eff["sea"]["mix"] == 0.35
    assert shader("bar") == "neon" and shader("padel") == "floodlight" and shader("workshop") == "none"
    assert set(events_mod.EVENT_TOPICS) - {"sunset_session", "volleyball", "run_club", "quiz", "karaoke", "open_mic",
                                   "language_exchange", "dating"} <= set(eff)


def test_bali_kecak_is_a_verified_daily_source():
    src = {s["id"]: s for s in yaml.safe_load((REGIONS / "bali" / "events.yaml").read_text(encoding="utf-8"))["sources"]}
    k = src["uluwatu-temple-kecak"]
    assert "kecak" in k["topics"] and "sunset" in k["recurring"].lower() and k["kind"] == "place"
    for s in src.values():  # a source is either a verified schedule or says "(unverified" in its note
        assert s.get("recurring") or "(unverified" in (s.get("note") or ""), s["id"]


def test_useful_and_sources_events_flags_are_links():
    flagged = []
    for f in sorted(REGIONS.glob("*/useful.yaml")) + sorted(REGIONS.glob("*/*/useful.yaml")):
        for it in yaml.safe_load(f.read_text(encoding="utf-8"))["items"]:
            if "events" in it:
                assert it["events"] is True
                assert it["kind"] in {"telegram", "web"} and it["url"].startswith("https://")
                flagged.append(it["id"])
    for f in sorted(REGIONS.glob("*/sources.yaml")):
        for it in yaml.safe_load(f.read_text(encoding="utf-8")).get("telegram") or []:
            if "events" in it:
                assert it["events"] is True and re.match(r"^@[A-Za-z0-9_]{4,}$", it["handle"])
                flagged.append(it["handle"])
    assert "tg-balichat" in flagged
