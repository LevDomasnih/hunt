"""Wave 5 tools (surf, guest guide, renewal "what next", search clone, negotiation, deal prices, recap, guests) and
the pack-configurable free-flow location rings, against a mocked CRM and a mocked Valhalla. No network."""
from _regions import real_regions
import asyncio
import json

import httpx
import pytest

import hunt_core as hc
from hunt_core import ToolError

URL = "https://crm.test"
TOKEN = "hunt_test_token"
CRM = "crm.test"
VALHALLA = "valhalla1.openstreetmap.de"


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
    monkeypatch.setattr(hc.owner_of("_TRANSPORT"), "_TRANSPORT", httpx.MockTransport(fake))
    monkeypatch.setattr(hc.owner_of("_VALHALLA_MIN_INTERVAL"), "_VALHALLA_MIN_INTERVAL", 0)

    async def no_sleep(s):
        pass
    monkeypatch.setattr(hc.owner_of("_sleep"), "_sleep", no_sleep)
    hc.update_config(lambda c: c.__setitem__("api_url", URL))
    isolated.set_password("hunt", URL, TOKEN)
    return fake


# ---------------------------------------------------------------- surf

def test_surf_forecast_get_and_refresh(net):
    view = {"home": {"lat": -8.8, "lng": 115.1, "label": "House", "source": "deal"}, "date": "2026-11-20", "tz": "Asia/Makassar",
            "spots": [{"id": "b:balangan", "stars": 3}], "best": "b:balangan", "updated_at": "x", "error": None}
    net.on("GET", "/api/searches/s1/surf", view)
    assert run(hc.surf_forecast("s1"))["best"] == "b:balangan"
    req = net.last("GET", "/api/searches/s1/surf")
    assert "refresh" not in req.url.params and req.headers["authorization"] == f"Bearer {TOKEN}"
    run(hc.surf_forecast("s1", refresh=True))
    assert net.last("GET", "/api/searches/s1/surf").url.params["refresh"] == "1"


def test_surf_forecast_error_mapping(net):
    net.on("GET", "/api/searches/s1/surf", {"error": "forbidden", "message": "not your search"}, status=403)
    with pytest.raises(ToolError, match="CRM 403 forbidden"):
        run(hc.surf_forecast("s1"))
    with pytest.raises(ToolError, match="Invalid id"):
        run(hc.surf_forecast("a/b"))


# ---------------------------------------------------------------- guide

def test_guide_get(net):
    net.on("GET", "/api/searches/s1/guide", {"guide": {"wifi_name": "Villa", "wifi_password_set": True, "rules": []}})
    assert run(hc.guide_get("s1"))["guide"]["wifi_password_set"] is True


def test_guide_set_normalizes_rules_and_keeps_wifi_password(net):
    net.on("PUT", "/api/searches/s1/guide", lambda req: {"guide": body(req)})
    run(hc.guide_set("s1", wifi_name="Villa_5G", wifi_password="kopi-susu-2026",
                     rules=["  Quiet after 22:00 ", {"icon": "shoe", "text": "Shoes off"}, {"icon": "", "text": "Gate closed"}],
                     map_url="https://maps.app.goo.gl/abc123", note=None))
    b = body(net.last("PUT", "/api/searches/s1/guide"))
    assert b == {"wifi_name": "Villa_5G", "wifi_password": "kopi-susu-2026", "map_url": "https://maps.app.goo.gl/abc123",
                 "rules": [{"text": "Quiet after 22:00"}, {"icon": "shoe", "text": "Shoes off"}, {"text": "Gate closed"}]}
    run(hc.guide_set("s1", rules=[], address=""))  # [] clears the rules, "" clears a field
    assert body(net.last("PUT", "/api/searches/s1/guide")) == {"address": "", "rules": []}


@pytest.mark.parametrize("rules, err", [
    ([{"icon": "rocket", "text": "x"}], "unknown"),
    ([{"icon": "info"}], "no text"),
    (["ok"] * 13, "At most 12"),
    ([42], "string or"),
    ("Shoes off", "must be a list"),
])
def test_guide_set_rejects_bad_rules(net, rules, err):
    with pytest.raises(ToolError, match=err):
        run(hc.guide_set("s1", rules=rules))
    assert not net.requests


def test_guide_set_refuses_sensitive_and_validates(net):
    with pytest.raises(ToolError, match="sensitive"):
        run(hc.guide_set("s1", note="Owner passport no. A1234567 is in the drawer"))
    with pytest.raises(ToolError, match="rules\\[0\\]"):
        run(hc.guide_set("s1", rules=["Spare card 4111 1111 1111 1111"]))
    with pytest.raises(ToolError, match="card"):
        run(hc.guide_set("s1", wifi_password="4111111111111111"))
    with pytest.raises(ToolError, match="http"):
        run(hc.guide_set("s1", map_url="maps of bali"))
    with pytest.raises(ToolError, match="Nothing to change"):
        run(hc.guide_set("s1"))
    assert not net.requests
    net.on("PUT", "/api/searches/s1/guide", {"error": "sensitive", "message": "looks like an ID"}, status=400)
    with pytest.raises(ToolError, match="400 sensitive"):
        run(hc.guide_set("s1", note="harmless"))


# ---------------------------------------------------------------- what next (renewal) and clone

def test_next_get_and_note_set(net):
    net.on("GET", "/api/searches/s1/next", {"renewal": None})
    assert run(hc.next_get("s1")) == {"renewal": None}
    net.on("PUT", "/api/searches/s1/next", {"renewal": {"id": "rn_1", "status": "open", "note": "x"}})
    out = run(hc.next_note_set("s1", "Owner wants +10% for 2027", lease_to="2027-01-31"))
    assert out["renewal"]["id"] == "rn_1"
    assert body(net.last("PUT", "/api/searches/s1/next")) == {"note": "Owner wants +10% for 2027", "lease_to": "2027-01-31"}
    run(hc.next_note_set("s1", "only a note"))
    assert body(net.last("PUT", "/api/searches/s1/next")) == {"note": "only a note"}
    with pytest.raises(ToolError, match="YYYY-MM-DD"):
        run(hc.next_note_set("s1", "x", lease_to="31.01.2027"))
    with pytest.raises(ToolError, match="Refused"):
        run(hc.next_note_set("s1", "passport 1234567890"))


def test_search_clone(net):
    net.on("POST", "/api/searches/s1/clone", {"search": {"id": "s2"}, "invite_link": "i", "group_link": "g"}, status=201)
    out = run(hc.search_clone("s1", title="Bali 2027", move_in="2027-02-01", term="6 months"))
    assert out["search"]["id"] == "s2"
    assert body(net.last("POST", "/api/searches/s1/clone")) == {"title": "Bali 2027", "move_in": "2027-02-01", "term": "6 months"}
    run(hc.search_clone("s1"))
    assert body(net.last("POST", "/api/searches/s1/clone")) == {}
    with pytest.raises(ToolError, match="move_in"):
        run(hc.search_clone("s1", move_in="Feb"))


# ---------------------------------------------------------------- negotiation, prices, recap, guests

def test_negotiation_get_and_owner_only(net):
    neg = {"listing": {"id": "l1", "price": 25_000_000}, "market": None, "history": [], "offer": {"price": 22_000_000, "months_upfront": 6, "capped": True},
           "arguments": [{"key": "median", "value": 21_000_000}], "asked": 25_000_000, "budget_said": 22_000_000}
    net.on("GET", "/api/listings/l1/negotiation", neg)
    out = run(hc.negotiation_get("l1"))
    assert out["offer"]["capped"] is True and "budget_cap" not in out
    net.on("GET", "/api/listings/l2/negotiation", {"error": "owner_only", "message": "owner only"}, status=403)
    with pytest.raises(ToolError, match="403 owner_only"):
        run(hc.negotiation_get("l2"))


def test_deal_prices_set(net):
    net.on("PUT", "/api/deals/l1/prices", {"asked": 25_000_000, "agreed": 22_000_000, "currency": "IDR", "saved_month": 3_000_000,
                                           "months": 6, "saved_term": 18_000_000})
    out = run(hc.deal_prices_set("l1", asked=25_000_000, agreed=22_000_000))
    assert out["saved_term"] == 18_000_000
    assert body(net.last("PUT", "/api/deals/l1/prices")) == {"asked": 25_000_000, "agreed": 22_000_000}
    run(hc.deal_prices_set("l1", agreed=21_500_000.0))
    assert body(net.last("PUT", "/api/deals/l1/prices")) == {"agreed": 21_500_000.0}
    for bad in ({"asked": 0}, {"agreed": -5}, {"agreed": True}, {"asked": "22M"}, {}):
        with pytest.raises(ToolError):
            run(hc.deal_prices_set("l1", **bad))
    assert len(net.to(CRM, "PUT")) == 2


def test_recap_and_guests(net):
    net.on("GET", "/api/searches/s1/recap", {"complete": False, "missing": ["prices"], "counts": {"contacted": 40}})
    assert run(hc.recap_get("s1"))["missing"] == ["prices"]
    net.on("GET", "/api/searches/s1/guests", {"guests": [{"user_id": "u9", "name": "Kate", "from": "2026-12-01", "to": "2026-12-10",
                                                          "areas": {"guide": True, "places": True, "contacts": False, "issues": True},
                                                          "status": "active", "invited_by": "u1"}]})
    assert run(hc.guests_get("s1"))["guests"][0]["areas"]["contacts"] is False
    net.on("GET", "/api/searches/s2/recap", {"error": "not_found", "message": "no search"}, status=404)
    with pytest.raises(ToolError, match="404"):
        run(hc.recap_get("s2"))


def test_docstrings_carry_the_rules():
    assert "budget_cap" in hc.negotiation_get.__doc__ and "budget_said" in hc.negotiation_get.__doc__
    for key in ("median", "not_included", "empty_since", "season", "term_upfront", "long_listed", "was_cheaper"):
        assert key in hc.negotiation_get.__doc__
    assert "agreed price automatically" in hc.deal_set.__doc__
    assert 'kind "guest"' in hc.drafts_ready.__doc__


def test_wave5_tools_registered():
    tools = run(hc.mcp.list_tools())
    names = {t.name for t in tools}
    assert {"surf_forecast", "guide_get", "guide_set", "next_get", "next_note_set", "search_clone", "negotiation_get",
            "deal_prices_set", "recap_get", "guests_get"} <= names
    assert all(t.description for t in tools)


# ---------------------------------------------------------------- location rings (pack-configurable, free-flow)

@pytest.fixture
def regions(tmp_path, monkeypatch):
    root = tmp_path / "regions"
    (root / "bl" / "town").mkdir(parents=True)
    (root / "bl" / "pack.yaml").write_text(
        "id: bl\nname: {en: Bl}\nlocation: {rings: [10, 20, 40], weights: [1.0, 0.7, 0.3]}\n", encoding="utf-8")
    (root / "bl" / "town" / "pack.yaml").write_text(
        "id: town\nname: {en: Town}\ntravel: {mode: scooter, rush_factor: 1.3}\n", encoding="utf-8")
    (root / "bl" / "city").mkdir()
    (root / "bl" / "city" / "pack.yaml").write_text(
        "id: city\nname: {en: City}\nlocation: {rings: [15, 30, 45], weights: [1.0, 0.5, 0.2]}\n", encoding="utf-8")
    (root / "nn").mkdir()
    (root / "nn" / "pack.yaml").write_text("id: nn\nname: {en: NN}\n", encoding="utf-8")
    (root / "bad").mkdir()
    (root / "bad" / "pack.yaml").write_text("id: bad\nname: {en: Bad}\nlocation: {rings: [20, 10], weights: [1, 2]}\n", encoding="utf-8")
    monkeypatch.setenv("HUNT_REGIONS", str(root))
    return root


def test_location_rings_from_pack_default_and_invalid(regions):
    assert hc.location_rings("bl/town") == ([10, 20, 40], [1.0, 0.7, 0.3])
    assert hc.location_rings("bl/city") == ([15, 30, 45], [1.0, 0.5, 0.2])  # a city pack may override
    assert hc.location_rings("nn") == ([10, 20, 40], [1.0, 0.7, 0.3])  # missing → default
    assert hc.location_rings("bad") == ([10, 20, 40], [1.0, 0.7, 0.3])  # invalid → default
    assert hc.location_rings("zz/none") == ([10, 20, 40], [1.0, 0.7, 0.3])  # unknown pack → default
    assert hc.rush_note(1.3).endswith("roughly +30%.") and "+" not in hc.rush_note(1.0)


def test_real_country_packs_define_the_default_rings(monkeypatch):
    monkeypatch.setenv("HUNT_REGIONS", str(real_regions()))
    for country in ("bali", "kz", "th"):
        assert hc.merged_pack(country)["location"] == {"rings": [10, 20, 40], "weights": [1.0, 0.7, 0.3]}


def iso(contours):
    feats = [{"type": "Feature", "properties": {"contour": c},
              "geometry": {"type": "Polygon", "coordinates": [[[115.1, -8.8], [115.1 + c / 1000, -8.8], [115.1, -8.8]]]}} for c in contours]
    return {"type": "FeatureCollection", "features": feats}


def loc_routes(net, region="bl/town", rows=None):
    net.on("GET", "/api/searches/s1", {"search": {"id": "s1", "region": region, "brief": {}}})
    net.on("GET", "/api/searches/s1/locations", rows if rows is not None else [
        {"listing_id": "l1", "score": 60, "has_isochrones": True},
        {"listing_id": "l2", "score": None, "has_isochrones": True, "stale": True},
        {"listing_id": "l3", "score": None, "has_isochrones": False}])
    net.on("GET", "/api/searches/s1/listings", [{"id": f"l{i}", "lat": -8.8 - i / 100, "lng": 115.1, "status": "new"} for i in (1, 2, 3)])
    for i in (1, 2, 3):
        net.on("PUT", f"/api/listings/l{i}/isochrones", {"location": {"score": 50 + i}})


def test_location_refresh_free_flow_rings_and_stale(net, regions):
    loc_routes(net)
    net.on("POST", "/isochrone", iso((40.0, 20.0, 10.0)), host=VALHALLA)
    out = run(hc.location_refresh("s1"))
    # l1 is current → skipped; l2 is stale (another ring set) → recomputed without force; l3 has none.
    assert [u["listing_id"] for u in out["updated"]] == ["l2", "l3"] and out["updated"][0]["was_stale"] is True
    assert "was_stale" not in out["updated"][1]
    assert out["skipped"] == [{"listing_id": "l1", "reason": "has isochrones (force=True to redo)"}]
    assert out["ring_set"] == [10, 20, 40] and out["rush_factor"] == 1.3 and "+30%" in out["rush_note"]
    for req in net.to(VALHALLA):
        assert body(req)["contours"] == [{"time": 10.0}, {"time": 20.0}, {"time": 40.0}]  # rush 1.3 is NOT applied
    put = body(net.last("PUT", "/api/listings/l2/isochrones"))
    assert put["rings"] == [10, 20, 40] and put["rush"] == 1.3
    assert [f["properties"]["ring"] for f in put["geo"]["features"]] == [10, 20, 40]


def test_location_refresh_city_ring_set(net, regions):
    loc_routes(net, region="bl/city", rows=[])
    net.on("POST", "/isochrone", iso((45.0, 30.0, 15.0)), host=VALHALLA)
    out = run(hc.location_refresh("s1", listing_ids=["l1"]))
    assert out["ring_set"] == [15, 30, 45] and out["ring_weights"] == [1.0, 0.5, 0.2]
    assert body(net.to(VALHALLA)[0])["contours"] == [{"time": 15.0}, {"time": 30.0}, {"time": 45.0}]
    put = body(net.last("PUT", "/api/listings/l1/isochrones"))
    assert put["rings"] == [15, 30, 45] and [f["properties"]["ring"] for f in put["geo"]["features"]] == [15, 30, 45]


def test_location_refresh_ignores_legacy_cache_and_keys_by_ring_set(net, regions):
    lat, lng = -8.81, 115.1
    legacy = {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {"ring": 5},
                                                         "geometry": {"type": "Polygon", "coordinates": [[[0, 0], [1, 1], [0, 0]]]}}]}
    hc._json_cache_save(hc.ISOCHRONE_CACHE, {f"motor_scooter|1.3|{lat:.4f},{lng:.4f}": legacy})  # wave 4 key format
    loc_routes(net, rows=[])
    net.on("POST", "/isochrone", iso((40.0, 20.0, 10.0)), host=VALHALLA)
    run(hc.location_refresh("s1", listing_ids=["l1"]))
    assert len(net.to(VALHALLA)) == 1  # the legacy 5/10/30 contours were not reused
    cache = hc._json_cache_load(hc.ISOCHRONE_CACHE)
    key = hc.isochrone_cache_key("motor_scooter", [10, 20, 40], lat, lng)
    assert key == "motor_scooter|r10-20-40|-8.8100,115.1000" and key in cache
    run(hc.location_refresh("s1", listing_ids=["l1"]))  # same ring set → served from the cache
    assert len(net.to(VALHALLA)) == 1
    assert hc.isochrone_cache_key("motor_scooter", [15, 30, 45], lat, lng) != key


def test_location_refresh_bad_rings_hint(net, regions):
    loc_routes(net, rows=[])
    net.on("POST", "/isochrone", iso((40.0, 20.0, 10.0)), host=VALHALLA)
    net.on("PUT", "/api/listings/l1/isochrones", {"error": "bad_rings", "message": "rings must be [15,30,45]"}, status=400)
    with pytest.raises(ToolError, match="differs from the deployed CRM"):
        run(hc.location_refresh("s1", listing_ids=["l1"]))
