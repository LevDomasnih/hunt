"""Wave 6 · Полезное tools (useful_get, useful_add, useful_decide, useful_annotate) against a mocked CRM, and the real
region packs' useful.yaml files (links only, valid kinds/categories, the strict YAML subset). No network."""
from _regions import real_regions
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
CRM = "crm.test"
REGIONS = real_regions()


def run(coro):
    return asyncio.run(coro)


class FakeNet:
    """Routes requests by (METHOD, path); records every request."""

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
    monkeypatch.setattr(hc.owner_of("_TRANSPORT"), "_TRANSPORT", httpx.MockTransport(fake))
    hc.update_config(lambda c: c.__setitem__("api_url", URL))
    isolated.set_password("hunt", URL, TOKEN)
    return fake


# ---------------------------------------------------------------- tools

def test_useful_get_params(net):
    net.on("GET", "/api/useful", {"country": "bali", "city": "bukit", "items": [{"id": "tg-arendabali"}], "pending": []})
    out = run(hc.useful_get(" Bali ", city="Bukit"))
    assert out["items"][0]["id"] == "tg-arendabali"
    req = net.last("GET", "/api/useful")
    assert req.url.params["country"] == "bali" and req.url.params["city"] == "bukit" and "status" not in req.url.params
    assert req.headers["authorization"] == f"Bearer {TOKEN}"
    run(hc.useful_get("kz", include_rejected=True))
    req = net.last("GET", "/api/useful")
    assert req.url.params["status"] == "rejected" and "city" not in req.url.params


def test_useful_add_normalizes_and_validates(net):
    net.on("POST", "/api/useful", lambda r: {"link": {"id": "ul_1", **body(r), "status": "approved"}}, 201)
    out = run(hc.useful_add("bali", "Байки на Бали", "@solar_bike", category="bikes", about_ru="аренда байков", lang="ru",
                            activity={"members": 2352, "per_day": 12.5}, last_checked="2026-11-20"))
    sent = body(net.last("POST", "/api/useful"))
    assert sent["url"] == "https://t.me/solar_bike" and sent["category"] == "bikes" and sent["activity"] == {"members": 2352, "per_day": 12.5}
    assert "about_en" not in sent and "city" not in sent
    assert out["link"]["status"] == "approved"
    run(hc.useful_add("bali", "BaliChat", "t.me/balichat"))
    assert body(net.last("POST", "/api/useful"))["url"] == "https://t.me/balichat"

    n = len(net.requests)
    for bad_url in ("http://example.com", "javascript:alert(1)", "tg://resolve?domain=x", "example.com", "https://localhost"):
        with pytest.raises(ToolError, match="https"):
            run(hc.useful_add("bali", "x", bad_url))
    with pytest.raises(ToolError, match="category"):
        run(hc.useful_add("bali", "x", "https://example.com", category="casino"))
    with pytest.raises(ToolError, match="lang"):
        run(hc.useful_add("bali", "x", "https://example.com", lang="french!"))
    with pytest.raises(ToolError, match="YYYY-MM-DD"):
        run(hc.useful_add("bali", "x", "https://example.com", last_checked="20.11.2026"))
    with pytest.raises(ToolError, match="activity"):
        run(hc.useful_add("bali", "x", "https://example.com", activity={"members": -1}))
    with pytest.raises(ToolError, match="Refused"):
        run(hc.useful_add("bali", "x", "https://example.com", about_ru="паспорт 4510 123456"))
    assert len(net.requests) == n, "refused calls must not reach the CRM"


def test_useful_decide(net):
    net.on("PUT", "/api/useful/ul_9", lambda r: {"link": {"id": "ul_9", "status": body(r)["status"]}})
    assert run(hc.useful_decide("ul_9", "approved"))["link"]["status"] == "approved"
    assert body(net.last("PUT", "/api/useful/ul_9")) == {"status": "approved"}
    with pytest.raises(ToolError, match="status"):
        run(hc.useful_decide("ul_9", "maybe"))
    with pytest.raises(ToolError, match="Invalid id"):
        run(hc.useful_decide("../x", "approved"))


def test_useful_decide_crm_refusal(net):
    net.on("PUT", "/api/useful/ul_other", {"error": "not_yours", "message": "Only the owner of the search…"}, 403)
    with pytest.raises(ToolError, match="403 not_yours"):
        run(hc.useful_decide("ul_other", "rejected"))


def test_useful_annotate_pack_and_link(net):
    net.on("POST", "/api/useful", lambda r: {"annotation": {"pack_id": body(r)["pack_id"]}}, 201)
    net.on("PUT", "/api/useful/ul_3", lambda r: {"link": {"id": "ul_3", **body(r)}})
    out = run(hc.useful_annotate(country="bali", pack_id="tg-arendabali", activity={"members": 9001}, last_checked="2026-11-21"))
    assert out["annotation"]["pack_id"] == "tg-arendabali"
    assert body(net.last("POST", "/api/useful")) == {"country": "bali", "pack_id": "tg-arendabali", "activity": {"members": 9001}, "last_checked": "2026-11-21"}
    run(hc.useful_annotate(link_id="ul_3", activity={"per_day": 40}))
    assert body(net.last("PUT", "/api/useful/ul_3")) == {"activity": {"per_day": 40}}
    with pytest.raises(ToolError, match="activity and/or last_checked"):
        run(hc.useful_annotate(country="bali", pack_id="x"))
    with pytest.raises(ToolError, match="country \\+ pack_id"):
        run(hc.useful_annotate(pack_id="x", last_checked="2026-11-21"))
    with pytest.raises(ToolError, match="activity needs"):
        run(hc.useful_annotate(link_id="ul_3", activity={}))


def test_annotate_docstring_says_read_only():
    doc = hc.useful_annotate.__doc__ or ""
    assert "READ-ONLY" in doc and "Never join" in doc and "never post" in doc


# ---------------------------------------------------------------- the real packs

KINDS = {"telegram", "app", "web", "hunt"}
CATS = set(hc.USEFUL_CATEGORIES)


def useful_files():
    return sorted(REGIONS.glob("*/useful.yaml")) + sorted(REGIONS.glob("*/*/useful.yaml"))


def test_region_packs_have_useful_lists():
    countries = {p.parent.name for p in REGIONS.glob("*/useful.yaml")}
    assert {"bali", "kz", "th"} <= countries


@pytest.mark.parametrize("path", useful_files(), ids=lambda p: str(p.relative_to(REGIONS)))
def test_useful_yaml_items(path):
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    assert re.match(r"^\d{4}-\d{2}-\d{2}$", str(data["verified"]))
    ids = set()
    for it in data["items"]:
        assert re.match(r"^[a-z0-9-]+$", it["id"]) and it["id"] not in ids
        ids.add(it["id"])
        assert it["kind"] in KINDS and it["category"] in CATS and it["name"]
        if it["kind"] == "hunt":
            assert re.match(r"^hunt:[a-z]+$", it["url"])
        else:
            assert it["url"].startswith("https://")
        if it["kind"] == "telegram":
            assert re.match(r"^https://t\.me/[A-Za-z0-9_]{4,}$", it["url"])
        assert it["about"]["ru"] and it["about"]["en"]
        if "last_checked" in it:
            assert re.match(r"^\d{4}-\d{2}-\d{2}$", str(it["last_checked"]))
        if "activity" in it:
            assert set(it["activity"]) <= {"members", "per_day", "at"}
    # Strict subset for crm/scripts/copy-art.mjs: list items are one-line flow maps.
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.lstrip().startswith("- "):
            assert line.strip().startswith("- {") and line.rstrip().endswith("}"), line


def test_bali_has_the_rental_chats_and_apps():
    items = {it["id"]: it for it in yaml.safe_load((REGIONS / "bali" / "useful.yaml").read_text(encoding="utf-8"))["items"]}
    urls = {it["url"] for it in items.values()}
    for h in ("arendabali", "balichatarenda", "Belkin_Bali_Rent", "arenda_bali_2", "rent_in_bali"):
        assert f"https://t.me/{h}" in urls
    names = {it["name"] for it in items.values()}
    assert {"Gojek", "Grab", "PLN Mobile"} <= names
    guide = items["web-baliforum-places"]
    assert guide["kind"] == "web" and guide.get("attribution")
    assert any(it["kind"] == "hunt" for it in items.values())


def test_region_doc_reads_useful(monkeypatch):
    monkeypatch.setenv("HUNT_REGIONS", str(REGIONS))
    out = hc.read_doc("bali/bukit", "useful.yaml")
    assert out["level"] == "bali/bukit" and "balichat_bukit" in out["content"]
    assert "useful.yaml" in hc.available_docs("kz")
