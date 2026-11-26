"""Region packs, time/route helpers and the sensitive-data guard (no network)."""
import asyncio
from datetime import datetime
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from zoneinfo import ZoneInfo

import pytest

import hunt_core as hc
from hunt_core import ToolError

REPO_REGIONS = Path(__file__).resolve().parents[4] / "regions"


def run(coro):
    return asyncio.run(coro)


# ---------------------------------------------------------------- packs

def test_merge_country_then_city_overrides():
    p = hc.merged_pack("xx/alpha")
    assert p["levels"] == ["xx", "xx/alpha"]
    assert p["currency"] == "XXD"                      # from country
    assert p["typical_terms"]["deposit"] == "2 months"  # city override wins
    assert p["typical_terms"]["min_term"] == "1 month"  # untouched country key stays
    assert p["typical_terms"]["payment_methods"] == ["cash", "bank_transfer"]
    assert p["payment_methods_note"] == "cash only in the south"
    assert p["name"] == {"en": "Alpha City"}           # city replaces name
    assert p["country_pack"]["id"] == "xx"
    assert "overrides" not in p
    assert [d["slug"] for d in p["district_list"]] == ["north", "south"]
    assert p["district_list"][0]["aliases"] == ["Upper"]
    assert p["verified"] == "2026-11"


def test_district_and_missing_city_pack():
    p = hc.merged_pack("xx/alpha/north")
    assert p["district"]["note"] == "quiet"
    with pytest.raises(ToolError, match="No district"):
        hc.merged_pack("xx/alpha/nowhere")
    b = hc.merged_pack("xx/beta")
    assert b["levels"] == ["xx"] and "no pack.yaml" in b["notes"][0]
    with pytest.raises(ToolError, match="No city"):
        hc.merged_pack("xx/gamma")
    with pytest.raises(ToolError, match="Bad region path"):
        hc.merged_pack("../etc")


def test_docs_fallback_city_to_country():
    assert hc.read_doc("xx/alpha", "market.md")["level"] == "xx/alpha"
    r = hc.read_doc("xx/alpha", "rules.md")
    assert r["level"] == "xx" and "Country level" in r["content"]
    t = hc.read_doc("xx/alpha", "templates/en/first_contact.md")
    assert len(t["variants"]) == 2
    with pytest.raises(ToolError, match="not found"):
        hc.read_doc("xx/alpha", "contract.md")
    with pytest.raises(ToolError, match="name must be"):
        hc.read_doc("xx", "../../secret.md")
    docs = hc.available_docs("xx/alpha")
    assert docs["market.md"] == "xx/alpha" and docs["rules.md"] == "xx"


def test_region_tree():
    tree = run(hc.region_list())["packs"]
    xx = next(x for x in tree if x["path"] == "xx")
    assert xx["currency"] == "XXD" and xx["template_langs"] == ["en"]
    cities = {c["path"]: c for c in xx["cities"]}
    assert cities["xx/alpha"]["has_pack"] and cities["xx/alpha"]["districts"] == ["north", "south"]
    assert not cities["xx/beta"]["has_pack"]


@pytest.mark.skipif(not (REPO_REGIONS / "bali" / "pack.yaml").exists(), reason="repo packs not present")
def test_real_bali_pack_loads(monkeypatch):
    monkeypatch.setenv("HUNT_REGIONS", str(REPO_REGIONS))
    p = hc.merged_pack("bali")
    assert p["currency"] == "IDR" and p["timezone"] == "Asia/Makassar"
    assert "rules.md" in p["docs"]
    import json
    json.dumps(p)  # JSON-safe


# ---------------------------------------------------------------- time & routes

def test_weekday_2026_11_18_is_wednesday():
    r = hc.time_info_impl("Asia/Makassar", "2026-11-18", now=datetime(2026, 11, 19, 3, 0, tzinfo=ZoneInfo("UTC")))
    assert r["asked"]["weekday"] == "Wednesday"
    assert r["date"] == "2026-11-19" and r["weekday"] == "Thursday"
    assert r["utc_offset"] == "+08:00"
    assert r["asked"]["days_from_today"] == -1


def test_time_info_region_path_and_bad_tz():
    r = hc.time_info_impl("xx", now=datetime(2026, 11, 18, 23, 30, tzinfo=ZoneInfo("UTC")))
    assert r["tz"] == "Asia/Makassar" and r["date"] == "2026-11-19"
    with pytest.raises(ToolError, match="Unknown timezone"):
        hc.time_info_impl("Mars/Base")


def test_dates_between():
    r = run(hc.dates_between("2026-11-18", "2026-11-22"))
    assert r["days"] == 5 and r["nights"] == 4
    assert r["dates"][0] == {"date": "2026-11-18", "weekday": "Wednesday"}
    assert r["dates"][-1]["weekday"] == "Sunday"


def test_route_link():
    r = run(hc.route_link([{"lat": -8.81, "lng": 115.12}, {"lat": -8.79, "lng": 115.16}, {"lat": -8.70, "lng": 115.17}]))
    u = urlparse(r["url"])
    q = parse_qs(u.query)
    assert u.netloc == "www.google.com" and u.path == "/maps/dir/"
    assert q["origin"] == ["-8.81,115.12"] and q["destination"] == ["-8.7,115.17"]
    assert q["waypoints"] == ["-8.79,115.16"] and q["api"] == ["1"] and q["travelmode"] == ["driving"]
    one = run(hc.route_link([{"lat": 1, "lng": 2}]))
    assert "maps/search" in one["url"]
    many = hc.route_links([{"lat": 0, "lng": i / 100} for i in range(15)])
    assert len(many) == 2
    assert parse_qs(urlparse(many[0]).query)["destination"] == parse_qs(urlparse(many[1]).query)["origin"]
    with pytest.raises(ToolError):
        hc.route_links([{"lat": 200, "lng": 0}])


# ---------------------------------------------------------------- sensitive guard

@pytest.mark.parametrize("data", [
    {"tenant": {"passport": "C1234567"}},
    {"notes": "Landlord copied passport no. C7212345"},
    {"notes": "паспорт 4510 123456"},
    {"payments": [{"card_number": "4111 1111 1111 1111"}]},
    {"notes": "paid from card 4111-1111-1111-1111"},
    {"bank": {"iban": "DE89370400440532013000"}},
    {"login": {"password": "hunter2"}},
])
def test_guard_refuses(data):
    assert hc.sensitive_findings(data)
    with pytest.raises(ToolError, match="Refused"):
        run(hc.deal_set("l1", data))


@pytest.mark.parametrize("data", [
    {"terms": {"price": 25000000, "deposit": 25000000}, "checklist": {"passport_copy": "sent"}},
    {"notes": "Landlord wants a passport copy, rent 25000000 IDR"},
    {"payments": [{"amount": 75000000, "date": "2026-11-20", "method": "bank_transfer"}]},
    {"contact_phone": "+6281200000033"},
])
def test_guard_allows(data):
    assert hc.sensitive_findings(data) == []


def test_short_link_host_is_anchored():
    """Wave 5.1: _resolve_maps_url only follows goo.gl / g.co and their subdomains, never look-alike hosts."""
    from hunt_core import _short_link_host
    assert _short_link_host("maps.app.goo.gl")
    assert _short_link_host("goo.gl")
    assert _short_link_host("g.co")
    assert not _short_link_host("evilgoo.gl")
    assert not _short_link_host("goo.gl.evil.com")
    assert not _short_link_host("xg.co")
    assert not _short_link_host("")


def test_resolve_maps_url_does_not_follow_lookalike(monkeypatch):
    """A look-alike short host is returned as is: no request goes out."""
    import asyncio
    import httpx
    import hunt_core as hc
    seen = []
    monkeypatch.setattr(hc, "_TRANSPORT", httpx.MockTransport(lambda r: seen.append(r) or httpx.Response(302, headers={"location": "https://evil.example/"})))
    out = asyncio.run(hc._resolve_maps_url("https://evilgoo.gl/abc"))
    assert out == "https://evilgoo.gl/abc" and not seen


def test_messages_log_needs_a_search():
    import asyncio
    import pytest
    import hunt_core as hc
    with pytest.raises(hc.ToolError):
        asyncio.run(hc.messages_log([{"channel": "whatsapp", "direction": "in", "text": "x", "external_id": "1"}]))
