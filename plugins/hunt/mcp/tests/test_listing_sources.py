"""Portal adapters · listing_source_read: one rental-portal page (a search list or a single listing) → normalized
listings with a `suggested` dict for listing_upsert. The pure extractor per adapter (4zida, Rumah123, 99.co, Travelio,
City Expert, Rentor, BaliHousing / Baliarenda, RentHub), the generic reader (JSON-LD with @id references, embedded app
JSON, og: tags, same-site links), prices with their period, the BLOCKED_SITES table, and the politeness paths (robots.txt
with wildcards, noindex, 403 / bot challenge, cache, per-host throttle) through a mocked transport.

Every fixture below mirrors the STRUCTURE of the real page (checked 2026-11-26) with invented content: no real
addresses, people, phone numbers, photos or ad ids. No network."""
import asyncio
import json

import httpx
import pytest

from huntcore import base as base_mod, event_sources, places, portals
from huntcore.base import ToolError

URL = "https://crm.test"
TOKEN = "hunt_test_token"


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


@pytest.fixture
def web(monkeypatch, isolated):
    fake = FakeNet()
    monkeypatch.setattr(base_mod, "_TRANSPORT", httpx.MockTransport(fake))
    sleeps: list[float] = []

    async def fake_sleep(s):
        sleeps.append(s)

    monkeypatch.setattr(places, "_sleep", fake_sleep)
    monkeypatch.setattr(event_sources, "_host_last", {})
    monkeypatch.setattr(event_sources, "_host_interval", {})
    fake.sleeps = sleeps
    fake.on("GET", "/robots.txt", httpx.Response(200, text="User-agent: *\nAllow: /\n", headers={"content-type": "text/plain"}))
    return fake


def page(html_text, headers=None, status=200):
    return httpx.Response(status, text=html_text, headers={"content-type": "text/html; charset=utf-8", **(headers or {})})


def ld(*blobs):
    return "".join(f'<script type="application/ld+json">{json.dumps(b, ensure_ascii=False)}</script>' for b in blobs)


def flight(*rows, text_row=None):
    """Next.js app-router flight data the way pages carry it: rows "id:JSON\\n" (and one "id:T<hexlen>,JSON" text row)
    split into self.__next_f.push([1, "..."]) chunks."""
    stream = "".join(f"{i + 1:x}:{json.dumps(r, ensure_ascii=False)}\n" for i, r in enumerate(rows))
    if text_row is not None:
        t = json.dumps(text_row, ensure_ascii=False)
        stream += f"2a:T{len(t.encode()):x},{t}"
    chunks = [stream[i:i + 120] for i in range(0, len(stream), 120)]
    return "".join(f"<script>self.__next_f.push([1,{json.dumps(c)}])</script>" for c in chunks)


def html_page(head="", body="", title="Rentals"):
    return f"<!doctype html><html><head><title>{title}</title>{head}</head><body>{body}</body></html>"


def by_id(listings):
    return {x["id"]: x for x in listings}


# ---------------------------------------------------------------- units

def test_parse_price_text_units():
    p = portals.parse_price_text
    assert p("Rp 185 Juta /tahun") == {"amount": 185_000_000, "currency": "IDR", "period": "year", "text": "Rp 185 Juta /tahun"}
    assert p("IDR 26,750,000")["amount"] == 26_750_000 and p("IDR 26,750,000")["period"] is None
    assert p("$ 1,550 /month")["amount"] == 1550 and p("$ 1,550 /month")["currency"] == "USD" and p("$ 1,550 /month")["period"] == "month"
    assert p("IDR 80.1M")["amount"] == 80_100_000
    assert p("63 700 ₽") == {"amount": 63700, "currency": "RUB", "period": None, "text": "63 700 ₽"}
    assert p("Квартира за 1 700 евро за месяц")["amount"] == 1700 and p("Квартира за 1 700 евро за месяц")["currency"] == "EUR"
    assert p("Квартира за 1 700 евро за месяц")["period"] == "month" and p("40 евро за день")["period"] == "day"
    assert p("Rp 95,1 Ribu")["amount"] == 95_100 and p("฿ 16,000 / month")["currency"] == "THB"
    assert p("IDR 1,000,000 harian / 20,000,000 bulanan")["period"] is None  # two periods in one text = unknown
    assert p("no price here") == {} and p(None) == {}


def test_reg_domain_and_blocked_table():
    assert portals._reg_domain("www.dotproperty.co.th") == "dotproperty.co.th" and portals._reg_domain("home.ss.ge") == "ss.ge"
    assert portals._reg_domain("www.renthub.in.th") == "renthub.in.th" and portals._reg_domain("www.99.co") == "99.co"
    for host in ("krisha.kz", "home.ss.ge", "www.myhome.ge", "korter.ge", "www.halooglasi.com", "www.nekretnine.rs",
                 "www.sahibinden.com", "www.hepsiemlak.com", "www.emlakjet.com", "www.lamudi.co.id", "www.olx.kz",
                 "www.olx.co.id", "www.ddproperty.com", "www.fazwaz.com", "www.fazwaz.co.th", "www.hipflat.co.th",
                 "www.livinginsider.com"):
        assert portals.blocked_site(host), host
    for host in ("www.4zida.rs", "www.rumah123.com", "rentor.ge", "www.dotproperty.co.th", "prian.ru"):
        assert portals.blocked_site(host) is None, host


def test_robots_wildcards_longest_match_and_our_group():
    rules = ("User-agent: trovitBot\nDisallow: /\n\nUser-agent: *\nAllow: /kodepos/?*location=*\nDisallow: /api\n"
             "Disallow: /*/?*maxPrice=*\nDisallow: /*/?*bedroom*\nDisallow : /rent/?pagination=\nDisallow: /*.ts$\n")
    ok = lambda u: event_sources.robots_allows(rules, u)[0]  # noqa: E731
    assert ok("https://x.test/sewa/bali/rumah/") and ok("https://x.test/sewa/bali/rumah/?page=2")
    assert not ok("https://x.test/sewa/bali/rumah/?maxPrice=9000000") and not ok("https://x.test/sewa/bali/?bedroom=2")
    assert not ok("https://x.test/rent/?pagination=2") and ok("https://x.test/rent/page/2/")
    assert not ok("https://x.test/app.ts") and ok("https://x.test/app.tsx")  # "$" anchors the end
    assert ok("https://x.test/kodepos/?q=1&location=bali") and not ok("https://x.test/api/v1")
    longest = "User-agent: *\nDisallow: /rent/\nAllow: /rent/page/\n"
    assert event_sources.robots_allows(longest, "https://x.test/rent/page/3/")[0] and not event_sources.robots_allows(longest, "https://x.test/rent/x")[0]
    tie = "User-agent: *\nDisallow: /a\nAllow: /a\n"
    assert event_sources.robots_allows(tie, "https://x.test/a")[0]  # Allow wins a tie
    ours = "User-agent: *\nDisallow:\nCrawl-delay: 2\n\nUser-agent: HuntBot\nDisallow: /private/\n"
    assert event_sources.robots_allows(ours, "https://x.test/rent/") == (True, None)  # our own group replaces "*"
    assert not event_sources.robots_allows(ours, "https://x.test/private/1")[0]
    assert event_sources.robots_allows("User-agent: *\nDisallow:\nCrawl-delay: 2\n", "https://x.test/")[1] == 2.0


# ---------------------------------------------------------------- 4zida.rs

ZIDA = "https://www.4zida.rs/izdavanje-stanova/beograd"
Z1, Z2 = "aa00000000000000000000a1", "aa00000000000000000000b2"


def zida_rec(i, **kw):
    r = {"id": i, "urlPath": f"/izdavanje-stanova/probni-kraj-probna-opstina-beograd/dvosoban-stan/{i}", "for": "rent",
         "price": 700, "m2": 52, "roomCount": 2, "structureLabel": "Dvosoban stan", "title": "Ulica Probna 7",
         "type": "apartment", "advertiserType": 4, "paymentTerm": "month", "createdAt": "2026-10-01T09:00:00.000Z",
         "lastActivatedAt": "2026-11-24T08:00:00.000Z", "placeTitles": ["Probni kraj", "Probna opština", "Beograd"],
         "deposit": 700, "furnished": "yes", "petsAllowed": True, "inhabitableFrom": "2026-12-01T00:00:00+00:00",
         "image": {"search": {"380x0_fill_0_webp": f"https://img.zida.test/{i}/a-380.webp",
                              "840x0_fill_0_jpeg": f"https://img.zida.test/{i}/a-840.jpeg"}},
         "thumbnails": [{"search": {"840x0_fill_0_jpeg": f"https://img.zida.test/{i}/b-840.jpeg"}}]}
    r.update(kw)
    return r


def zida_list_page():
    items = [{"@type": "ListItem", "position": n + 1, "url": f"https://www.4zida.rs{zida_rec(i)['urlPath']}",
              "item": {"@type": "RealEstateListing", "@id": f"https://www.4zida.rs{zida_rec(i)['urlPath']}",
                       "url": f"https://www.4zida.rs{zida_rec(i)['urlPath']}", "name": "Ulica Probna 7",
                       "image": {"@type": "ImageObject", "url": f"https://img.zida.test/{i}/ld.webp"},
                       "offers": {"@type": "Offer", "price": p, "priceCurrency": "EUR",
                                  "businessFunction": "http://purl.org/goodrelations/v1#LeaseOut"},
                       "itemOffered": {"@type": "Apartment", "floorSize": {"@type": "QuantitativeValue", "value": 52, "unitCode": "MTK"},
                                       "numberOfRooms": 2, "address": {"@type": "PostalAddress", "addressCountry": "RS"}}}}
             for n, (i, p) in enumerate(((Z1, 700), (Z2, 950)))]
    head = ld({"@context": "https://schema.org", "@type": "Organization", "name": "4zida.rs", "url": "https://www.4zida.rs"},
              {"@context": "https://schema.org", "@type": "ItemList", "itemListElement": items}) + \
        '<meta property="og:site_name" content="4zida.rs"><meta property="og:title" content="Izdavanje stanova Beograd">'
    recs = [zida_rec(Z1), zida_rec(Z2, advertiserType=1, paymentTerm=None, price=950, roomCount=2.5, structureLabel="Dvoiposoban stan",
                                   placeTitles=["Drugi kraj", "Probna opština", "Beograd"])]
    body = ('<a href="/izdavanje-stanova/beograd?strana=2">2</a><a href="/izdavanje-stanova/beograd?strana=3">3</a>' +
            flight(["$", "div", None, {"className": "grid"}], {"ads": recs}, text_row=recs))
    return html_page(head, body)


def test_4zida_list_adapter_merges_jsonld():
    ex = portals.extract_page_listings(zida_list_page(), "text/html", ZIDA)
    assert ex["read"] == "adapter" and ex["adapter"] == "4zida.rs" and ex["site_name"] == "4zida.rs"
    assert len(ex["listings"]) == 2  # the same ad repeated in the flight data counts once
    a, b = by_id(ex["listings"])[Z1], by_id(ex["listings"])[Z2]
    assert a["from"] == "adapter:4zida.rs" and a["url"].endswith(Z1) and a["title"] == "Dvosoban stan · Ulica Probna 7"
    assert (a["price"], a["currency"], a["period"], a["period_source"]) == (700, "EUR", "month", "page")  # EUR from JSON-LD
    assert a["owner_or_agent"] == "owner" and b["owner_or_agent"] == "agent"
    assert a["district"] == "Probni kraj" and a["city"] == "Beograd" and a["address"] == "Probni kraj, Probna opština, Beograd"
    assert a["rooms"] == 2 and a["area_m2"] == 52 and a["posted"].startswith("2026-10-01") and a["updated"].startswith("2026-11-24")
    assert a["photos"][:2] == [f"https://img.zida.test/{Z1}/a-840.jpeg", f"https://img.zida.test/{Z1}/b-840.jpeg"]
    assert a["extras"] == {"deposit": 700, "furnished": "yes", "pets_allowed": True, "available_from": "2026-12-01"}
    assert (b["period"], b["period_source"], b["rooms"]) == ("month", "site_convention", 2.5)
    assert ex["next_url"] == "https://www.4zida.rs/izdavanje-stanova/beograd?strana=2"
    s, missing = portals._listing_suggest(a, ex["site_name"], ZIDA)
    assert s == {"listing_id": f"4zida-{Z1}", "source": "4zida.rs", "source_url": a["url"], "title": "Dvosoban stan · Ulica Probna 7",
                 "area_text": "Probni kraj, Probna opština, Beograd", "property_type": "apartment", "size_m2": 52.0,
                 "price": 700, "currency": "EUR", "available": "2026-12-01"}
    assert missing[0].startswith("district") and "'Probni kraj'" in missing[0] and missing[-1].startswith("summary")
    sb, _ = portals._listing_suggest(b, ex["site_name"], ZIDA)
    assert sb["price"] == 950 and "site's convention" in sb["price_note"]


def single_listing_ld(page_url):
    return ld({"@context": "https://schema.org", "@type": "Place", "@id": page_url + "#place",
               "geo": {"@type": "GeoCoordinates", "latitude": 44.7001, "longitude": 20.4001}},
              {"@context": "https://schema.org", "@type": "Person", "@id": page_url + "#seller", "name": "Invented Person",
               "contactPoint": {"@id": page_url + "#cp"}},
              {"@context": "https://schema.org", "@type": "ContactPoint", "@id": page_url + "#cp", "telephone": "+999 11 2223334"},
              {"@context": "https://schema.org", "@type": "RealEstateListing", "@id": page_url + "#real-estate-listing",
               "url": page_url, "name": "Dvosoban stan za izdavanje, Probni kraj, 650€, 48m²",
               "description": "Namešteno, na 3. spratu, ima lift.", "offers": {"@id": page_url + "#offer"},
               "itemOffered": {"@id": page_url + "#apartment"}, "image": {"@id": page_url + "#primary-image"}},
              {"@context": "https://schema.org", "@type": "ImageObject", "@id": page_url + "#primary-image",
               "url": "https://img.zida.test/one/primary.jpeg"},
              {"@context": "https://schema.org", "@type": "Offer", "@id": page_url + "#offer", "url": page_url, "price": 650,
               "priceCurrency": "EUR", "seller": {"@id": page_url + "#seller"}},
              {"@context": "https://schema.org", "@type": "Apartment", "@id": page_url + "#apartment", "url": page_url,
               "name": "Dvosoban stan za izdavanje, Probni kraj, 650€, 48m²", "containedInPlace": {"@id": page_url + "#place"},
               "geo": {"@type": "GeoCoordinates", "latitude": 44.7001, "longitude": 20.4001},
               "area": {"@type": "QuantitativeValue", "value": 48, "unitCode": "MTK"}, "numberOfRooms": 2,
               "numberOfBathroomsTotal": 1, "image": [{"@id": page_url + "#primary-image"}, "https://img.zida.test/one/2.webp"]})


def test_4zida_single_listing_page():
    pu = f"https://www.4zida.rs/izdavanje-stanova/probni-kraj-probna-opstina-beograd/dvosoban-stan/{Z1}"
    rec = {"id": Z1, "url": pu, "for": "rent", "price": 650, "advertiserType": 4, "paymentTerm": "month", "m2": 48,
           "structureName": "Dvosoban stan", "title": "Probni kraj", "phone": "+999 11 2223334", "author": {"name": "Invented Person"},
           "placeIdsAndTitles": [{"id": 1, "title": "Probni kraj"}, {"id": 2, "title": "Beograd"}],
           "refreshedAt": "2026-11-25T10:00:00+00:00"}
    ex = portals.extract_page_listings(html_page(single_listing_ld(pu), flight({"ad": rec})), "text/html", pu)
    assert ex["read"] == "adapter" and len(ex["listings"]) == 1
    li = ex["listings"][0]
    assert li["title"] == "Dvosoban stan · Probni kraj" and li["owner_or_agent"] == "owner" and li["currency"] == "EUR"
    assert (li["lat"], li["lng"], li["bathrooms"], li["area_m2"]) == (44.7001, 20.4001, 1, 48)  # from the @id-joined JSON-LD
    assert li["district"] == "Probni kraj" and li["city"] == "Beograd" and li["updated"].startswith("2026-11-25")
    dump = json.dumps(li, ensure_ascii=False)
    assert "2223334" not in dump and "Invented Person" not in dump  # seller name and phone are never surfaced


def test_generic_jsonld_resolves_id_references_on_a_single_page():
    pu = "https://portal.test/listing/flat-48"
    ex = portals.extract_page_listings(html_page(single_listing_ld(pu)), "text/html", pu)
    assert ex["read"] == "jsonld" and len(ex["listings"]) == 1
    li = ex["listings"][0]
    assert li["from"] == "jsonld" and li["url"] == pu and li["title"].startswith("Dvosoban stan za izdavanje")
    assert (li["price"], li["currency"], li["period"]) == (650, "EUR", None)  # the page never says "per month"
    assert (li["rooms"], li["bathrooms"], li["area_m2"], li["lat"]) == (2, 1, 48, 44.7001)
    assert li["photos"] == ["https://img.zida.test/one/primary.jpeg", "https://img.zida.test/one/2.webp"]
    s, missing = portals._listing_suggest(li, ex["site_name"], pu)
    assert "price" not in s and s["price_note"] == "650 EUR (period not stated)"
    assert any(m.startswith("price per month (the page gives no period") for m in missing)
    assert s["listing_id"] == "portal-flat-48" or s["listing_id"].startswith("portal-")


# ---------------------------------------------------------------- Rumah123 / 99.co

R123 = "https://www.rumah123.com/sewa/bali/rumah/"


def r123_rec(oid, title, display, offer, home_owner, **kw):
    r = {"slug": f"/properti/badung-probo/{title.lower().replace(' ', '-')}-{oid}/", "url": f"/properti/badung/{oid}/?price-unit-type=Total",
         "originId": {"formattedValue": oid}, "title": title, "shortDescription": "Rumah nyaman dekat pantai.",
         "price": {"display": display, "offer": offer}, "propertyType": {"formattedValue": "Rumah", "value": "0"},
         "location": {"text": "Probo, Badung", "district": {"name": "Probo"}, "city": {"name": "Badung"}},
         "locationPin": {"lat": -8.7001, "lng": 115.1001},
         "attributes": {"bedrooms": {"value": "3"}, "bathrooms": {"value": "2"}, "buildingSize": {"value": "180"},
                        "furnishing": {"value": "Furnished"}},
         "medias": [{"mediaType": "COVER", "mediaInfo": [{"mediaUrl": f"https://pic.r123.test/{oid}/1.jpg"}]},
                    {"mediaType": "REGULAR", "mediaInfo": [{"mediaUrl": f"https://pic.r123.test/{oid}/2.jpg"}]}],
         "time": {"posted": 1795500000, "updated": 1795400000},
         "agent": {"name": "Agent Contoh", "attributes": {"isHomeOwner": home_owner},
                   "contacts": [{"type": "PHONE_NUMBER", "value": "+62000..."}]}}
    r.update(kw)
    return r


def test_rumah123_adapter_keeps_the_yearly_period():
    recs = [r123_rec("hor00000001", "Villa Kolam Renang Probo", "Rp 240 Juta /tahun", 240_000_000, False),
            r123_rec("hor00000002", "Rumah Dua Lantai Probo", "Rp 9,5 Juta /bulan", 9_500_000, True)]
    page_node = {"@context": "https://schema.org", "@type": ["LocalBusiness", "RealEstateListing"], "@id": R123 + "#webpage",
                 "url": R123, "name": "Sewa Rumah di Bali",
                 "makesOffer": [{"@type": "Offer", "price": "240000000", "priceCurrency": "IDR", "url": "https://www.rumah123.com" + recs[0]["slug"],
                                 "priceSpecification": {"@type": "UnitPriceSpecification", "price": "240000000", "priceCurrency": "IDR", "unitText": "Year"},
                                 "itemOffered": {"@id": "https://www.rumah123.com" + recs[0]["slug"] + "#property"}}],
                 "mainEntity": {"@type": "ItemList", "itemListElement": [{"@type": "ListItem", "position": 1, "item": {
                     "@type": "SingleFamilyResidence", "@id": "https://www.rumah123.com" + recs[0]["slug"] + "#property",
                     "url": "https://www.rumah123.com" + recs[0]["slug"], "name": recs[0]["title"], "numberOfBedrooms": 3}}]}}
    suggestion = {"originId": "loc-1", "title": "Bali", "url": "/sewa/bali/", "price": {"display": None}}
    body = ('<a href="https://www.rumah123.com/sewa/bali/rumah/?page=2">2</a>' +
            flight({"locationSuggestion": suggestion}, {"properties": recs}))
    ex = portals.extract_page_listings(html_page(ld(page_node), body), "text/html", R123)
    assert ex["read"] == "adapter" and len(ex["listings"]) == 2 and ex["next_url"] == R123 + "?page=2"
    a, b = by_id(ex["listings"])["hor00000001"], by_id(ex["listings"])["hor00000002"]
    assert a["url"] == "https://www.rumah123.com" + recs[0]["slug"] and a["property_type"] == "villa"  # "Rumah" but a villa
    assert (a["price"], a["currency"], a["period"], a["price_text"]) == (240_000_000, "IDR", "year", "Rp 240 Juta /tahun")
    assert (b["price"], b["period"], b["property_type"]) == (9_500_000, "month", "house")
    assert a["owner_or_agent"] == "agent" and b["owner_or_agent"] == "owner"
    assert (a["bedrooms"], a["bathrooms"], a["area_m2"], a["district"], a["city"]) == (3, 2, 180, "Probo", "Badung")
    assert a["lat"] == -8.7001 and a["photos"] == ["https://pic.r123.test/hor00000001/1.jpg", "https://pic.r123.test/hor00000001/2.jpg"]
    assert a["posted"] == "2026-11-24T06:00:00Z" and "Agent Contoh" not in json.dumps(a)
    s, missing = portals._listing_suggest(a, ex["site_name"], R123)
    assert "price" not in s and "currency" not in s and s["price_note"] == "240 000 000 IDR per year"
    assert any(m.startswith("price per month (the page gives a per-year price") for m in missing)
    sb, _ = portals._listing_suggest(b, ex["site_name"], R123)
    assert sb["price"] == 9_500_000 and sb["currency"] == "IDR" and sb["listing_id"] == "rumah123-hor00000002"


def test_99co_adapter_next_data():
    def rec(bid, rent_type, price, monthly=None, is_owner=None):
        return {"id": f"uuid-{bid}", "business_id": bid, "title": "Villa Contoh di Probo", "full_address": " Probo ",
                "url": f"rumah-disewa-probo-cp-{bid}", "rent_type": {"id": "4", "value": rent_type},
                "price": {"price": price, "price_tag": "Rp 120 Juta", "currency": {"code": 1, "symbol": "Rp"},
                          "rent_prices": {"daily": None, "weekly": None, "monthly": monthly, "yearly": None}},
                "attributes": {"property_type": {"value": "rumah"}, "bedrooms": 2, "bathrooms": 1,
                               "builtup_area": {"value": "90", "unit": "m2"}},
                "location_pin": {"lat": -8.6, "long": 115.2}, "location": {"city": {"name": "Denpasar"}},
                "media": [{"media_info": [{"url": f"https://img.99.test/{bid}/a.jpg"}]}],
                "timestamps": {"published": 1792300000, "updated": 1792300100}, "flags": {"is_owner": is_owner},
                "agent": {"full_name": "Agen Contoh", "contacts": [{"type": 2, "value": "+62000xxxx"}]}}
    nd = {"props": {"pageProps": {"data": {"listings": [{"group_type_name": "secondary", "data": [rec("1000000001", "yearly", 120_000_000)]},
                                                        {"group_type_name": "secondary", "data": [rec("1000000002", "yearly", 150_000_000, 14_000_000, True)]}]}}}}
    body = f'<script id="__NEXT_DATA__" type="application/json">{json.dumps(nd)}</script>'
    ex = portals.extract_page_listings(html_page('<meta property="og:site_name" content="99.co Indonesia">', body), "text/html",
                                  "https://www.99.co/id/sewa/rumah/bali")
    assert ex["read"] == "adapter" and len(ex["listings"]) == 2
    a, b = by_id(ex["listings"])["1000000001"], by_id(ex["listings"])["1000000002"]
    assert a["url"] == "https://www.99.co/id/properti/rumah-disewa-probo-cp-1000000001"
    assert (a["price"], a["currency"], a["period"]) == (120_000_000, "IDR", "year") and a["owner_or_agent"] is None
    assert (b["price"], b["period"], b["owner_or_agent"]) == (14_000_000, "month", "owner")  # the ad's own monthly price
    assert (a["bedrooms"], a["area_m2"], a["lat"], a["lng"], a["city"], a["property_type"]) == (2, 90, -8.6, 115.2, "Denpasar", "villa")
    assert portals._listing_suggest(a, ex["site_name"], "https://www.99.co/id/sewa/rumah/bali")[0]["listing_id"] == "99-1000000001"
    assert "Agen Contoh" not in json.dumps(ex)


# ---------------------------------------------------------------- Travelio, City Expert, Rentor

def travelio_card(hexid, code, name, prices, lat="-8.8001", lon="115.2001"):
    rows = "".join(f'<div class="price-row"><div class="price-duration-type">{d}</div><div class="price"> {v} </div></div>'
                   for d, v in prices)
    imgs = json.dumps([f"https://cdn.travelio.test/{hexid}/1_n.jpg", f"https://cdn.travelio.test/{hexid}/2_n.jpg"])
    return (f'<div id="{hexid}" class="property-outer-box " data-lat="{lat}" data-lon="{lon}" data-images=\'{imgs}\' data-id="{hexid}">'
            f'<div class="property-box"><a href="//www.travelio.com/property/bali/{name.lower().replace(" ", "-")}_{code}?searchType=monthly" target="_blank">'
            f'<div class="property-name" title="{name}"><div class="property-name-label"> {name} </div>'
            '<div class="property-name-icons"><span class="property-small-icon"><img src="https://asset.travelio.test/hotelbox/guesthouse.png?v=12">villa</span> '
            '<span class="property-small-icon"><img src="https://asset.travelio.test/hotelbox/new-bedroom.png"/>2</span> '
            '<span class="property-small-icon"><img src="https://asset.travelio.test/hotelbox/new-bathroom.png"/>2</span> '
            '<span class="property-small-icon"><img src="https://asset.travelio.test/hotelbox/new-sqm.png"/>95 sqm</span></div></div>'
            f'<div class="property-detail property-detail-lower">{rows}</div></a></div></div>')


def test_travelio_adapter_cards():
    body = (travelio_card("ab" * 12, "0A1B2C3D4E5", "Contoh 2BR Villa Probo", [("Harian", "IDR 1,100,000"), ("Bulanan", "IDR 19,500,000"), ("Tahunan", "-")]) +
            travelio_card("cd" * 12, "9Z8Y7X6W5V4", "Contoh Villa Tahunan", [("Harian", "IDR 900,000"), ("Bulanan", "-"), ("Tahunan", "IDR 210,000,000")]))
    head = '<meta property="og:site_name" content="Travelio"><link rel="next" href="https://www.travelio.com/sewa-villa-bali/bulanan?page=2" />'
    ex = portals.extract_page_listings(html_page(head, body), "text/html", "https://www.travelio.com/sewa-villa-bali/bulanan")
    assert ex["read"] == "adapter" and len(ex["listings"]) == 2 and ex["next_url"].endswith("bulanan?page=2")
    a, b = by_id(ex["listings"])["0A1B2C3D4E5"], by_id(ex["listings"])["9Z8Y7X6W5V4"]
    assert a["url"] == "https://www.travelio.com/property/bali/contoh-2br-villa-probo_0A1B2C3D4E5"  # own page, no query
    assert (a["price"], a["currency"], a["period"]) == (19_500_000, "IDR", "month") and a["extras"]["prices"] == {"day": 1_100_000, "month": 19_500_000}
    assert (a["bedrooms"], a["bathrooms"], a["area_m2"], a["property_type"], a["lat"]) == (2, 2, 95, "villa", -8.8001)
    assert len(a["photos"]) == 2 and a["owner_or_agent"] is None
    assert (b["price"], b["period"]) == (210_000_000, "year")  # no monthly price on the card: the yearly one, said so
    assert "price" not in portals._listing_suggest(b, "Travelio", "https://www.travelio.com/x")[0]


def test_cityexpert_adapter_ng_state():
    state = {"aa11": {"b": {"result": [
        {"uniqueID": "90001-BR", "propId": 90001, "location": "44.8001, 20.4001", "street": "Probna", "size": 61, "structure": "2.5",
         "municipality": "Novi Beograd", "ptId": 1, "price": 720, "coverPhoto": "cx-90001-cover.avif", "rentOrSale": "r",
         "furnished": 1, "availableFrom": "2026-12-05T10:00:00Z", "firstPublished": "2026-11-25T16:00:00Z",
         "bedroomsArray": ["r2"], "minLeaseArray": [12]},
        {"uniqueID": "90002-BR", "propId": 90002, "location": "44.7, 20.5", "street": "Druga", "size": 30, "structure": "1.0",
         "municipality": "Zvezdara", "ptId": 1, "price": 400, "coverPhoto": "cx-90002-cover.avif", "rentOrSale": "r"},
        {"uniqueID": "90003-BR", "propId": 90003, "street": "Bez kartice", "price": 1, "rentOrSale": "r"}],
        "info": {"pageNumber": 1, "hasNextPage": True}}, "u": "/api/Search?req=x"},
        "bb22": {"b": [{"mapLat": 44.8, "mapLng": 20.4, "propId": 90001}]}}
    body = ('<a href="https://cityexpert.rs/izdavanje-nekretnina/beograd/90001/dvoiposoban-stan-probna-novi-beograd"><img '
            'srcset="https://img.cx.test/properties/720x/90000/90001/slike/cx-90001-cover.avif@avif 720w"></a>'
            '<a href="https://cityexpert.rs/izdavanje-nekretnina/beograd/90002/garsonjera-druga-zvezdara">x</a>'
            f'<script id="ng-state" type="application/json">{json.dumps(state)}</script>')
    ex = portals.extract_page_listings(html_page("", body), "text/html", "https://cityexpert.rs/izdavanje-nekretnina/beograd")
    assert ex["read"] == "adapter" and [x["id"] for x in ex["listings"]] == ["90001", "90002"]  # no card link = skipped
    a = ex["listings"][0]
    assert a["url"].endswith("/90001/dvoiposoban-stan-probna-novi-beograd") and a["title"] == "Probna, Novi Beograd"
    assert (a["price"], a["currency"], a["period"], a["period_source"]) == (720, "EUR", "month", "site_convention")
    assert (a["rooms"], a["bedrooms"], a["area_m2"], a["lat"], a["lng"]) == (2.5, 2, 61, 44.8001, 20.4001)
    assert a["photos"] == ["https://img.cx.test/properties/720x/90000/90001/slike/cx-90001-cover.avif"]
    assert a["owner_or_agent"] == "agent" and a["extras"] == {"available_from": "2026-12-05", "furnished": "yes", "min_lease_months": 12}
    assert portals._listing_suggest(a, "City Expert", a["url"])[0]["available"] == "2026-12-05"


BED_SVG = '<svg viewBox="0 0 640 512"><path d="M32 32c17.7 0 32 14.3 32 32V320H288V160c0-17.7"/></svg>'
BATH_SVG = '<svg viewBox="0 0 512 512"><path d="M96 77.3c0-7.3 5.9-13.3 13.3-13.3"/></svg>'
SIZE_SVG = '<svg viewBox="0 0 448 512"><path d="M32 32C14.3 32 0 46.3 0 64v96"/></svg>'


def rentor_card(slug, name, district, price, attrs):
    at = "".join(f'<div class="myhome-attribute"><span class="myhome-attribute__icon">{svg}</span>'
                 f'<span class="myhome-attribute__value"> {v} </span></div>' for svg, v in attrs)
    return (f'<a class="myhome-listing-card" href="https://rentor.ge/listing/{slug}/" ><div class="myhome-swiper-wrapper">'
            f'<div class="myhome-swiper-slide"> <img class="lazyload" src="data:image/png;base64,AAAA" data-src="https://rentor.test/up/{slug}-1.jpeg" > </div>'
            f'<div class="myhome-swiper-slide"> <img class="lazyload" src="data:image/png;base64,AAAA" data-src="https://rentor.test/up/{slug}-2.jpeg" > </div></div>'
            f'<span class="myhome-listing-card__name myhome-listing-card-name-selector"> {name} </span>'
            '<div class="myhome-listing-card-additional-attribute myhome-listing-card-additional-attribute--address">'
            f'<span class="myhome-listing-card-additional-attribute__icon"><svg/></span><span class="myhome-listing-card-additional-attribute__value"> {district} </span></div>'
            f'<div class="myhome-listing-card__value myhome-listing-card-main-value"> {price} </div>'
            f'<div class="myhome-listing-card__attributes">{at}</div><div class="myhome-listing-card-user__name">Agent</div></a>')


def test_rentor_adapter_cards():
    body = (rentor_card("apartment-probni-90011", "64m² Apartment for Rent in Tbilisi Probni", "Probni", "$ 780 /month",
                        [(BED_SVG, "2"), (BATH_SVG, "1"), (SIZE_SVG, "64m²")]) +
            rentor_card("apartment-drugi-90012", "40m² Apartment for Rent in Tbilisi Drugi", "Drugi", "$ 450 /month",
                        [(BATH_SVG, "1"), (SIZE_SVG, "40m²")]) +
            rentor_card("commercial-treci-90013", "90m² Commercial for Rent in Tbilisi Treci", "Treci", "$ 1,200 /month", [(SIZE_SVG, "90m²")]))
    head = '<link rel="next" href="https://rentor.ge/rent/page/2/" />'
    ex = portals.extract_page_listings(html_page(head, body), "text/html", "https://rentor.ge/rent/")
    assert ex["read"] == "adapter" and len(ex["listings"]) == 3 and ex["next_url"] == "https://rentor.ge/rent/page/2/"
    a, b, c = (by_id(ex["listings"])[i] for i in ("90011", "90012", "90013"))
    assert (a["price"], a["currency"], a["period"], a["bedrooms"], a["bathrooms"], a["area_m2"]) == (780, "USD", "month", 2, 1, 64)
    assert b["bedrooms"] is None and b["bathrooms"] == 1  # the icon says which number is which
    assert a["district"] == "Probni" and a["property_type"] == "apartment" and a["owner_or_agent"] == "agent"
    assert a["photos"] == ["https://rentor.test/up/apartment-probni-90011-1.jpeg", "https://rentor.test/up/apartment-probni-90011-2.jpeg"]
    assert c["property_type"] is None and c["extras"]["commercial"] is True


# ---------------------------------------------------------------- BaliHousing / Baliarenda, RentHub

def bali_state(items):
    return f"<script>window.__INITIAL_STATE__ = {json.dumps({'preferences': {'lang': 'en'}, 'data': {'latestListings': items}}, ensure_ascii=False)};</script>"


def bali_item(i, area, title, price, cur, src, calc, idr_only):
    return {"id": i, "verified": i % 2 == 0, "url": f"/{area}/rent-{i}-villa", "title": title, "location": f"Bukit, {area.title()}",
            "price_month": price, "prices_idr_only": idr_only, "display_currency": cur,
            "photos": [{"id": 1, "url": f"/rental-media/{i}/a.jpg"}, {"id": 2, "url": f"/rental-media/{i}/b.jpg"}],
            "yearly": src == "year", "price_source_period": src, "price_calculated": {"month": calc}, "date_actual": 1795600000}


def test_balihousing_adapter_and_converted_prices():
    items = [bali_item(90100, "probo", "Villa, 3 bedrooms", "IDR 45M", "IDR", "month", False, True),
             bali_item(90101, "contoh", "House, 2 bedrooms", "$1,234", "USD", "year", True, False)]
    body = '<a href="/en/probo/rent-90100-villa">a</a><a href="/en/contoh/rent-90101-villa">b</a>' + bali_state(items)
    ex = portals.extract_page_listings(html_page("", body), "text/html", "https://balihousing.com/en")
    assert ex["read"] == "adapter" and ex["adapter"] == "balihousing.com" and len(ex["listings"]) == 2
    a, b = by_id(ex["listings"])["90100"], by_id(ex["listings"])["90101"]
    assert a["url"] == "https://balihousing.com/en/probo/rent-90100-villa"  # the page's own link, with its language prefix
    assert (a["price"], a["currency"], a["period"], a["price_note"]) == (45_000_000, "IDR", "month", None)
    assert (a["property_type"], a["bedrooms"], a["district"], a["city"]) == ("villa", 3, "Probo", "Bukit")
    assert a["photos"] == ["https://balihousing.com/rental-media/90100/a.jpg", "https://balihousing.com/rental-media/90100/b.jpg"]
    assert a["updated"] == "2026-11-25T09:46:40Z" and a["extras"]["verified"] is True
    assert (b["price"], b["currency"], b["property_type"]) == (1234, "USD", "house")
    assert "calculated from a per-year price" in b["price_note"] and "USD by the site's converter" in b["price_note"]
    s, _ = portals._listing_suggest(b, ex["site_name"], "https://balihousing.com/en")
    assert s["price"] == 1234 and "per-year" in s["price_note"] and s["listing_id"] == "balihousing-90101"
    ru = portals.extract_page_listings(html_page("", bali_state([bali_item(90102, "probo", "Вилла, 2 спальни", "63 700 ₽", "RUB", "year", True, False)])),
                                  "text/html", "https://baliarenda.com/")
    r = ru["listings"][0]
    assert ru["adapter"] == "baliarenda.com" and r["url"] == "https://baliarenda.com/probo/rent-90102-villa"
    assert (r["price"], r["currency"], r["property_type"], r["bedrooms"]) == (63700, "RUB", "villa", 2)


def test_renthub_adapter_buildings():
    b1 = {"__typename": "ListingSearchResultConsumerType", "id": "90201", "slug": "contoh-residence-probo", "name": "Contoh Residence",
          "title": "", "coverPicture": "/listing_picture/2026/contoh.jpg",
          "price": {"daily": {"type": "AMOUNT", "minPrice": 500, "maxPrice": 800}, "monthly": {"type": "AMOUNT", "minPrice": 5200, "maxPrice": 7400}},
          "province": "Bangkok", "district": "Probo", "subdistrict": "Contoh", "createdAt": "2020-01-01T00:00:00.000Z",
          "refreshedAt": "2026-11-26T00:00:00.000Z"}
    b2 = {**b1, "id": "90202", "slug": "daily-only", "name": "Daily Only", "price": {"daily": {"type": "AMOUNT", "minPrice": 700, "maxPrice": 700}}}
    nd = {"props": {"pageProps": {"listings": {"freeListings": [b1, b2], "luxuryListings": [b1]}}}}
    body = f'<script id="__NEXT_DATA__" type="application/json">{json.dumps(nd)}</script>'
    ex = portals.extract_page_listings(html_page("", body), "text/html", "https://www.renthub.in.th/en")
    assert ex["read"] == "adapter" and len(ex["listings"]) == 2
    a, d = by_id(ex["listings"])["90201"], by_id(ex["listings"])["90202"]
    assert a["url"] == "https://www.renthub.in.th/en/contoh-residence-probo" and a["title"] == "Contoh Residence"
    assert (a["price"], a["currency"], a["period"], a["price_note"]) == (5200, "THB", "month", "5,200–7,400 THB per month, by room type")
    assert a["address"] == "Contoh, Probo, Bangkok" and a["photos"] == ["https://bcdn.renthub.in.th/listing_picture/2026/contoh.jpg"]
    assert (d["price"], d["period"]) == (700, "day")


# ---------------------------------------------------------------- generic reader

def test_generic_dotproperty_style_itemlist_monthly():
    items = [{"@type": "ListItem", "position": n, "item": {
        "@type": "RealEstateListing", "name": f"Contoh Tower - {n} Bedroom Condo for rent",
        "url": f"https://www.dotproperty.co.th/en/ads/{n}-bedroom-condo-for-rent-contoh_aaaa000{n}-bbbb",
        "datePosted": "2026-06-19T16:53:33+07:00", "image": f"https://cdn.dot.test/{n}.jpeg",
        "about": {"@type": "Apartment", "numberOfBedrooms": n, "address": {"@type": "PostalAddress", "streetAddress": "Contoh-nuea",
                                                                          "addressLocality": "Probo", "addressRegion": "Bangkok", "addressCountry": "TH"},
                  "geo": {"@type": "GeoCoordinates", "latitude": 13.7, "longitude": 100.5}},
        "offers": {"@type": "Offer", "priceCurrency": "THB", "price": str(8000 * n), "priceSpecification": {
            "@type": "UnitPriceSpecification", "price": 8000 * n, "priceCurrency": "THB",
            "eligibleQuantity": {"@type": "QuantitativeValue", "value": 1, "unitCode": "MON"}}}}} for n in (1, 2)]
    head = ld({"@context": "https://schema.org", "@type": "ItemList", "itemListElement": items}) + \
        '<link rel="next" href="https://www.dotproperty.co.th/en/condos-for-rent/bangkok?page=2"/>'
    ex = portals.extract_page_listings(html_page(head), "text/html", "https://www.dotproperty.co.th/en/condos-for-rent/bangkok")
    assert ex["read"] == "jsonld" and len(ex["listings"]) == 2 and ex["next_url"].endswith("?page=2")
    a = ex["listings"][0]
    assert (a["price"], a["currency"], a["period"], a["bedrooms"], a["property_type"]) == (8000, "THB", "month", 1, "condo")
    assert (a["district"], a["city"], a["lat"], a["posted"]) == ("Probo", "Bangkok", 13.7, "2026-06-19T16:53:33+07:00")
    s, _ = portals._listing_suggest(a, "Dot Property", a["url"])
    assert s["price"] == 8000 and s["currency"] == "THB" and s["listing_id"] == "dotproperty-bbbb" or s["listing_id"].startswith("dotproperty-")


def test_generic_prian_style_products_with_duration():
    prods = [{"@context": "https://schema.org", "@type": "Product", "name": f"Квартира за {p} евро за {w} в Контоше, 80 кв.м.",
              "image": f"https://img.prian.test/{i}.jpg", "url": f"https://prian.ru/price/contoh-1-{i}.html",
              "offers": {"@type": "Offer", "price": str(p), "priceCurrency": "EUR",
                         "eligibleDuration": {"@type": "QuantitativeValue", "unitCode": "DAY", "value": d}}}
             for i, p, w, d in ((900001, 1100, "месяц", "30"), (900002, 45, "день", "1"))]
    ex = portals.extract_page_listings(html_page(ld(prods)), "text/html", "https://prian.ru/contoh/rent/")
    a, b = ex["listings"]
    assert (a["price"], a["period"], a["area_m2"], a["property_type"]) == (1100, "month", 80, "apartment")
    assert (b["price"], b["period"]) == (45, "day")
    assert portals._listing_suggest(a, "prian.ru", a["url"])[0]["listing_id"] == "prian-900001"


def test_generic_drops_search_page_nodes():
    base = "https://list.test/rent/bali"
    head = ld({"@context": "https://schema.org", "@graph": [
        {"@type": "RealEstateListing", "@id": base + "#listing", "url": base, "name": "Sewa Rumah di Bali"},
        {"@type": "Product", "@id": base + "#product", "name": "Sewa Rumah di Bali",
         "offers": {"@type": "AggregateOffer", "priceCurrency": "IDR", "lowPrice": 12000000, "offerCount": 5000, "url": base}},
        {"@type": "ItemList", "itemListElement": [
            {"@type": "ListItem", "position": 1, "item": {"@type": "SingleFamilyResidence", "name": "Rumah Contoh",
                                                          "url": "https://list.test/p/contoh-1", "numberOfBedrooms": 2}},
            {"@type": "ListItem", "position": 2, "item": {"@type": "SingleFamilyResidence", "name": "Rumah Contoh Dua",
                                                          "url": "https://list.test/p/contoh-2", "numberOfBedrooms": 3}}]}]})
    ex = portals.extract_page_listings(html_page(head), "text/html", base)
    assert [x["url"] for x in ex["listings"]] == ["https://list.test/p/contoh-1", "https://list.test/p/contoh-2"]
    assert all(x["price"] is None for x in ex["listings"])


def test_generic_app_json_and_og_and_links():
    state = {"search": {"items": [
        {"id": 1, "title": "Villa Contoh 2BR", "url": "/listing/villa-contoh-1", "price": {"amount": 30000000, "currency": "IDR"},
         "bedrooms": 2, "location": {"lat": -8.65, "lng": 115.13}, "images": ["https://img.portal.test/1.jpg"]},
        {"id": 2, "title": "House Contoh", "url": "/listing/house-contoh-2", "price": "Rp 18 juta / bulan", "beds": 1}]}}
    ex = portals.extract_page_listings(html_page("", f"<script>window.__INITIAL_STATE__ = {json.dumps(state)};</script>"),
                                  "text/html", "https://portal.test/rent")
    assert ex["read"] == "app_json" and len(ex["listings"]) == 2
    a, b = ex["listings"]
    assert a["extras"]["guessed"] is True and a["url"] == "https://portal.test/listing/villa-contoh-1"
    assert (a["price"], a["currency"], a["bedrooms"], a["lat"], a["property_type"]) == (30_000_000, "IDR", 2, -8.65, "villa")
    assert (b["price"], b["currency"], b["period"], b["bedrooms"]) == (18_000_000, "IDR", "month", 1)
    og = html_page('<meta property="og:title" content="Villa Contoh 3BR, Rp 25 juta / bulan"><meta property="og:url" content="https://portal.test/listing/villa-3">'
                   '<meta property="og:image" content="/img/villa-3.jpg"><meta property="og:description" content="3 bedrooms, 210 m², pool">')
    ex = portals.extract_page_listings(og, "text/html", "https://portal.test/listing/villa-3")
    li = ex["listings"][0]
    assert ex["read"] == "og" and li["from"] == "og" and li["single_page_guess"] is False
    assert (li["price"], li["currency"], li["period"], li["area_m2"], li["bedrooms"]) == (25_000_000, "IDR", "month", 210, 3)
    assert li["photos"] == ["https://portal.test/img/villa-3.jpg"]
    links = "".join(f'<a href="/listing/flat-{n}00001">Flat {n}</a>' for n in range(1, 5)) + \
        '<a href="/about">About</a><a href="https://other.test/listing/x-100001">elsewhere</a><a href="/listing/flat-100001#photos">dup</a>'
    ex = portals.extract_page_listings(html_page('<meta property="og:title" content="Flats for rent">', links), "text/html", "https://portal.test/flats")
    assert ex["read"] == "list" and ex["listings"] == []
    assert [x["url"] for x in ex["links"]] == [f"https://portal.test/listing/flat-{n}00001" for n in range(1, 5)]


def test_adapter_failure_falls_back_to_generic(monkeypatch):
    def broken(body, base):
        raise KeyError("layout changed")
    monkeypatch.setitem(portals.LISTING_ADAPTERS, "4zida.rs", broken)
    ex = portals.extract_page_listings(zida_list_page(), "text/html", ZIDA)
    assert ex["read"] == "jsonld" and len(ex["listings"]) == 2 and ex["listings"][0]["from"] == "jsonld"


def test_sensitive_numbers_refuse_the_suggestion(web):
    pu = "https://portal.test/listing/flat-9"
    bad = ld({"@context": "https://schema.org", "@type": "Apartment", "url": pu, "name": "Flat, passport no. AB1234567 needed",
              "offers": {"@type": "Offer", "price": 500, "priceCurrency": "EUR"}})
    web.on("GET", "/listing/flat-9", page(html_page(bad)), host="portal.test")
    li = run(portals.listing_source_read(pu))["listings"][0]
    assert li["suggested"] is None and li["missing"][0].startswith("refused")


# ---------------------------------------------------------------- the tool: politeness and refusals

def test_tool_reads_a_portal_page_politely(web):
    web.on("GET", "/izdavanje-stanova/beograd", page(zida_list_page()), host="www.4zida.rs")
    out = run(portals.listing_source_read(ZIDA))
    assert out["read"] == "adapter" and out["total"] == 2 and not out["from_cache"] and out["site_name"] == "4zida.rs"
    assert out["next_url"].endswith("?strana=2") and out["final_url"] == ZIDA
    li = by_id(out["listings"])[Z1]
    assert li["suggested"]["listing_id"] == f"4zida-{Z1}" and li["suggested"]["price"] == 700
    assert [r.url.path for r in web.requests] == ["/robots.txt", "/izdavanje-stanova/beograd"]
    assert all(r.headers["user-agent"] == "HuntBot/1.0 (+read-only)" for r in web.requests)
    assert web.sleeps and 0.9 <= web.sleeps[-1] <= 1.0  # ≤ 1 request/s per host
    again = run(portals.listing_source_read(ZIDA, max_listings=1))
    assert again["from_cache"] and len(again["listings"]) == 1 and len(web.requests) == 2  # cached 6 h


def test_tool_blocked_sites_answer_without_a_request(web):
    for u in ("https://krisha.kz/arenda/kvartiry/almaty/", "https://home.ss.ge/en/real-estate", "https://www.olx.co.id/bali_g2000002",
              "https://www.lamudi.co.id/sewa/", "https://www.fazwaz.com/property-for-rent/thailand", "https://www.sahibinden.com/kiralik"):
        out = run(portals.listing_source_read(u))
        assert out["skipped"] == "blocked" and out["open_by_hand"] is True and "by hand" in out["why"], u
    assert not web.requests


def test_tool_refuses_social_airbnb_and_private(web):
    for u in ("https://www.facebook.com/marketplace/denpasar/propertyrentals", "https://www.instagram.com/some.villas/",
              "https://t.me/some_rent_chat/12", "https://www.airbnb.com/rooms/1", "https://www.airbnb.co.id/rooms/2"):
        with pytest.raises(ToolError, match="not read here"):
            run(portals.listing_source_read(u))
    for bad in ("http://portal.test/rent", "https://10.0.0.7/rent", "https://localhost/rent", "ftp://portal.test/"):
        with pytest.raises(ToolError, match="public https"):
            run(portals.listing_source_read(bad))
    with pytest.raises(ToolError, match="1..100"):
        run(portals.listing_source_read("https://portal.test/rent", max_listings="many"))
    assert not web.requests


def test_tool_robots_wildcards_skip_filtered_searches(web):
    web.on("GET", "/robots.txt", httpx.Response(200, text="User-agent: *\nDisallow: /*/?*maxPrice=*\nCrawl-delay: 3\n",
                                                headers={"content-type": "text/plain"}), host="strict.test")
    web.on("GET", "/sewa/bali/", page(html_page(single_listing_ld("https://strict.test/sewa/bali/"))), host="strict.test")
    out = run(portals.listing_source_read("https://strict.test/sewa/bali/?maxPrice=20000000"))
    assert out["skipped"] == "robots" and "plain area page" in out["why"] and not web.hits("GET", "/sewa/bali/", "strict.test")
    assert run(portals.listing_source_read("https://strict.test/sewa/bali/"))["total"] == 1
    assert web.sleeps[-1] > 2.5 and len(web.hits("GET", "/robots.txt", "strict.test")) == 1  # Crawl-delay, robots cached
    web.on("GET", "/robots.txt", httpx.Response(503, text="down"), host="down.test")
    assert run(portals.listing_source_read("https://down.test/rent"))["skipped"] == "robots"
    assert not web.hits("GET", "/rent", "down.test")


def test_tool_noindex_403_challenge_and_errors(web):
    body = html_page(single_listing_ld("https://n.test/a"))
    web.on("GET", "/a", page(body.replace("<head>", '<head><meta name="robots" content="noindex, follow">')), host="n.test")
    web.on("GET", "/b", page(body, {"X-Robots-Tag": "noindex"}), host="n.test")
    for p in ("/a", "/b"):
        out = run(portals.listing_source_read("https://n.test" + p))
        assert out["skipped"] == "noindex" and "listings" not in out, p
    web.on("GET", "/rent", page("<html>Forbidden</html>", status=403), host="wall.test")
    out = run(portals.listing_source_read("https://wall.test/rent"))
    assert out["skipped"] == "blocked" and out["status"] == 403 and out["open_by_hand"] and "by hand" in out["why"]
    web.on("GET", "/rent", page("<html>slow down</html>", status=468), host="wall2.test")
    assert run(portals.listing_source_read("https://wall2.test/rent"))["skipped"] == "blocked"
    web.on("GET", "/rent", page("<html><head><title>Just a moment...</title></head><body>checking</body></html>"), host="cf.test")
    out = run(portals.listing_source_read("https://cf.test/rent"))
    assert out["skipped"] == "blocked" and "bot challenge" in out["why"]
    assert run(portals.listing_source_read("https://cf.test/rent"))["from_cache"]  # not hammered again within 6 h
    web.on("GET", "/gone", page("gone", status=404), host="e.test")
    with pytest.raises(ToolError, match="answered 404"):
        run(portals.listing_source_read("https://e.test/gone"))
    web.on("GET", "/busy", page("busy", status=502), host="e.test")
    with pytest.raises(ToolError, match="answered 502"):
        run(portals.listing_source_read("https://e.test/busy"))
    web.on("GET", "/go", httpx.Response(302, headers={"location": "https://127.0.0.1/admin"}), host="e.test")
    with pytest.raises(ToolError, match="public https"):
        run(portals.listing_source_read("https://e.test/go"))


def test_docstring_teaches_the_rules():
    doc = portals.listing_source_read.__doc__ or ""
    for s in ("ONE", "never crawl", "robots.txt", "1 request/s", "6 h", "noindex", "open it by hand in the hunter's browser", "per year", "Nothing is converted silently", "link,\n    don't store",
              "BLOCKED_SITES", "Airbnb", "owner_or_agent", "listing_upsert"):
        assert s in doc, s
    assert "it's not\n    a source for this tool" in doc or "it's not a source for this tool" in doc
    assert "rentor.ge" in doc and "4zida.rs" in doc and "rumah123.com" in doc
