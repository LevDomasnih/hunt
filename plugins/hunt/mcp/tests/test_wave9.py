"""Wave 9 · parties ("Своя тусовка"), "Как было?" feedback and organizer/venue pages as an event source.
Party tools and event_feedback_get against a mocked CRM; event_source_read on fixture HTML through a mocked transport
(robots.txt, noindex, JSON-LD @graph, og fallback, ics, cache, per-host throttle); the region packs' party blocks and
organizer sources. No network."""
import asyncio
import json
import re
from pathlib import Path

import httpx
import pytest
import yaml

import hunt_core as hc
from hunt_core import ToolError

URL = "https://crm.test"
TOKEN = "hunt_test_token"
ROOT = Path(__file__).resolve().parents[4]
REGIONS = ROOT / "plugins" / "hunt" / "regions"


def run(coro):
    return asyncio.run(coro)


class FakeNet:
    """Routes by (METHOD, host, path) first, then (METHOD, path); records every request."""

    def __init__(self):
        self.requests: list[httpx.Request] = []
        self.routes = {}

    def on(self, method, path, data, status=200, host=None):
        self.routes[(method, host, path)] = (data, status)

    def __call__(self, req: httpx.Request) -> httpx.Response:
        self.requests.append(req)
        hit = self.routes.get((req.method, req.url.host, req.url.path)) or self.routes.get((req.method, None, req.url.path))
        if hit is None:
            return httpx.Response(404, json={"error": "not_found", "message": f"{req.method} {req.url.path}"})
        data, status = hit
        data = data(req) if callable(data) else data
        return data if isinstance(data, httpx.Response) else httpx.Response(status, json=data)

    def hits(self, method, path, host=None):
        return [r for r in self.requests if r.method == method and r.url.path == path and (host is None or r.url.host == host)]

    def last(self, method, path):
        h = self.hits(method, path)
        assert h, f"no request {method} {path}"
        return h[-1]


def body(req):
    return json.loads(req.content)


@pytest.fixture
def net(monkeypatch, isolated):
    fake = FakeNet()
    monkeypatch.setattr(hc, "_TRANSPORT", httpx.MockTransport(fake))
    hc.update_config(lambda c: c.__setitem__("api_url", URL))
    isolated.set_password("hunt", URL, TOKEN)
    return fake


@pytest.fixture
def web(net, monkeypatch):
    """A mocked web for event_source_read: fresh throttle state, recorded sleeps, empty robots.txt by default."""
    sleeps: list[float] = []

    async def fake_sleep(s):
        sleeps.append(s)

    monkeypatch.setattr(hc, "_sleep", fake_sleep)
    monkeypatch.setattr(hc, "_host_last", {})
    monkeypatch.setattr(hc, "_host_interval", {})
    net.sleeps = sleeps
    net.on("GET", "/robots.txt", httpx.Response(200, text="User-agent: *\nAllow: /\n", headers={"content-type": "text/plain"}))
    return net


def page(html_text, headers=None):
    return httpx.Response(200, text=html_text, headers={"content-type": "text/html; charset=utf-8", **(headers or {})})


# ---------------------------------------------------------------- parties

def test_party_get_list_and_one(net):
    net.on("GET", "/api/parties", {"parties": [{"id": "pt_1", "search_id": "s_1"}]})
    net.on("GET", "/api/parties/pt_1", {"party": {"id": "pt_1", "search_id": "s_1"}, "guests": [], "items": [],
                                        "ratings": [], "recap": None, "rules": {"quiet_after": "22:00"}})
    assert run(hc.party_get("s_1"))["parties"][0]["id"] == "pt_1"
    assert net.last("GET", "/api/parties").url.params["search_id"] == "s_1"
    assert net.last("GET", "/api/parties").headers["authorization"] == f"Bearer {TOKEN}"
    assert run(hc.party_get("s_1", "pt_1"))["rules"]["quiet_after"] == "22:00"
    with pytest.raises(ToolError, match="belongs to search s_1"):
        run(hc.party_get("s_2", "pt_1"))
    with pytest.raises(ToolError, match="pt_"):
        run(hc.party_get("s_1", "ev_1"))


def test_party_set_create_and_update(net):
    net.on("POST", "/api/parties", lambda r: httpx.Response(201, json={"party": {"id": "pt_9", **body(r)}}))
    net.on("PUT", "/api/parties/pt_9", lambda r: {"party": {"id": "pt_9", **body(r)}})
    out = run(hc.party_set("s_1", {"title": "  Белая вечеринка у бассейна ", "starts_at": "2026-11-28T19:00:00+08:00",
                                   "ends_at": "2026-11-28T23:00:00+08:00", "theme": "Белая вечеринка", "vibe": "pool",
                                   "capacity": 25, "plus_one": True, "byob": True, "wifi": True, "dress_code": "white",
                                   "address": "Jl. Pantai Batu Bolong 1", "how_to": "Gate with a blue door", "note": None}))
    assert out["party"]["id"] == "pt_9"
    sent = body(net.last("POST", "/api/parties"))
    assert sent["search_id"] == "s_1" and sent["title"] == "Белая вечеринка у бассейна" and "note" not in sent
    assert sent["capacity"] == 25 and sent["vibe"] == "pool" and sent["wifi"] is True
    run(hc.party_set("s_1", {"status": "cancelled"}, party_id="pt_9"))
    assert body(net.last("PUT", "/api/parties/pt_9")) == {"status": "cancelled"}


@pytest.mark.parametrize("fields,party_id,msg", [
    ({"starts_at": "2026-11-28T19:00:00+08:00"}, None, "needs title"),
    ({"title": "Party"}, None, "needs starts_at"),
    ({"title": "Party", "starts_at": "2026-11-28T19:00:00"}, None, "offset"),
    ({"title": "Party", "starts_at": "2026-11-28 19:00"}, None, "offset"),
    ({"title": "Party", "starts_at": "2026-11-28T19:00:00+08:00", "ends_at": "2026-11-28T18:00:00+08:00"}, None, "after"),
    ({"title": "x" * 81, "starts_at": "2026-11-28T19:00:00+08:00"}, None, "80"),
    ({"capacity": 0}, "pt_1", "1..300"),
    ({"capacity": 301}, "pt_1", "1..300"),
    ({"capacity": True}, "pt_1", "1..300"),
    ({"capacity": 12.5}, "pt_1", "1..300"),
    ({"vibe": "rave"}, "pt_1", "vibe"),
    ({"status": "deleted"}, "pt_1", "status"),
    ({"plus_one": "yes"}, "pt_1", "true or false"),
    ({"guests": []}, "pt_1", "unknown keys"),
    ({"note": "passport A1234567 for the gate"}, "pt_1", "passport"),
    ({"note": "pay to card 4111 1111 1111 1111"}, "pt_1", "card"),
    ({}, "pt_1", "nothing to change"),
    ({"title": "ok"}, "party1", "pt_"),
])
def test_party_set_validation(net, fields, party_id, msg):
    with pytest.raises(ToolError, match=msg):
        run(hc.party_set("s_1", fields, party_id=party_id))
    assert not net.requests


def test_party_guests_get(net):
    net.on("GET", "/api/parties/pt_1/guests", {"guests": [{"id": "pg_1", "name": "Ann", "answer": "going", "plus_one": 1}],
                                               "counts": {"going": 1, "heads": 2}})
    assert run(hc.party_guests_get("pt_1"))["counts"]["heads"] == 2


def test_party_notice_draft(net):
    net.on("POST", "/api/parties/pt_1/notice-draft", lambda r: httpx.Response(201, json={"draft": {"id": "d_1", **body(r)}}))
    out = run(hc.party_notice_draft("pt_1", "owner", "whatsapp", " +62 812 0000 0000 ", contact_id="c_1", lang="id",
                                    reason="owner asked to warn about parties"))
    assert out["draft"]["id"] == "d_1"
    sent = body(net.last("POST", "/api/parties/pt_1/notice-draft"))
    assert sent == {"to": "owner", "channel": "whatsapp", "address": "+62 812 0000 0000", "contact_id": "c_1", "lang": "id",
                    "reason": "owner asked to warn about parties"}
    run(hc.party_notice_draft("pt_1", "neighbours", "telegram", "@neighbour", text="Halo! Sabtu ada acara kecil…", lang="th"))
    assert body(net.last("POST", "/api/parties/pt_1/notice-draft"))["text"].startswith("Halo")
    n = len(net.requests)
    for args, kw, msg in [
        (("pt_1", "landlord", "whatsapp", "+62"), {}, "to must be"),
        (("pt_1", "owner", "web", "https://x.com"), {}, "channel must be"),
        (("pt_1", "owner", "sms", "+62"), {}, "channel must be"),
        (("pt_1", "owner", "whatsapp", "  "), {}, "address"),
        (("pt_1", "owner", "whatsapp", "+62"), {"lang": "eng"}, "2-letter"),
        (("pt_1", "owner", "whatsapp", "+62"), {"lang": "th"}, "template"),
        (("pt_1", "owner", "whatsapp", "+62"), {"text": "  "}, "empty"),
        (("pt_1", "owner", "whatsapp", "+62"), {"text": "my passport no. 12345678"}, "passport"),
        (("x_1", "owner", "whatsapp", "+62"), {}, "pt_"),
    ]:
        with pytest.raises(ToolError, match=msg):
            run(hc.party_notice_draft(*args, **kw))
    assert len(net.requests) == n


def test_event_feedback_get(net):
    net.on("GET", "/api/event-feedback", {"feedback": [{"event_id": "ev_1", "rating": 5, "attended": True}],
                                          "venues": [{"kind": "organizer", "key": "savaya", "name": "Savaya", "avg": 4.5, "n": 2}]})
    out = run(hc.event_feedback_get("s_1", "2026-11-01", "2026-11-21"))
    assert out["venues"][0]["avg"] == 4.5
    p = net.last("GET", "/api/event-feedback").url.params
    assert p["search_id"] == "s_1" and p["from"] == "2026-11-01" and p["to"] == "2026-11-21"
    run(hc.event_feedback_get("s_1"))
    assert set(net.last("GET", "/api/event-feedback").url.params) == {"search_id"}
    n = len(net.requests)
    with pytest.raises(ToolError, match="YYYY-MM-DD"):
        run(hc.event_feedback_get("s_1", "21.11.2026"))
    with pytest.raises(ToolError, match="after"):
        run(hc.event_feedback_get("s_1", "2026-11-21", "2026-11-01"))
    assert len(net.requests) == n


def test_docstrings_teach_wave9():
    d = hc.party_notice_draft.__doc__ or ""
    for s in ("APPROVAL DRAFT", "NEVER auto-send", "polite", "OWNER'S language", "banjar", "never invent amounts", "quiet_after"):
        assert s in d, s
    assert "STRONGEST" in (hc.event_feedback_get.__doc__ or "")
    up = hc.events_upsert.__doc__ or ""
    for s in ("event_source_read", "WIN over chat posts", "LINK, DON'T STORE", "stale", "refused", "Telegram-only"):
        assert s in up, s
    assert up.index("event_source_read") < up.index("tg_history")  # organizer pages come first in the sweep
    assert "ONLY for photos without a public https URL" in (hc.event_photo_upload.__doc__ or "")
    sr = hc.event_source_read.__doc__ or ""
    for s in ("robots.txt", "HuntBot/1.0 (+read-only)", "noindex", "≤ 1 request/s", "6 h", "naive_time", "Never invent an offset"):
        assert s in sr, s


# ---------------------------------------------------------------- event_source_read

LD_GRAPH = {
    "@context": "https://schema.org",
    "@graph": [
        {"@type": "Organization", "@id": "https://www.savaya.test/#org", "name": "Savaya Bali", "url": "https://www.savaya.test/"},
        {"@type": "WebPage", "name": "Events"},
        {"@type": "MusicEvent", "name": "Sunset Sessions: Solomun", "url": "/events/solomun/",
         "startDate": "2026-11-28T16:00:00+0800", "endDate": "2026-11-29T01:00:00+08:00",
         "eventStatus": "https://schema.org/EventScheduled",
         "location": {"@type": "Place", "name": "Savaya", "address": {"@type": "PostalAddress",
                      "streetAddress": "Jl. Belimbing Sari", "addressLocality": "Pecatu", "addressRegion": "Bali",
                      "addressCountry": {"@type": "Country", "name": "ID"}},
                      "geo": {"@type": "GeoCoordinates", "latitude": "-8.8347", "longitude": 115.1023}},
         "offers": {"@type": "AggregateOffer", "lowPrice": "1.500.000", "highPrice": 3000000, "priceCurrency": "idr",
                    "url": "https://tickets.example.com/solomun"},
         "performer": [{"@type": "Person", "name": "Solomun"}, {"@type": "MusicGroup", "name": "Local Support"}],
         "organizer": {"@id": "https://www.savaya.test/#org", "name": "Savaya Bali", "url": "https://www.savaya.test/"},
         "image": [{"@type": "ImageObject", "url": "https://cdn.savaya.test/img/solomun.jpg"}]},
    ],
}
LD_LIST = {"@context": "https://schema.org", "@type": "ItemList", "itemListElement": [
    {"@type": "ListItem", "position": 1, "item": {"@type": "SocialEvent", "name": "Full Moon Gathering",
                                                  "startDate": "2026-12-04T19:30", "location": "Savaya garden",
                                                  "offers": {"@type": "Offer", "price": 0, "priceCurrency": "IDR"}}},
    {"@type": "ListItem", "position": 2, "item": {"@type": ["Festival"], "name": "NYE Festival", "startDate": "2026-12-31",
                                                  "eventStatus": "EventCancelled"}},
]}


def ld_page(*blobs, extra=""):
    scripts = "".join(f'<script type="application/ld+json">{json.dumps(b)}</script>' for b in blobs)
    return (f'<html><head><title>Events | Savaya</title><meta property="og:site_name" content="Savaya Bali">'
            f'<meta property="og:title" content="Savaya events">{scripts}</head><body>{extra}</body></html>')


def test_source_read_jsonld_graph_music_event(web):
    web.on("GET", "/events/", page(ld_page(LD_GRAPH, LD_LIST)), host="www.savaya.test")
    out = run(hc.event_source_read("https://www.savaya.test/events/", tz="Asia/Makassar"))
    assert out["read"] == "jsonld" and out["site_name"] == "Savaya Bali" and out["total"] == 3 and not out["from_cache"]
    ev = {e["title"]: e for e in out["events"]}
    m = ev["Sunset Sessions: Solomun"]
    assert m["type"] == "MusicEvent" and m["url"] == "https://www.savaya.test/events/solomun/"
    assert m["start"]["value"] == "2026-11-28T16:00:00+08:00" and m["naive_time"] is False
    assert m["place"]["lat"] == -8.8347 and m["place"]["lng"] == 115.1023 and "Pecatu" in m["place"]["address"]
    assert m["price"] == {"low": 1500000.0, "high": 3000000.0, "kind": "paid", "currency": "IDR"}
    assert m["lineup"] == ["Solomun", "Local Support"] and m["ticket_url"] == "https://tickets.example.com/solomun"
    s = m["suggested"]
    assert s["source_kind"] == "web" and s["source_url"] == "https://www.savaya.test/events/solomun/"
    assert s["source_name"] == "Savaya Bali" and s["starts_at"] == "2026-11-28T16:00:00+08:00"
    assert s["ends_at"] == "2026-11-29T01:00:00+08:00" and s["price"] == 1500000 and s["currency"] == "IDR"
    assert s["booking"] == "ticket" and s["organizer_name"] == "Savaya Bali"
    assert s["photo_url"] == "https://cdn.savaya.test/img/solomun.jpg" and s["photo_credit"] == "Savaya Bali"
    assert s["photo_source_url"] == "https://www.savaya.test/events/"
    assert set(m["missing"]) == {"country", "about_ru", "category"}
    # the suggestion is a valid events_upsert item once the agent adds its own words
    hc.validate_event({**s, "country": "bali", "about_ru": "Солнечный сет на скале", "category": "club"})

    naive = ev["Full Moon Gathering"]
    assert naive["naive_time"] is True and naive["start"]["value"] == "2026-12-04T19:30:00"
    assert naive["start"]["if_local"] == "2026-12-04T19:30:00+08:00"  # offered, not applied
    assert "starts_at" not in naive["suggested"] and "without an offset" in naive["missing"][0]
    assert naive["price"]["kind"] == "free" and naive["place"]["name"] == "Savaya garden"
    nye = ev["NYE Festival"]
    assert nye["date_only"] and nye["status"] == "cancelled" and nye["suggested"]["status"] == "cancelled"
    # UA, robots first, then the page, ≥ 1 s apart on the same host
    paths = [r.url.path for r in web.requests]
    assert paths == ["/robots.txt", "/events/"]
    assert all(r.headers["user-agent"] == "HuntBot/1.0 (+read-only)" for r in web.requests)
    assert web.sleeps and 0.9 <= web.sleeps[-1] <= 1.0
    # cached for 6 h: no new request, same answer; max_events slices
    again = run(hc.event_source_read("https://www.savaya.test/events/", max_events=1, tz="Asia/Makassar"))
    assert again["from_cache"] and len(again["events"]) == 1 and len(web.requests) == 2


def test_source_read_utc_and_tz_conversion(web):
    ld = {"@context": "https://schema.org", "@type": "DanceEvent", "name": "Salsa night", "startDate": "2026-11-27T12:00:00Z",
          "location": {"@type": "Place", "name": "Desa"}}
    web.on("GET", "/salsa", page(ld_page(ld)), host="venue.test")
    ev = run(hc.event_source_read("https://venue.test/salsa"))["events"][0]
    assert ev["start"]["value"] == "2026-11-27T12:00:00+00:00" and ev["start"]["utc"] and "local" not in ev["start"]
    ev = run(hc.event_source_read("https://venue.test/salsa", tz="Asia/Makassar"))["events"][0]
    assert ev["start"]["local"] == "2026-11-27T20:00:00+08:00" and ev["suggested"]["starts_at"] == "2026-11-27T20:00:00+08:00"
    with pytest.raises(ToolError):
        run(hc.event_source_read("https://venue.test/salsa", tz="Mars/Olympus"))


def test_source_read_og_fallback(web):
    html_text = ('<html><head><meta property="og:type" content="event"><meta property="og:title" content="Frost Moon Beach Party">'
                 '<meta property="og:site_name" content="Sundays Beach Club"><meta property="og:url" content="https://sundays.test/frost">'
                 '<meta property="og:image" content="/img/frost.jpg"><meta property="event:start_time" content="2026-11-29T15:00:00+08:00">'
                 '<meta property="og:description" content="DJs &amp; fire show on the beach"></head><body></body></html>')
    web.on("GET", "/frost", page(html_text), host="sundays.test")
    out = run(hc.event_source_read("https://sundays.test/frost"))
    assert out["read"] == "og" and len(out["events"]) == 1
    ev = out["events"][0]
    assert ev["from"] == "og" and ev["single_page_guess"] is False and ev["description"] == "DJs & fire show on the beach"
    assert ev["image"] == "https://sundays.test/img/frost.jpg" and ev["suggested"]["starts_at"] == "2026-11-29T15:00:00+08:00"
    assert ev["suggested"]["source_name"] == "Sundays Beach Club" and ev["suggested"]["photo_credit"] == "Sundays Beach Club"


def test_source_read_listing_links(web):
    links = ('<a href="/events/frost-moon/">Frost Moon</a><a href="/events/frost-moon/#tickets">dup</a>'
             '<a href="https://sundays.test/2026/11/28/sunset/">Sunset</a><a href="/about">About</a>'
             '<a href="https://other.test/events/x">elsewhere</a><a href="mailto:a@b.c">mail</a>'
             '<a href="/whats-on/nye">NYE</a>')
    web.on("GET", "/events", page('<html><head><meta property="og:title" content="Sundays">'
                                  f'<meta property="og:site_name" content="Sundays"></head><body>{links}</body></html>'), host="sundays.test")
    out = run(hc.event_source_read("https://sundays.test/events"))
    assert out["read"] == "list" and out["events"] == []
    assert [x["url"] for x in out["links"]] == ["https://sundays.test/events/frost-moon/", "https://sundays.test/2026/11/28/sunset/",
                                               "https://sundays.test/whats-on/nye"]


def test_source_read_noindex_skips(web):
    web.on("GET", "/a", page('<html><head><meta name="robots" content="noindex, follow">' + ld_page(LD_GRAPH)[6:]), host="n.test")
    web.on("GET", "/b", page(ld_page(LD_GRAPH), {"X-Robots-Tag": "noindex"}), host="n.test")
    web.on("GET", "/c", page(ld_page(LD_GRAPH), {"X-Robots-Tag": "googlebot: noindex"}), host="n.test")
    web.on("GET", "/d", page(ld_page(LD_GRAPH), {"X-Robots-Tag": "huntbot: none"}), host="n.test")
    for p in ("/a", "/b", "/d"):
        out = run(hc.event_source_read("https://n.test" + p))
        assert out["skipped"] == "noindex" and "events" not in out, p
    assert run(hc.event_source_read("https://n.test/c"))["total"] == 1  # addressed to another bot only


def test_source_read_robots(web):
    web.on("GET", "/robots.txt", httpx.Response(200, text="User-agent: *\nDisallow: /private/\nCrawl-delay: 3\n\n"
                                                "User-agent: HuntBot\nDisallow: /\n", headers={"content-type": "text/plain"}),
           host="strict.test")
    web.on("GET", "/events", page(ld_page(LD_GRAPH)), host="strict.test")
    out = run(hc.event_source_read("https://strict.test/events"))
    assert out["skipped"] == "robots" and not web.hits("GET", "/events", "strict.test")
    # a generic Disallow + Crawl-delay
    web.on("GET", "/robots.txt", httpx.Response(200, text="User-agent: *\nDisallow: /private/\nCrawl-delay: 3\n"), host="slow.test")
    web.on("GET", "/private/x", page(ld_page(LD_GRAPH)), host="slow.test")
    web.on("GET", "/events", page(ld_page(LD_GRAPH)), host="slow.test")
    assert run(hc.event_source_read("https://slow.test/private/x"))["skipped"] == "robots"
    assert run(hc.event_source_read("https://slow.test/events"))["total"] == 1
    assert web.sleeps[-1] > 2.5  # Crawl-delay 3 honoured
    assert len(web.hits("GET", "/robots.txt", "slow.test")) == 1  # robots.txt cached
    # 404 robots = allowed, 5xx = treat as disallowed
    web.on("GET", "/robots.txt", httpx.Response(404, text="nope"), host="open.test")
    web.on("GET", "/e", page(ld_page(LD_GRAPH)), host="open.test")
    assert run(hc.event_source_read("https://open.test/e"))["total"] == 1
    web.on("GET", "/robots.txt", httpx.Response(503, text="down"), host="down.test")
    web.on("GET", "/e", page(ld_page(LD_GRAPH)), host="down.test")
    assert run(hc.event_source_read("https://down.test/e"))["skipped"] == "robots"
    assert not web.hits("GET", "/e", "down.test")


def test_source_read_refuses_non_public(web):
    for bad in ("http://www.savaya.test/events", "https://10.0.0.5/events", "https://localhost/x", "https://[::1]/",
                "https://169.254.169.254/latest", "https://192.168.1.10/", "ftp://x.test/"):
        with pytest.raises(ToolError, match="public https"):
            run(hc.event_source_read(bad))
    for social in ("https://t.me/balichatparties/1", "https://www.instagram.com/savayabali/"):
        with pytest.raises(ToolError, match="not read here"):
            run(hc.event_source_read(social))
    assert not web.requests
    # a redirect to a private address is refused hop by hop
    web.on("GET", "/go", httpx.Response(302, headers={"location": "https://127.0.0.1/admin"}), host="r.test")
    with pytest.raises(ToolError, match="public https"):
        run(hc.event_source_read("https://r.test/go"))
    web.on("GET", "/gone", httpx.Response(404, text="gone"), host="r.test")
    with pytest.raises(ToolError, match="answered 404"):
        run(hc.event_source_read("https://r.test/gone"))


def test_source_read_ics(web):
    ics = ("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nSUMMARY:Open mic\\, Ubud\r\nDTSTART;TZID=Asia/Makassar:20261126T"
           "200000\r\nDTEND;TZID=Asia/Makassar:20261126T230000\r\nLOCATION:Ubud\r\n  cafe\r\nGEO:-8.5069;115.2625\r\n"
           "URL:https://cafe.test/open-mic\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nSUMMARY:Floating\r\nDTSTART:20261127T190000\r\n"
           "END:VEVENT\r\nEND:VCALENDAR\r\n")
    web.on("GET", "/cal.ics", httpx.Response(200, text=ics, headers={"content-type": "text/calendar"}), host="cafe.test")
    out = run(hc.event_source_read("https://cafe.test/cal.ics"))
    assert out["read"] == "ics" and out["total"] == 2
    a, b = out["events"]
    assert a["title"] == "Open mic, Ubud" and a["start"]["value"] == "2026-11-26T20:00:00+08:00" and not a["naive_time"]
    assert a["place"] == {"name": "Ubud cafe", "lat": -8.5069, "lng": 115.2625}
    assert a["suggested"]["source_url"] == "https://cafe.test/open-mic" and a["suggested"]["ends_at"] == "2026-11-26T23:00:00+08:00"
    assert b["naive_time"] and "starts_at" not in b["suggested"]


def test_parse_event_time_units():
    t = hc.parse_event_time
    assert t("2026-11-28T22:00+08:00")["value"] == "2026-11-28T22:00:00+08:00"
    assert t("2026-11-28T22:00:00.000+0700")["value"] == "2026-11-28T22:00:00+07:00"
    assert t("2026-11-28 22:00")["naive"] and t("2026-11-28")["date_only"]
    assert t("Saturday night")["unparsed"] and t(None)["value"] is None
    assert t("2026-02-30T10:00:00+08:00").get("unparsed")


def test_robots_allows_unit():
    ok, delay = hc.robots_allows("User-agent: *\nDisallow: /admin\nCrawl-delay: 2\n", "https://x.test/events")
    assert ok and delay == 2.0
    assert not hc.robots_allows("User-agent: *\nDisallow: /admin\n", "https://x.test/admin/1")[0]
    assert hc.robots_allows("", "https://x.test/")[0] and not hc.robots_allows(None, "https://x.test/")[0]


# ---------------------------------------------------------------- the real packs

PARTY_KEYS = {"quiet_after", "hint_ru", "hint_en", "notice_owner", "notice_neighbours", "fines_ru", "fines_en"}


def test_generic_party_defaults():
    p = yaml.safe_load((REGIONS / "_generic" / "events.yaml").read_text(encoding="utf-8"))["party"]
    assert set(p) <= PARTY_KEYS and p["quiet_after"] == "23:00"
    assert p["hint_ru"] and p["hint_en"] and isinstance(p["notice_owner"], bool) and isinstance(p["notice_neighbours"], bool)


def test_bali_party_rules_are_honest():
    p = yaml.safe_load((REGIONS / "bali" / "events.yaml").read_text(encoding="utf-8"))["party"]
    assert set(p) <= PARTY_KEYS and p["quiet_after"] == "22:00"
    assert p["notice_owner"] is True and p["notice_neighbours"] is True
    assert "banjar" in p["fines_en"].lower() and "банджар" in p["fines_ru"].lower()
    for k in ("fines_en", "fines_ru", "hint_en", "hint_ru"):
        assert not re.search(r"\d{2,}\s*(000|k|rb|ribu|juta|idr|rp)|rp\s*\d", p[k].lower()), (k, p[k])  # no invented amounts


def test_bali_organizer_sources():
    src = yaml.safe_load((REGIONS / "bali" / "events.yaml").read_text(encoding="utf-8"))["sources"]
    by = {s["id"]: s for s in src}
    for s in src:
        if "events_url" in s:
            assert s["events_url"].startswith("https://"), s["id"]
        if "read" in s:
            assert s["read"] in {"jsonld", "og", "list", "ics"}, s["id"]
    readable = [s for s in src if s.get("read")]
    assert len(readable) >= 8
    assert any(s["kind"] == "ticket" for s in src)
    for sid in ("single-fin", "potato-head"):
        assert by[sid].get("read"), sid


def test_region_doc_reads_events_yaml():
    out = hc.read_doc("bali/canggu", "events.yaml", root=REGIONS)
    assert out["level"] == "bali" and "party:" in out["content"] and "events_url" in out["content"]
    assert "events.yaml" in hc.available_docs("bali", root=REGIONS)
