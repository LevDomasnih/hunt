"""Wave 4 tools (places, location score, flood, bikes, 3D scans, dossier, things) against a mocked CRM and mocked
Google / Valhalla / Open-Meteo (one httpx.MockTransport routing by host). No network."""
import asyncio
import json
from pathlib import Path
from urllib.parse import quote

import httpx
import pytest

import hunt_core as hc
from hunt_core import ToolError

URL = "https://crm.test"
TOKEN = "hunt_test_token"
CRM = "crm.test"
GOOGLE = "www.google.com"
VALHALLA = "valhalla1.openstreetmap.de"
METEO = "api.open-meteo.com"


def run(coro):
    return asyncio.run(coro)


class FakeNet:
    """Routes requests by (METHOD, host, path); records every request."""

    def __init__(self):
        self.requests: list[httpx.Request] = []
        self.routes = {}

    def on(self, method, path, fn_or_data, status=200, host=CRM):
        self.routes[(method, host, path)] = (fn_or_data, status)

    def __call__(self, req: httpx.Request) -> httpx.Response:
        self.requests.append(req)
        key = (req.method, req.url.host, req.url.path)
        if key not in self.routes:
            return httpx.Response(404, json={"error": "not_found", "message": f"{req.method} {req.url.host}{req.url.path}"})
        h, status = self.routes[key]
        data = h(req) if callable(h) else h
        if isinstance(data, httpx.Response):
            return data
        if isinstance(data, (str, bytes)):
            return httpx.Response(status, content=data.encode() if isinstance(data, str) else data)
        return httpx.Response(status, json=data)

    def to(self, host, method=None, path=None):
        return [r for r in self.requests if r.url.host == host and (method is None or r.method == method)
                and (path is None or r.url.path == path)]

    def last(self, method, path, host=CRM):
        hits = self.to(host, method, path)
        assert hits, f"no request {method} {host}{path}"
        return hits[-1]


def body(req):
    return json.loads(req.content)


@pytest.fixture
def net(monkeypatch, isolated):
    fake = FakeNet()
    monkeypatch.setattr(hc, "_TRANSPORT", httpx.MockTransport(fake))
    monkeypatch.setattr(hc, "_VALHALLA_MIN_INTERVAL", 0)
    monkeypatch.setattr(hc, "_OPEN_METEO_MIN_INTERVAL", 0)
    sleeps = []

    async def no_sleep(s):
        sleeps.append(s)
    monkeypatch.setattr(hc, "_sleep", no_sleep)
    fake.sleeps = sleeps
    hc.update_config(lambda c: c.__setitem__("api_url", URL))
    isolated.set_password("hunt", URL, TOKEN)
    return fake


ALL_TYPES = ("beach", "surf", "coworking", "gym", "yoga", "supermarket", "market", "hospital", "pharmacy", "coffee", "food", "daytrip")


@pytest.fixture
def regions(tmp_path, monkeypatch):
    root = tmp_path / "regions"
    bl = root / "bl"
    (bl / "town").mkdir(parents=True)
    (bl / "pack.yaml").write_text("id: bl\nname: {en: Bl}\ncurrency: IDR\n", encoding="utf-8")
    (bl / "town" / "pack.yaml").write_text("id: town\nname: {en: Town}\ntravel: {mode: scooter, rush_factor: 1.5}\n", encoding="utf-8")
    types = "\n".join(f"  {t}: {{weight_default: 1.0}}" for t in ALL_TYPES)
    (bl / "places.yaml").write_text(f"version: 1\ntypes:\n{types}\nplaces: []\n", encoding="utf-8")
    (bl / "calendar.yaml").write_text("verified: 2026-11\nevents: []\n", encoding="utf-8")
    (bl / "districts.yaml").write_text(
        "verified: 2026-11\nareas:\n"
        "  north:\n    name: {en: \"North\", ru: \"Север\"}\n"
        "    flood: {level: medium, note: {en: \"Low-lying rice fields flood in January.\", ru: \"Низина у рисовых полей, в январе топит.\"}}\n"
        "  south:\n    name: {en: \"South\", ru: \"Юг\"}\n    flood: {level: low, note: {en: \"Limestone plateau.\", ru: \"Известняковое плато.\"}}\n",
        encoding="utf-8")
    geo = {"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": {"id": "north"}, "geometry": {"type": "Polygon", "coordinates": [[[115.0, -8.7], [115.3, -8.7], [115.3, -8.5], [115.0, -8.5], [115.0, -8.7]]]}},
        {"type": "Feature", "properties": {"id": "south"}, "geometry": {"type": "Polygon", "coordinates": [[[115.0, -9.0], [115.3, -9.0], [115.3, -8.7], [115.0, -8.7], [115.0, -9.0]]]}},
    ]}
    (bl / "districts.geojson").write_text(json.dumps(geo), encoding="utf-8")
    kz = root / "kz" / "almaty"
    kz.mkdir(parents=True)
    (root / "kz" / "pack.yaml").write_text("id: kz\nname: {en: KZ}\ndrive: car\n", encoding="utf-8")
    (kz / "pack.yaml").write_text("id: almaty\nname: {en: Almaty}\n", encoding="utf-8")
    monkeypatch.setenv("HUNT_REGIONS", str(root))
    return root


def search_route(net, region="bl/town", sid="s1"):
    net.on("GET", f"/api/searches/{sid}", {"search": {"id": sid, "region": region, "brief": {}}})


# ---------------------------------------------------------------- places: parsing

def getlist_payload(items, name="Мои места"):
    author = ["Secret Author", "https://lh3.googleusercontent.com/avatar-secret", "112233445566778899"]
    d = [[["LISTID123", 1], None, None, author, name, None, None, None, items]]
    return ")]}'\n" + json.dumps(d, ensure_ascii=False)


def gl_item(name, lat, lng, addr=None, note=None):
    return [None, [None, None, None, None, addr, [None, None, lat, lng]], name, note]


def test_parse_getlist_reads_only_place_fields():
    text = getlist_payload([gl_item("Crate Cafe", -8.65, 115.13, "Jl. Pantai Batu Mejan", "лучший завтрак"),
                            gl_item("No coords", None, None), [None], "junk"])
    name, items = hc.parse_getlist(text)
    assert name == "Мои места"
    assert items == [{"name": "Crate Cafe", "lat": -8.65, "lng": 115.13, "note": "лучший завтрак", "address": "Jl. Pantai Batu Mejan"}]
    with pytest.raises(ToolError, match="private"):
        hc.parse_getlist("<html>consent</html>")


def test_places_import_google_list_short_link(net, regions):
    search_route(net)
    share = "https://www.google.com/maps/@/data=!3m1!4b1!4m3!11m2!2sLISTID123!3e3?g_st=ic"
    net.on("GET", "/LW54Kv", lambda r: httpx.Response(302, headers={"location": share}), host="maps.app.goo.gl")
    items = [
        gl_item("Crate Cafe", -8.6512, 115.1345, "Jl. Pantai Batu Mejan", "Лучший завтрак!!!"),
        gl_item("Warung Bu Mi", -8.66, 115.14, "Jl. Raya", "дорого и так себе"),
        gl_item("The Pantry", -8.67, 115.15, "Jl. Kayu Aya"),
        gl_item("Pepito Market", -8.68, 115.16, None),
        gl_item("Crate Cafe", -8.65121, 115.13451, "dup"),  # same name + point to 4 decimals: deduped
    ]
    net.on("GET", "/maps/preview/entitylist/getlist", getlist_payload(items), host=GOOGLE)

    def post(req):
        places = body(req)["places"]
        return {"added": len(places), "updated": 0,
                "places": [{"id": f"pl_{i}", "ext_key": p["ext_key"]} for i, p in enumerate(places)]}
    net.on("POST", "/api/searches/s1/places", post)
    out = run(hc.places_import("s1", url="https://maps.app.goo.gl/LW54Kv"))
    assert out["added"] == 4 and out["list_name"] == "Мои места"
    assert out["by_type"] == {"coffee": 1, "food": 1, "other": 1, "supermarket": 1}
    assert out["unresolved"][0]["name"] == "The Pantry" and out["unresolved"][0]["place_id"] == "pl_2"
    assert "place_set" in out["unresolved_hint"]
    raw = net.last("POST", "/api/searches/s1/places").content.decode()
    for leak in ("Secret Author", "avatar-secret", "112233445566778899"):
        assert leak not in raw and leak not in json.dumps(out)
    sent = body(net.last("POST", "/api/searches/s1/places"))["places"]
    crate = sent[0]
    assert crate == {"name": "Crate Cafe", "lat": -8.6512, "lng": 115.1345, "type": "coffee", "tier": 1, "note": "Лучший завтрак!!!",
                     "address": "Jl. Pantai Batu Mejan", "url": "https://www.google.com/maps/search/?api=1&query=-8.6512,115.1345",
                     "source": "google_list", "list_name": "Мои места", "ext_key": "crate cafe@-8.6512,115.1345"}
    assert sent[1]["tier"] == 3 and sent[2]["tier"] == 2
    short = net.to("maps.app.goo.gl")[0]
    assert "Chrome" not in short.headers["user-agent"]  # a browser UA gets a JS page instead of the redirect
    gl = net.to(GOOGLE)[0]
    assert "Chrome" in gl.headers["user-agent"] and "CONSENT=YES+" in gl.headers.get("cookie", "")
    assert "!1sLISTID123!" in str(gl.url)


def test_places_import_consent_redirect_and_batches(net, regions):
    search_route(net)
    share = "https://www.google.com/maps/@/data=!4m3!11m2!2sLISTID999!3e3"
    consent = "https://consent.google.com/ml?continue=" + quote(share, safe="") + "&gl=DE"
    net.on("GET", "/abc", lambda r: httpx.Response(302, headers={"location": consent}), host="maps.app.goo.gl")
    net.on("GET", "/ml", "<html>consent</html>", host="consent.google.com")
    items = [gl_item(f"Spot {i}", -8.6 - i / 1000, 115.1, None) for i in range(250)]
    net.on("GET", "/maps/preview/entitylist/getlist", getlist_payload(items), host=GOOGLE)
    net.on("POST", "/api/searches/s1/places", lambda r: {"added": len(body(r)["places"]), "updated": 0, "places": []})
    out = run(hc.places_import("s1", url="https://maps.app.goo.gl/abc", types={"Spot 0": "surf"}))
    posts = net.to(CRM, "POST", "/api/searches/s1/places")
    assert [len(body(p)["places"]) for p in posts] == [200, 50]
    assert out["added"] == 250 and out["by_type"]["surf"] == 1 and "!1sLISTID999!" in str(net.to(GOOGLE)[0].url)
    with pytest.raises(ToolError, match="not a place type"):
        run(hc.places_import("s1", url="https://maps.app.goo.gl/abc", types={"Spot 1": "spa"}))


KML = """<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Bali map</name>
<Folder><name>Surf spots</name>
  <Placemark><name>Batu Bolong</name><Point><coordinates>115.1305,-8.6595,0</coordinates></Point></Placemark>
</Folder>
<Folder><name>Food</name>
  <Placemark><name>Milk &amp; Madu</name><description><![CDATA[<b>Best</b> brunch<br>go early]]></description>
    <Point><coordinates>
      115.14,-8.65,0
    </coordinates></Point></Placemark>
  <Placemark><name>Route</name><LineString><coordinates>115.1,-8.6,0 115.2,-8.7,0</coordinates></LineString></Placemark>
</Folder>
<Placemark><name>Loose pin</name><Point><coordinates>115.2,-8.8,0</coordinates></Point></Placemark>
</Document></kml>"""


def test_parse_kml_layers_notes_points():
    name, items = hc.parse_kml(KML)
    assert name == "Bali map"
    assert [(i["name"], i["layer"]) for i in items] == [("Batu Bolong", "Surf spots"), ("Milk & Madu", "Food"), ("Loose pin", None)]
    assert items[1]["note"] == "Best brunch\ngo early" and items[1]["lat"] == -8.65 and items[1]["lng"] == 115.14


def test_places_import_my_maps(net, regions):
    search_route(net)
    net.on("GET", "/maps/d/kml", KML, host=GOOGLE)
    net.on("POST", "/api/searches/s1/places", {"added": 3, "updated": 0, "places": []})
    out = run(hc.places_import("s1", url="https://www.google.com/maps/d/viewer?mid=1AbC-xyz&ll=-8.6,115.1&z=12"))
    req = net.to(GOOGLE)[0]
    assert req.url.params["mid"] == "1AbC-xyz" and req.url.params["forcekml"] == "1"
    sent = body(net.last("POST", "/api/searches/s1/places"))["places"]
    assert [(p["name"], p["type"], p["tier"], p["source"]) for p in sent] == [
        ("Batu Bolong", "surf", 2, "my_maps"), ("Milk & Madu", "food", 1, "my_maps"), ("Loose pin", "other", 2, "my_maps")]
    assert out["list_name"] == "Bali map" and out["unresolved"][0]["name"] == "Loose pin"


def test_single_place_link(net, regions):
    search_route(net)
    net.on("POST", "/api/searches/s1/places", {"added": 1, "updated": 0, "places": []})
    link = "https://www.google.com/maps/place/Crate+Cafe/@-8.65,115.13,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x1!8m2!3d-8.6512!4d115.1345!16s%2Fg%2F11"
    run(hc.places_import("s1", url=link))
    p = body(net.last("POST", "/api/searches/s1/places"))["places"][0]
    assert (p["name"], p["lat"], p["lng"], p["source"], p["type"], p["url"]) == ("Crate Cafe", -8.6512, 115.1345, "google_place", "coffee", link)
    assert not net.to(GOOGLE)  # nothing fetched for a place link
    assert hc.classify_maps_url("https://www.google.com/maps?q=-8.7,115.2") == ("place", {"name": None, "lat": -8.7, "lng": 115.2})
    with pytest.raises(ToolError, match="saved list"):
        hc.classify_maps_url("https://example.com/whatever")


def test_places_import_local_json_with_source_sibling(net, regions, tmp_path):
    search_route(net)
    d = tmp_path / "places"
    d.mkdir()
    (d / "bali-mesta.json").write_text(json.dumps([
        {"name": "Revolver Espresso", "lat": -8.69, "lon": 115.16, "addr": "Jl. Pantai Seminyak", "note": "", "district": "Семиньяк"},
        {"name": "Revolver Espresso", "lat": -8.69, "lon": 115.16, "addr": "dup"},
        {"name": "No coords", "lat": None, "lon": None},
        {"name": "Mystery", "lat": -8.7, "lng": 115.17, "address": "Jl. Pantai Kuta"},
    ], ensure_ascii=False), encoding="utf-8")
    (d / "bali-mesta.source.json").write_text(json.dumps({"source": "https://maps.app.goo.gl/LIST", "list_id": "X", "name": "Бали: места"}), encoding="utf-8")
    out = run(hc.places_import("s1", path=str(d / "bali-mesta.json"), dry_run=True))
    assert out["dry_run"] and out["count"] == 2 and out["skipped"] == 1 and out["list_name"] == "Бали: места"
    assert out["by_type"] == {"coffee": 1, "beach": 1}  # "Mystery" falls back to its address (Pantai → beach)
    assert not net.to(CRM, "POST")
    net.on("POST", "/api/searches/s1/places", {"added": 2, "updated": 0, "places": []})
    run(hc.places_import("s1", path=str(d / "bali-mesta.json"), list_name="Мой список"))
    p = body(net.last("POST", "/api/searches/s1/places"))["places"][0]
    assert p["address"] == "Jl. Pantai Seminyak" and p["lng"] == 115.16 and p["url"] == "https://maps.app.goo.gl/LIST"
    assert p["source"] == "google_list" and p["list_name"] == "Мой список" and "note" not in p
    with pytest.raises(ToolError, match="exactly one"):
        run(hc.places_import("s1"))


def test_dry_run_preview_limits_items(net, regions):
    search_route(net)
    net.on("GET", "/maps/preview/entitylist/getlist", getlist_payload([gl_item(f"Gym {i}", -8.6, 115.1 + i / 100) for i in range(30)]), host=GOOGLE)
    out = run(hc.places_import("s1", url="https://www.google.com/maps/@/data=!4m3!11m2!2sLISTID123!3e3", dry_run=True))
    assert out["count"] == 30 and len(out["items"]) == 20 and out["by_type"] == {"gym": 30} and not out["unresolved"]
    assert not net.to(CRM, "POST")


def test_type_and_tier_rules():
    t = hc.infer_place_type
    assert t("Single Fin Beach Club") == "nightlife"
    assert t("Pantai Mengening") == "beach"
    assert t("Warung Bu Mi") == "food"
    assert t("Revolver Espresso", "Jl. Pantai Seminyak") == "coffee"  # the name wins over the address
    assert t("Crate", "Jl. Pantai Batu Mejan") == "beach"  # address only as a fallback
    assert t("Pepito Market") == "supermarket" and t("Pasar Badung") == "market"
    assert t("Kimia Farma") == "pharmacy" and t("BIMC Hospital") == "hospital" and t("RS Siloam") == "hospital"
    assert t("Dojo Bali") == "coworking" and t("The Yoga Barn") == "yoga" and t("Body Factory", note="лучший зал") == "gym"
    assert t("Kitchen & Bar") == "food" and t("La Favela", note="бар") == "nightlife"
    assert t("Кофейня у моря") == "coffee" and t("Old Man's", note="surf bar") == "surf"
    assert t("Tirta Empul Temple") == "daytrip" and t("Pura Luhur") == "daytrip"
    assert t("Batu Bolong", layer="Surf spots") == "surf"
    assert t("The Pantry") is None
    tier = hc.infer_place_tier
    assert tier("лучший кофе") == 1 and tier("🔥🔥") == 1 and tier("my favourite") == 1 and tier("must try!!!") == 1
    assert tier("дорого, но лучший") == 3 and tier("meh") == 3 and tier("overpriced, avoid") == 3
    assert tier("") == 2 and tier(None) == 2 and tier("open till 22") == 2
    assert hc.place_ext_key(" Crate Cafe ", -8.651249, 115.13456) == "crate cafe@-8.6512,115.1346"


def test_places_list_and_place_set(net, regions):
    net.on("GET", "/api/searches/s1/places", {"places": [], "base": {"count": 90, "types": {}}})
    assert run(hc.places_list("s1"))["base"]["count"] == 90
    net.on("PATCH", "/api/places/pl_1", lambda r: {"place": body(r)})
    assert run(hc.place_set("pl_1", type="construction", tier=3, hidden=True))["place"] == {"type": "construction", "tier": 3, "hidden": True}
    assert run(hc.place_set("pl_1", type="beach"))["place"] == {"type": "beach"}
    with pytest.raises(ToolError, match="type must be"):
        run(hc.place_set("pl_1", type="spa"))
    with pytest.raises(ToolError, match="tier"):
        run(hc.place_set("pl_1", tier=4))
    with pytest.raises(ToolError, match="Nothing"):
        run(hc.place_set("pl_1"))
    net.on("DELETE", "/api/places/pl_1", {"ok": True})
    assert run(hc.place_set("pl_1", delete=True)) == {"ok": True}


# ---------------------------------------------------------------- location score

def iso_response(contours=(40.0, 20.0, 10.0)):
    feats = []
    for i, c in enumerate(contours):
        d = 0.01 * (3 - i)
        feats.append({"type": "Feature", "properties": {"contour": c, "metric": "time", "color": "#bf4040"},
                      "geometry": {"type": "Polygon", "coordinates": [[[115.123456789, -8.8], [115.13 + d, -8.8 - d], [115.123456789, -8.8]]]}})
    return {"type": "FeatureCollection", "features": feats}


def location_routes(net, region="bl/town", has_iso=(False, True)):
    search_route(net, region)
    net.on("GET", "/api/searches/s1/locations", [{"listing_id": "l1", "title": "A", "score": None, "has_isochrones": has_iso[0]},
                                                 {"listing_id": "l2", "title": "B", "score": 70, "has_isochrones": has_iso[1]}])
    net.on("GET", "/api/searches/s1/listings", [{"id": "l1", "lat": -8.835, "lng": 115.17, "status": "new"},
                                                {"id": "l2", "lat": -8.80, "lng": 115.16, "status": "new"},
                                                {"id": "l3", "lat": None, "lng": None, "status": "new"}])
    net.on("PUT", "/api/listings/l1/isochrones", {"location": {"score": 64}})
    net.on("PUT", "/api/listings/l2/isochrones", {"location": {"score": 71}})


def test_location_refresh_body_rings_and_cache(net, regions):
    location_routes(net)
    net.on("POST", "/isochrone", iso_response(), host=VALHALLA)
    out = run(hc.location_refresh("s1"))
    assert out["updated"] == [{"listing_id": "l1", "score": 64}] and out["requests"] == 1
    assert out["rush_factor"] == 1.5 and out["costing"] == "motor_scooter" and out["skipped"][0]["listing_id"] == "l2"
    assert out["ring_set"] == [10, 20, 40] and out["ring_weights"] == [1.0, 0.7, 0.3] and "+50%" in out["rush_note"]
    vb = body(net.to(VALHALLA)[0])
    assert vb["locations"] == [{"lat": -8.835, "lon": 115.17, "search_filter": {"min_road_class": "tertiary", "max_road_class": "primary"}}]
    assert vb["contours"] == [{"time": 10.0}, {"time": 20.0}, {"time": 40.0}]  # free-flow: not divided by rush
    assert vb["costing"] == "motor_scooter" and vb["polygons"] is True and vb["denoise"] == 0.3 and vb["generalize"] == 15
    put = body(net.last("PUT", "/api/listings/l1/isochrones"))
    assert put["costing"] == "motor_scooter" and put["rush"] == 1.5 and put["rings"] == [10, 20, 40]
    feats = put["geo"]["features"]
    assert [f["properties"] for f in feats] == [{"ring": 10}, {"ring": 20}, {"ring": 40}]
    assert feats[0]["geometry"]["coordinates"][0][1] == [115.14, -8.81]  # the 10.0 contour is the 10-minute ring
    assert feats[2]["geometry"]["coordinates"][0][0] == [115.12346, -8.8]  # rounded to 5 decimals
    run(hc.location_refresh("s1"))  # served from the disk cache
    assert len(net.to(VALHALLA)) == 1 and len(net.to(CRM, "PUT", "/api/listings/l1/isochrones")) == 2
    run(hc.location_refresh("s1", listing_ids=["l2"], force=True))  # force: new request, even for l2
    assert len(net.to(VALHALLA)) == 2


def test_location_refresh_kz_uses_auto_and_default_rush(net, regions):
    location_routes(net, region="kz/almaty", has_iso=(False, False))
    net.on("POST", "/isochrone", iso_response((40.1, 19.9, 10.0)), host=VALHALLA)
    out = run(hc.location_refresh("s1", listing_ids=["l1"]))
    vb = body(net.to(VALHALLA)[0])
    assert vb["costing"] == "auto" and out["costing"] == "auto" and out["rush_factor"] == 1.3
    assert vb["contours"] == [{"time": 10.0}, {"time": 20.0}, {"time": 40.0}]
    put = body(net.last("PUT", "/api/listings/l1/isochrones"))
    assert [f["properties"]["ring"] for f in put["geo"]["features"]] == [10, 20, 40]


def test_isochrone_rings_without_contour_uses_order():
    geo = iso_response()
    for f in geo["features"]:
        del f["properties"]["contour"]
    rings = hc.isochrone_rings(geo, [10, 20, 40])
    assert [f["properties"]["ring"] for f in rings["features"]] == [10, 20, 40]
    assert rings["features"][2]["geometry"]["coordinates"][0][1] == [115.16, -8.83]  # first (largest) = 40 min
    assert hc.isochrone_body(0, 0, "auto", [10, 20, 40])["contours"] == [{"time": 10.0}, {"time": 20.0}, {"time": 40.0}]


def test_location_refresh_backoff_and_budget(net, regions):
    location_routes(net, has_iso=(False, False))
    calls = []

    def flaky(req):
        calls.append(1)
        if len(calls) <= 2:
            return httpx.Response(429, json={"error": "rate"})
        return httpx.Response(200, json=iso_response())
    net.on("POST", "/isochrone", flaky, host=VALHALLA)
    out = run(hc.location_refresh("s1", max_requests=4))
    assert net.sleeps[:2] == [2, 4] and len(calls) == 4  # l1: 429, 429, 200; l2: 200
    assert out["requests"] == 4 and len(out["updated"]) == 2 and out["note"] is None


def test_location_refresh_budget_note_and_giving_up(net, regions):
    location_routes(net, has_iso=(False, False))
    net.on("POST", "/isochrone", iso_response(), host=VALHALLA)
    out = run(hc.location_refresh("s1", max_requests=1))
    assert len(out["updated"]) == 1 and "max_requests" in out["note"]
    net.on("POST", "/isochrone", {"error": "down"}, status=503, host=VALHALLA)
    with pytest.raises(ToolError, match="kept failing"):
        run(hc.location_refresh("s1", force=True))
    assert net.sleeps[-3:] == [2, 4, 8]


def test_location_get(net):
    net.on("GET", "/api/listings/l1/location", {"location": None, "has_isochrones": False})
    assert run(hc.location_get("l1"))["has_isochrones"] is False


# ---------------------------------------------------------------- flood

def test_flood_levels():
    assert [hc.terrain_level(d) for d in (-7, -6, -3, -2.5, -2, 5)] == ["high", "high", "medium", "medium", "low", "low"]
    assert hc.combine_flood("low", "medium") == "medium" and hc.combine_flood("high", "low") == "high"
    assert hc.combine_flood("low", "low") == "low" and hc.combine_flood("low", None, 3) == "medium"
    assert hc.combine_flood("medium", "low", 5) == "high" and hc.combine_flood("high", None, 9) == "high"
    assert hc.combine_flood("low", "low", 2) == "low"
    pts = hc.flood_points(-8.8, 115.1)
    assert len(pts) == 17 and pts[0] == (-8.8, 115.1)
    assert abs(pts[1][0] - (-8.8 + 150 / 111320)) < 1e-5 and abs(pts[9][0] - (-8.8 + 400 / 111320)) < 1e-5


def test_flood_refresh(net, regions):
    search_route(net)
    net.on("GET", "/api/me", {"user": {"id": "u1", "lang": "ru"}})
    net.on("GET", "/api/searches/s1/listings", [
        {"id": "l1", "lat": -8.8, "lng": 115.1, "status": "new"},                       # south (low), sits in a hole
        {"id": "l2", "lat": -8.6, "lng": 115.1, "status": "new"},                       # north (medium), above the ring
        {"id": "l3", "lat": -8.62, "lng": 115.2, "status": "new", "flood": {"level": "low"}},  # already estimated
    ])

    def elev(req):
        lats = req.url.params["latitude"].split(",")
        assert len(lats) == 17 and len(req.url.params["longitude"].split(",")) == 17
        center = 10.0 if lats[0] == "-8.80000" else 20.0
        ring = 17.0 if center == 10.0 else 18.0
        return {"elevation": [center] + [ring] * 16}
    net.on("GET", "/v1/elevation", elev, host=METEO)
    net.on("PUT", "/api/listings/l1/flood", {"flood": {}})
    net.on("PUT", "/api/listings/l2/flood", {"flood": {}})
    out = run(hc.flood_refresh("s1", chat_mentions={"l2": {"count": 3, "text": "Улица топит в январе"}}))
    assert out["updated"] == [{"listing_id": "l1", "level": "high", "diff": -7.0}, {"listing_id": "l2", "level": "high", "diff": 2.0}]
    assert out["skipped"] == [{"listing_id": "l3", "reason": "already estimated (force=True to redo)"}] and out["requests"] == 2
    b1 = body(net.last("PUT", "/api/listings/l1/flood"))
    assert b1["level"] == "high" and b1["terrain"] == {"elev": 10.0, "ring_mean": 17.0, "diff": -7.0, "ring_m": 400}
    assert b1["sources"][0] == {"kind": "terrain", "title": "Рельеф", "text": "Вилла на 7.0 м ниже окрестностей (среднее 16 точек в 150–400 м)."}
    assert b1["sources"][1] == {"kind": "area", "title": "Юг", "text": "Известняковое плато."}
    assert b1["summary"].startswith("Риск подтопления высокий.")
    b2 = body(net.last("PUT", "/api/listings/l2/flood"))
    assert [s["kind"] for s in b2["sources"]] == ["terrain", "chats", "area"]  # terrain low + area medium + 3 mentions → high
    assert b2["sources"][1]["title"] == "Чаты: 3 упоминаний" and "выше" in b2["sources"][0]["text"]
    run(hc.flood_refresh("s1", listing_ids=["l1"], force=True))  # elevations come from the disk cache
    assert len(net.to(METEO)) == 2


def test_flood_refresh_english_without_area(net, regions):
    search_route(net, region="kz/almaty")
    net.on("GET", "/api/me", {"user": {"id": "u1", "lang": "en"}})
    net.on("GET", "/api/searches/s1/listings", [{"id": "l1", "lat": 43.2, "lng": 76.9, "status": "new"}])
    net.on("GET", "/v1/elevation", {"elevation": [800.0] + [803.0] * 16}, host=METEO)
    net.on("PUT", "/api/listings/l1/flood", {"flood": {}})
    out = run(hc.flood_refresh("s1"))
    assert out["updated"][0]["level"] == "medium"
    b = body(net.last("PUT", "/api/listings/l1/flood"))
    assert b["sources"] == [{"kind": "terrain", "title": "Terrain", "text": "The villa is 3.0 m below its surroundings (mean of 16 points within 150–400 m)."}]


def test_flood_set_validates(net):
    net.on("PUT", "/api/listings/l1/flood", lambda r: {"flood": body(r)})
    out = run(hc.flood_set("l1", "high", "Street floods", [{"kind": "notes", "title": "Owner", "text": "Admitted it floods"}]))
    assert out["flood"]["level"] == "high"
    with pytest.raises(ToolError, match="level"):
        run(hc.flood_set("l1", "extreme", "x", []))
    with pytest.raises(ToolError, match="sources\\[0\\]"):
        run(hc.flood_set("l1", "low", "x", [{"kind": "rumor", "title": "a", "text": "b"}]))


# ---------------------------------------------------------------- bikes

def test_bike_set_refuses_original_passport(net):
    for dep in ("оригинал паспорта", "Passport", "passport + 1M"):
        with pytest.raises(ToolError, match="original passport"):
            run(hc.bike_set("s1", model="Scoopy", deposit=dep))
    assert not net.to(CRM)
    net.on("PUT", "/api/searches/s1/bikes/new", lambda r: {"bike": {"id": "bk_1", **body(r)}})
    for dep in ("копия паспорта + 1 млн", "passport copy", "1M IDR cash"):
        assert run(hc.bike_set("s1", model="Scoopy", deposit=dep))["bike"]["deposit"] == dep


def test_bike_set_with_payment_and_validation(net):
    net.on("PUT", "/api/searches/s1/bikes/new", lambda r: {"bike": {"id": "bk_1", **body(r)}})
    net.on("POST", "/api/bikes/bk_1/pay", lambda r: {"bike": {"id": "bk_1", "paid_until": body(r)["until"]}, "expense": {"id": "e1"}})
    out = run(hc.bike_set("s1", model="Honda Scoopy", plate="DK 1234 AB", price=1400000, currency="IDR", period="month",
                          checklist={"video": {"done": True}, "helmets": {"done": False, "note": "one only"}},
                          pay={"amount": 1400000, "paid_by": "u1", "until": "2026-12-20"}))
    put = body(net.last("PUT", "/api/searches/s1/bikes/new"))
    assert put["model"] == "Honda Scoopy" and put["period"] == "month" and "pay" not in put
    assert body(net.last("POST", "/api/bikes/bk_1/pay")) == {"amount": 1400000, "paid_by": "u1", "until": "2026-12-20"}
    assert out["bike"]["paid_until"] == "2026-12-20" and out["payment"]["expense"]["id"] == "e1"
    net.on("POST", "/api/bikes/bk_2/pay", {"bike": {"id": "bk_2"}, "expense": {}})
    run(hc.bike_set("s1", "bk_2", pay={"amount": 350000, "paid_by": "u1", "until": "2026-12-01", "currency": "IDR"}))
    assert not net.to(CRM, "PUT", "/api/searches/s1/bikes/bk_2")  # pay only: no PUT
    with pytest.raises(ToolError, match="period"):
        run(hc.bike_set("s1", model="X", period="year"))
    with pytest.raises(ToolError, match="checklist"):
        run(hc.bike_set("s1", model="X", checklist={"brakes": {"done": True}}))
    with pytest.raises(ToolError, match="pay needs"):
        run(hc.bike_set("s1", "bk_1", pay={"amount": 1}))
    with pytest.raises(ToolError, match="model"):
        run(hc.bike_set("s1", plate="DK 1"))
    with pytest.raises(ToolError, match="card"):
        run(hc.bike_set("s1", model="X", note="paid by 4111 1111 1111 1111"))
    net.on("DELETE", "/api/searches/s1/bikes/bk_1", {"ok": True})
    assert run(hc.bike_set("s1", "bk_1", delete=True)) == {"ok": True}
    net.on("GET", "/api/searches/s1/bikes", {"bikes": []})
    assert run(hc.bikes_get("s1")) == {"bikes": []}


# ---------------------------------------------------------------- 3D scans

def test_scan_prepare_usdz_small_and_missing_node(tmp_path, monkeypatch):
    u = tmp_path / "room.usdz"
    u.write_bytes(b"x")
    with pytest.raises(ToolError, match="GLB"):
        run(hc.scan_prepare(str(u)))
    g = tmp_path / "room.glb"
    g.write_bytes(b"g" * 2048)
    assert run(hc.scan_prepare(str(g))) == {"path": str(g), "size_mb": 0.0, "compressed": False, "steps": []}
    monkeypatch.setattr(hc.shutil, "which", lambda name: None)
    with pytest.raises(ToolError, match="Node.js"):
        run(hc.scan_prepare(str(g), max_mb=0.001))


def test_scan_prepare_compresses_big_file(tmp_path, monkeypatch):
    g = tmp_path / "big room.glb"
    g.write_bytes(b"g" * 5000)
    monkeypatch.setattr(hc.shutil, "which", lambda name: "/usr/local/bin/npx")
    calls = []

    def fake_run(cmd, cwd, timeout):
        calls.append((cmd, timeout))
        out = Path(cmd[5])
        out.write_bytes(b"c" * (2000 if len(calls) == 1 else 500))
        return hc.subprocess.CompletedProcess(cmd, 0, "", "")
    monkeypatch.setattr(hc, "_run_cmd", fake_run)
    out = run(hc.scan_prepare(str(g), max_mb=0.001))  # limit 1048 bytes
    assert out["compressed"] and len(out["steps"]) == 2 and Path(out["path"]).read_bytes() == b"c" * 500
    assert Path(out["path"]).parent == hc.config_dir() / "scans" and Path(out["path"]).name == "big_room.min.glb"
    cmd, timeout = calls[0]
    assert cmd[:5] == ["/usr/local/bin/npx", "--yes", "@gltf-transform/cli", "optimize", str(g)] and timeout == 600
    assert cmd[6:] == ["--compress", "meshopt", "--texture-compress", "webp", "--texture-size", "2048"]
    assert calls[1][0][-1] == "1024"

    def failing(cmd, cwd, timeout):
        return hc.subprocess.CompletedProcess(cmd, 1, "", "Error: bad glb")
    monkeypatch.setattr(hc, "_run_cmd", failing)
    with pytest.raises(ToolError, match="bad glb"):
        run(hc.scan_prepare(str(g), max_mb=0.001))

    def too_big(cmd, cwd, timeout):
        Path(cmd[5]).write_bytes(b"c" * 4000)
        return hc.subprocess.CompletedProcess(cmd, 0, "", "")
    monkeypatch.setattr(hc, "_run_cmd", too_big)
    with pytest.raises(ToolError, match="still"):
        run(hc.scan_prepare(str(g), max_mb=0.001))


def test_scan_upload_multipart_and_scan_rows(net, tmp_path):
    g = tmp_path / "kitchen.glb"
    g.write_bytes(b"glTF" + b"\0" * 100)
    net.on("POST", "/api/listings/l1/scans", {"scan": {"id": "sc_1"}, "document": {"id": "d1"}})
    out = run(hc.scan_upload("l1", str(g), "Kitchen", phase="moveout", app="Scaniverse", scan_id="sc_1"))
    assert out["scan"]["id"] == "sc_1" and out["prepared"] == {"size_mb": 0.0, "compressed": False}
    req = net.last("POST", "/api/listings/l1/scans")
    assert req.headers["content-type"].startswith("multipart/form-data")
    raw = req.content
    assert b'name="file"; filename="kitchen.glb"' in raw and b"model/gltf-binary" in raw
    for field in (b'name="room"\r\n\r\nKitchen', b'name="phase"\r\n\r\nmoveout', b'name="app"\r\n\r\nScaniverse', b'name="scan_id"\r\n\r\nsc_1'):
        assert field in raw
    with pytest.raises(ToolError, match="phase"):
        run(hc.scan_upload("l1", str(g), "Kitchen", phase="later"))
    net.on("PUT", "/api/searches/s1/scans/new", lambda r: {"scan": body(r)})
    assert run(hc.scan_set("s1", room="Pool", phase="movein", status="todo", listing_id="l1"))["scan"] == {
        "listing_id": "l1", "room": "Pool", "phase": "movein", "status": "todo"}
    with pytest.raises(ToolError, match="status"):
        run(hc.scan_set("s1", "sc_1", status="done"))
    with pytest.raises(ToolError, match="room and phase"):
        run(hc.scan_set("s1", room="Pool"))
    net.on("GET", "/api/searches/s1/scans", {"scans": []})
    assert run(hc.scans_get("s1")) == {"scans": []}


# ---------------------------------------------------------------- dossier and things

def test_dossier_wrappers(net):
    net.on("GET", "/api/dossiers/match", lambda r: {"dossiers": [{"id": "ds_1", "q": r.url.params["listing_id"]}]})
    assert run(hc.dossier_match("l1"))["dossiers"][0]["q"] == "l1"
    net.on("GET", "/api/dossiers/ds_1", {"dossier": {"id": "ds_1", "items": []}})
    assert run(hc.dossier_get("ds_1"))["dossier"]["id"] == "ds_1"
    net.on("PUT", "/api/dossiers/new", lambda r: {"dossier": body(r)})
    out = run(hc.dossier_set(title="Villa Kenanga", listing_id="l1", lat=-8.8, lng=115.1, stats={"months": 6, "price": 25000000, "currency": "IDR"}))
    assert out["dossier"]["title"] == "Villa Kenanga" and out["dossier"]["stats"]["months"] == 6
    with pytest.raises(ToolError, match="title"):
        run(hc.dossier_set())
    with pytest.raises(ToolError, match="lat and lng"):
        run(hc.dossier_set("ds_1", lat=-8.8))
    with pytest.raises(ToolError, match="stats keys"):
        run(hc.dossier_set("ds_1", stats={"rating": 5}))
    net.on("POST", "/api/dossiers/ds_1/items", lambda r: {"item": body(r)})
    item = run(hc.dossier_item_add("ds_1", "power", "Power cut weekly", sentiment=-1, date="2026-10-01", search_id="s1"))["item"]
    assert item == {"kind": "power", "title": "Power cut weekly", "sentiment": -1, "date": "2026-10-01", "search_id": "s1"}
    with pytest.raises(ToolError, match="kind"):
        run(hc.dossier_item_add("ds_1", "gossip", "x"))
    with pytest.raises(ToolError, match="passport"):
        run(hc.dossier_item_add("ds_1", "other", "Owner", text="passport no. A1234567"))
    net.on("DELETE", "/api/dossier-items/di_1", {"ok": True})
    assert run(hc.dossier_item_delete("di_1")) == {"ok": True}


def test_items_wrappers(net):
    net.on("GET", "/api/searches/s1/items", {"items": [], "total": 0, "currency": "IDR", "resale_target": 0})
    assert run(hc.items_get("s1"))["currency"] == "IDR"
    net.on("PUT", "/api/searches/s1/items/new", lambda r: {"item": body(r)})
    assert run(hc.item_set("s1", name="Fan", price=350000, currency="IDR", icon="fan", bought_at="2026-11-02"))["item"] == {
        "name": "Fan", "price": 350000, "currency": "IDR", "icon": "fan", "bought_at": "2026-11-02"}
    with pytest.raises(ToolError, match="status"):
        run(hc.item_set("s1", "it_1", status="lost"))
    with pytest.raises(ToolError, match="name"):
        run(hc.item_set("s1", price=1))
    with pytest.raises(ToolError, match="price"):
        run(hc.item_set("s1", "it_1", price=-5))
    net.on("DELETE", "/api/searches/s1/items/it_1", {"ok": True})
    assert run(hc.item_set("s1", "it_1", delete=True)) == {"ok": True}


# ---------------------------------------------------------------- registry and region docs

def test_wave4_tools_registered():
    tools = run(hc.mcp.list_tools())
    names = {t.name for t in tools}
    assert {
        "places_import", "places_list", "place_set", "location_refresh", "location_get", "flood_refresh", "flood_set",
        "bike_set", "bikes_get", "scan_prepare", "scan_upload", "scan_set", "scans_get", "dossier_match", "dossier_get",
        "dossier_set", "dossier_item_add", "dossier_item_delete", "items_get", "item_set",
    } <= names
    assert all(t.description for t in tools)


def test_region_doc_reads_calendar_and_places(regions):
    assert {"calendar.yaml", "places.yaml"} <= set(hc.DOC_NAMES)
    assert run(hc.region_doc("bl/town", "places.yaml"))["level"] == "bl"
    assert "events" in run(hc.region_doc("bl", "calendar.yaml"))["content"]
    assert hc._place_types("bl/town") == set(ALL_TYPES) | {"nightlife", "construction", "other"}
