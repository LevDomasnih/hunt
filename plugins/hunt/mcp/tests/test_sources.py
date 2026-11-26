"""region_doc("sources.yaml") with the sources registry: merge, fallbacks, suggestions. No network."""
import asyncio
import json

import httpx
import pytest
import yaml

import hunt_core as hc
from hunt_core import ToolError

URL = "https://crm.test"
REG = {"country": "xx", "count": 3, "updated_at": "2026-11-25T00:00:00Z", "sections": {
    "telegram": [{"id": "src_1", "handle": "@reg_chat", "title": "Чат", "events": True}],
    "portals": [{"id": "src_2", "name": "Portal", "url": "https://www.portal.example/", "note": "from the registry"}],
    "post_request_where": [{"id": "src_3", "text": "Post in the big chat"}]}}


def run(coro):
    return asyncio.run(coro)


@pytest.fixture
def net(monkeypatch, isolated, tmp_path):
    reqs, answer = [], {"status": 200, "json": REG}

    def handler(req: httpx.Request) -> httpx.Response:
        reqs.append(req)
        return httpx.Response(answer["status"], json=answer["json"])

    d = tmp_path / "regions" / "xx"
    d.mkdir(parents=True)
    (d / "sources.yaml").write_text('verified: 2026-11\nportals:\n  - {name: Portal, url: "https://portal.example"}\n  - {name: Own, url: "https://own.example"}\n', encoding="utf-8")
    (d / "pack.yaml").write_text("id: xx\n", encoding="utf-8")
    (tmp_path / "regions" / "yy").mkdir()
    (tmp_path / "regions" / "yy" / "pack.yaml").write_text("id: yy\n", encoding="utf-8")
    monkeypatch.setenv("HUNT_REGIONS", str(tmp_path / "regions"))
    hc.update_config(lambda c: c.__setitem__("api_url", URL))
    isolated.set_password("hunt", URL, "hunt_test_token")
    monkeypatch.setattr(hc, "_TRANSPORT", httpx.MockTransport(handler))
    hc._REGISTRY.clear()
    yield reqs, answer
    hc._REGISTRY.clear()


def test_merge(net):
    reqs, _ = net
    r = run(hc.region_doc("xx", "sources.yaml"))
    d = yaml.safe_load(r["content"])
    assert r["registry"]["count"] == 3 and d["verified"]
    assert d["telegram"][0]["handle"] == "@reg_chat" and d["telegram"][0]["events"] is True
    assert [p["name"] for p in d["portals"]] == ["Portal", "Own"] and d["portals"][0]["id"] == "src_2"  # the same site once
    assert "Чат" in r["content"]
    run(hc.region_doc("xx", "sources.yaml"))
    assert len(reqs) == 1 and reqs[0].url.params["country"] == "xx"  # cached


@pytest.mark.parametrize("status,body,word", [(404, {"error": "sources_off", "message": "no registry"}, "off"), (502, {"error": "sources_down", "message": "x"}, "unavailable")])
def test_without_registry_the_pack_is_enough(net, status, body, word):
    _, answer = net
    answer.update(status=status, json=body)
    r = run(hc.region_doc("xx", "sources.yaml"))
    assert r["registry"].startswith(word) and "Own" in r["content"]


def test_not_connected(net, isolated):
    hc.update_config(lambda c: c.pop("api_url", None))
    r = run(hc.region_doc("xx", "sources.yaml"))
    assert r["registry"] == "off" and "Own" in r["content"]


def test_country_without_a_list(net):
    _, answer = net
    assert "reg_chat" in run(hc.region_doc("yy", "sources.yaml"))["content"]
    hc._REGISTRY.clear()
    answer.update(json={"country": "yy", "count": 0, "updated_at": None, "sections": {}})
    with pytest.raises(ToolError, match="not found"):
        run(hc.region_doc("yy", "sources.yaml"))


def test_other_documents_do_not_ask(net):
    reqs, _ = net
    with pytest.raises(ToolError):
        run(hc.region_doc("xx", "rules.md"))
    assert not reqs


def test_suggest_and_report(net):
    reqs, _ = net
    run(hc.source_suggest("xx", "telegram", {"handle": "@new"}))
    run(hc.source_report("src_1", "dead"))
    assert [r.url.path for r in reqs] == ["/api/sources/suggest", "/api/sources/report"]
    assert json.loads(reqs[0].content) == {"country": "xx", "section": "telegram", "entry": {"handle": "@new"}}
    for bad in (hc.source_suggest("xx", "people", {}), hc.source_report("src_1", "bad")):
        with pytest.raises(ToolError):
            run(bad)
