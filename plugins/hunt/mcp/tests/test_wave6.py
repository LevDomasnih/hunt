"""Wave 6 tools (the project pipeline: stage_get / stage_set, lease terms: deal_terms_get / deal_term_set, term_seq on
documents) against a mocked CRM. No network."""
import asyncio
import json

import httpx
import pytest

import hunt_core as hc
from hunt_core import ToolError

URL = "https://crm.test"
TOKEN = "hunt_test_token"
CRM = "crm.test"


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
    monkeypatch.setattr(hc, "_TRANSPORT", httpx.MockTransport(fake))
    hc.update_config(lambda c: c.__setitem__("api_url", URL))
    isolated.set_password("hunt", URL, TOKEN)
    return fake


STAGE = {"stage": {"key": "movein", "idx": 6, "n": 9, "derived_key": "movein", "manual": False, "closed": False, "date": "2026-11-23",
                   "rows": [{"key": "deal", "status": "done"}, {"key": "movein", "status": "current"}]},
         "derived": {"key": "movein", "choice": {"listing_id": "fb-1", "how": "deal"}}}


# ---------------------------------------------------------------- stage

def test_stage_get_and_preview(net):
    net.on("GET", "/api/searches/s1/stage", STAGE)
    r = run(hc.stage_get("s1"))
    assert r["stage"]["key"] == "movein"
    req = net.last("GET", "/api/searches/s1/stage")
    assert "today" not in req.url.params and req.headers["authorization"] == f"Bearer {TOKEN}"
    run(hc.stage_get("s1", today="2026-11-22"))
    assert net.last("GET", "/api/searches/s1/stage").url.params["today"] == "2026-11-22"
    with pytest.raises(ToolError, match="YYYY-MM-DD"):
        run(hc.stage_get("s1", today="22.11.2026"))


def test_stage_set_values(net):
    net.on("PUT", "/api/searches/s1/stage", lambda req: {"stage": {"key": body(req)["stage"]}, "changed": True})
    assert run(hc.stage_set("s1", "living", note="moved in, no video yet"))["stage"]["key"] == "living"
    assert body(net.last("PUT", "/api/searches/s1/stage")) == {"stage": "living", "note": "moved in, no video yet"}
    run(hc.stage_set("s1", "closed"))
    assert body(net.last("PUT", "/api/searches/s1/stage")) == {"stage": "closed"}
    run(hc.stage_set("s1", "auto"))
    run(hc.stage_set("s1", "choice", listing_id="fb-1"))
    assert body(net.last("PUT", "/api/searches/s1/stage")) == {"stage": "choice", "listing_id": "fb-1"}
    with pytest.raises(ToolError, match="stage must be"):
        run(hc.stage_set("s1", "archived"))


def test_stage_set_refuses_sensitive_note(net):
    with pytest.raises(ToolError, match="Refused"):
        run(hc.stage_set("s1", "living", note="owner NIK 3171014501900003"))
    assert not net.requests


# ---------------------------------------------------------------- lease terms

def test_deal_terms_get(net):
    net.on("GET", "/api/searches/s1/terms", {"terms": [{"seq": 1, "current": False}, {"seq": 2, "current": True}]})
    assert [t["seq"] for t in run(hc.deal_terms_get("s1"))["terms"]] == [1, 2]


def test_deal_term_set_new_extension(net):
    net.on("PUT", "/api/searches/s1/terms/new", lambda req: {"term": {"seq": 2, **body(req)}, "terms": []}, status=201)
    r = run(hc.deal_term_set("s1", date_from="2027-03-23", date_to="2027-09-23", kind="lease", rent=20000000, currency="IDR", deposit=22000000,
                             deposit_prev="carried", deposit_prev_amount=22000000, landlord="Made, owner", status="draft",
                             dates=[{"date": "2027-03-20", "kind": "payment", "title": "First month", "amount": 20000000}],
                             checklist=[{"text": "Old deposit carried over", "done": True}]))
    assert r["term"]["seq"] == 2
    b = body(net.last("PUT", "/api/searches/s1/terms/new"))
    assert b["from"] == "2027-03-23" and b["to"] == "2027-09-23" and b["deposit_prev"] == "carried" and b["landlord"] == "Made, owner"
    assert b["dates"][0]["kind"] == "payment" and "seq" not in b


def test_deal_term_set_update_status_only(net):
    net.on("PUT", "/api/searches/s1/terms/2", lambda req: {"term": {"seq": 2, **body(req)}, "terms": []})
    run(hc.deal_term_set("s1", seq=2, status="signed"))
    assert body(net.last("PUT", "/api/searches/s1/terms/2")) == {"status": "signed"}


@pytest.mark.parametrize("kwargs, msg", [
    ({"seq": 1, "date_from": "2027-01-01"}, "seq 1"),
    ({"seq": "x"}, "seq must be"),
    ({"date_from": "23.03.2027"}, "Bad date"),
    ({"date_from": "2027-03-23", "status": "done"}, "status must be"),
    ({"date_from": "2027-03-23", "deposit_prev": "lost"}, "deposit_prev must be"),
    ({"date_from": "2027-03-23", "kind": "rent"}, "kind must be"),
    ({"date_from": "2027-03-23", "rent": -5}, "rent must be"),
    ({"date_from": "2027-03-23", "dates": [{"date": "2027-04-01", "kind": "rent", "title": "x"}]}, "dates\\[0\\]"),
    ({"date_from": "2027-03-23", "landlord": "Made, NIK 3171014501900003"}, "Refused"),
])
def test_deal_term_set_validation(net, kwargs, msg):
    with pytest.raises(ToolError, match=msg):
        run(hc.deal_term_set("s1", **kwargs))
    assert not net.requests


def test_doc_set_term_seq(net):
    net.on("PUT", "/api/documents/new", lambda req: {"document": body(req)}, status=201)
    run(hc.doc_set("fb-1", kind="lease", title="Direct contract with Made", status="have", signed_at="2027-03-18", term_seq=2))
    assert body(net.last("PUT", "/api/documents/new"))["term_seq"] == 2
    run(hc.doc_set("fb-1", kind="lease", title="First contract", status="have"))
    assert "term_seq" not in body(net.last("PUT", "/api/documents/new"))
