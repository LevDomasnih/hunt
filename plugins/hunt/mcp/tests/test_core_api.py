"""hunt_core tools against a mocked CRM (httpx.MockTransport). No network."""
import asyncio
import json

import httpx
import pytest

import hunt_core as hc
from hunt_core import ToolError

URL = "https://crm.test"
TOKEN = "hunt_test_token"


def run(coro):
    return asyncio.run(coro)


class FakeCRM:
    """Routes requests to handlers keyed by 'METHOD /path'; records every request."""

    def __init__(self):
        self.requests: list[httpx.Request] = []
        self.routes = {}

    def on(self, method, path, fn_or_json, status=200):
        self.routes[(method, path)] = (fn_or_json, status)

    def __call__(self, req: httpx.Request) -> httpx.Response:
        self.requests.append(req)
        key = (req.method, req.url.path)
        if key not in self.routes:
            return httpx.Response(404, json={"error": "not_found", "message": f"{req.method} {req.url.path}"})
        h, status = self.routes[key]
        data = h(req) if callable(h) else h
        if isinstance(data, httpx.Response):
            return data
        return httpx.Response(status, json=data)

    def last(self, method=None, path=None):
        for r in reversed(self.requests):
            if (method is None or r.method == method) and (path is None or r.url.path == path):
                return r
        raise AssertionError(f"no request {method} {path}")


@pytest.fixture
def crm(monkeypatch, isolated):
    fake = FakeCRM()
    monkeypatch.setattr(hc, "_TRANSPORT", httpx.MockTransport(fake))
    return fake


@pytest.fixture
def configured(crm, isolated):
    hc.update_config(lambda c: c.__setitem__("api_url", URL))
    isolated.set_password("hunt", URL, TOKEN)
    return crm


def body(req):
    return json.loads(req.content)


# ---------------------------------------------------------------- setup

def test_config_set_verifies_and_stores_token_in_keyring(crm, isolated):
    crm.on("GET", "/api/me", {"user": {"id": "u_t", "display_name": "T"}, "profile": None})
    out = run(hc.hunt_config_set(URL + "/", TOKEN))
    assert out["ok"] and out["api_url"] == URL and out["user"]["id"] == "u_t"
    assert TOKEN not in json.dumps(out)
    assert isolated.get_password("hunt", URL) == TOKEN
    cfg_text = hc.config_path().read_text()
    assert TOKEN not in cfg_text and json.loads(cfg_text)["api_url"] == URL
    assert crm.last("GET", "/api/me").headers["authorization"] == f"Bearer {TOKEN}"
    assert oct(hc.config_path().stat().st_mode & 0o777) == "0o600"


def test_config_set_rejected_token_saves_nothing(crm, isolated):
    crm.on("GET", "/api/me", {"error": "bad_token", "message": "Unknown or revoked token"}, status=401)
    with pytest.raises(ToolError, match="rejected"):
        run(hc.hunt_config_set(URL, "wrong"))
    assert isolated.get_password("hunt", URL) is None
    assert not hc.config_path().exists()


def test_not_configured_message():
    with pytest.raises(ToolError, match="hunt_config_set"):
        run(hc.search_list())


def test_status(configured):
    configured.on("GET", "/health", {"ok": True, "service": "hunt-crm"})
    configured.on("GET", "/api/me", {"user": {"id": "u_t"}, "profile": {"intro_name": "Alex"}})
    st = run(hc.hunt_status())
    assert st["ready"] and st["health"]["ok"] and st["user"]["id"] == "u_t"
    assert "authorization" not in configured.last("GET", "/health").headers


# ---------------------------------------------------------------- errors

def test_api_error_is_readable(configured):
    configured.on("GET", "/api/searches/s_x", {"error": "no_search", "message": "Search s_x not found"}, status=404)
    with pytest.raises(ToolError) as e:
        run(hc.search_get("s_x"))
    msg = str(e.value)
    assert "CRM 404 no_search: Search s_x not found" in msg and "Traceback" not in msg


def test_network_error_is_readable(isolated, monkeypatch):
    def boom(req):
        raise httpx.ConnectError("connection refused")
    monkeypatch.setattr(hc, "_TRANSPORT", httpx.MockTransport(boom))
    hc.update_config(lambda c: c.__setitem__("api_url", URL))
    isolated.set_password("hunt", URL, TOKEN)
    with pytest.raises(ToolError, match="Cannot reach the CRM"):
        run(hc.search_list())


def test_500_non_json(configured):
    configured.on("GET", "/api/searches", lambda r: httpx.Response(502, text="Bad gateway"))
    with pytest.raises(ToolError, match="CRM 502 http_error: Bad gateway"):
        run(hc.search_list())


# ---------------------------------------------------------------- searches & digest

def test_search_create_and_update(configured):
    configured.on("POST", "/api/searches", {"search": {"id": "s_1"}, "group_link": "g", "invite_link": "i"}, status=201)
    out = run(hc.search_create("Alpha Nov", "xx/alpha", {"budget": 10}))
    assert out["search"]["id"] == "s_1" and "warning" not in out
    assert body(configured.last("POST"))["approval_mode"] == "ask"
    out = run(hc.search_create("Nowhere", "zz/none"))
    assert "No region pack" in out["warning"]
    configured.on("PATCH", "/api/searches/s_1", lambda r: {"search": {"id": "s_1", **body(r)}})
    run(hc.search_update("s_1", status="paused"))
    assert body(configured.last("PATCH")) == {"status": "paused"}
    with pytest.raises(ToolError):
        run(hc.search_update("s_1", status="weird"))


def test_digest_cursor_is_remembered(configured):
    def digest(req):
        since = int(req.url.params["since"])
        return {"cursor": since + 3 if since < 10 else since, "events": [{"id": since + 1}] if since < 10 else []}
    configured.on("GET", "/api/searches/s_1/digest", digest)
    a = run(hc.search_digest("s_1"))
    assert a["previous_cursor"] == 0 and a["cursor"] == 3 and a["count"] == 1
    b = run(hc.search_digest("s_1"))
    assert b["previous_cursor"] == 3 and configured.last().url.params["since"] == "3"
    peek = run(hc.search_digest("s_1", advance=False))
    assert peek["previous_cursor"] == 6
    c = run(hc.search_digest("s_1"))
    assert c["previous_cursor"] == 6
    again = run(hc.search_digest("s_1", since=0))
    assert again["previous_cursor"] == 0 and again["cursor"] == 3


# ---------------------------------------------------------------- listings

def test_listing_upsert_sends_only_given_fields(configured):
    configured.on("PUT", "/api/searches/s_1/listings/fb-1", lambda r: {"listing": body(r), "created": True})
    run(hc.listing_upsert("s_1", "fb-1", title="Villa", price=23000000, fields={"pool": "private"}))
    assert body(configured.last("PUT")) == {"title": "Villa", "price": 23000000, "fields": {"pool": "private"}}
    with pytest.raises(ToolError, match="status must be"):
        run(hc.listing_upsert("s_1", "fb-1", status="maybe"))
    with pytest.raises(ToolError, match="Invalid id"):
        run(hc.listing_get("a/b"))


def test_listing_list_filters(configured):
    configured.on("GET", "/api/searches/s_1/listings", [])
    run(hc.listing_list("s_1", decision="want_view", q="pool"))
    p = configured.last().url.params
    assert p["decision"] == "want_view" and p["q"] == "pool" and "status" not in p


def _listing_and_search(crm, chat_id):
    crm.on("GET", "/api/listings/l1", {"listing": {"id": "l1", "search_id": "s_1"}, "viewings": []})
    crm.on("GET", "/api/searches/s_1", {"search": {"id": "s_1", "tg_chat_id": chat_id}})


def test_listing_photos_multipart(configured, tmp_path):
    _listing_and_search(configured, -100123)
    files = []
    for i in range(2):
        f = tmp_path / f"p{i}.jpg"
        f.write_bytes(b"\xff\xd8\xff" + bytes([i]) * 10)
        files.append(str(f))
    configured.on("POST", "/api/listings/l1/photos", {"photos": [{"file_id": "a"}, {"file_id": "b"}]})
    out = run(hc.listing_photos("l1", paths=files))
    assert len(out["photos"]) == 2
    req = configured.last("POST", "/api/listings/l1/photos")
    assert req.headers["content-type"].startswith("multipart/form-data")
    assert req.content.count(b'name="photo"') == 2 and b'filename="p0.jpg"' in req.content


def test_listing_photos_works_without_chat_and_rejects_bad_input(configured, tmp_path):
    _listing_and_search(configured, None)
    f = tmp_path / "a.jpg"
    f.write_bytes(b"x")
    configured.on("POST", "/api/listings/l1/photos", {"photos": [{"kv": "p/l1/0"}]})
    assert run(hc.listing_photos("l1", paths=[str(f)]))["photos"] == [{"kv": "p/l1/0"}]
    with pytest.raises(ToolError, match="max 10"):
        run(hc.listing_photos("l1", urls=[f"https://x/{i}.jpg" for i in range(11)]))
    with pytest.raises(ToolError, match="Not a photo"):
        v = tmp_path / "v.mp4"
        v.write_bytes(b"x")
        run(hc.listing_photos("l1", paths=[str(v)]))
    configured.on("POST", "/api/listings/l1/photos", lambda r: {"photos": [{"url": u} for u in body(r)["urls"]]})
    assert run(hc.listing_photos("l1", urls=["https://x/1.jpg"]))["photos"] == [{"url": "https://x/1.jpg"}]


def test_listing_publish_without_chat_is_mini_app_only(configured):
    _listing_and_search(configured, None)
    configured.on("POST", "/api/listings/l1/publish", {"ok": True})
    out = run(hc.listing_publish("l1"))
    assert out["posted"] is False and "Mini App" in out["note"]


# ---------------------------------------------------------------- contacts, messages, drafts

def test_contact_upsert_and_resolve(configured):
    configured.on("PUT", "/api/contacts/new", lambda r: {"contact": {"id": "c_1", **body(r)}, "channels": [], "listings": []})
    out = run(hc.contact_upsert(name="Wayan", role="owner", channels=[{"channel": "whatsapp", "address": "+62 823"}]))
    assert out["contact"]["name"] == "Wayan"
    assert "notes" not in body(configured.last("PUT"))
    with pytest.raises(ToolError):
        run(hc.contact_upsert(channels=[{"channel": "telegram"}]))
    configured.on("POST", "/api/contacts/resolve", {"contact": None})
    assert run(hc.contact_resolve("telegram", "@odegalle")) == {"contact": None}
    assert body(configured.last("POST")) == {"channel": "telegram", "address": "@odegalle"}
    with pytest.raises(ToolError):
        run(hc.contact_resolve())


def test_messages_log_batches_and_validates(configured):
    configured.on("POST", "/api/messages", lambda r: {"inserted": len(body(r)), "skipped": 0})
    msgs = [{"channel": "telegram", "direction": "in", "text": str(i), "external_id": f"tg:1:2:{i}", "search_id": "s_1"} for i in range(150)]
    out = run(hc.messages_log(msgs))
    assert out == {"inserted": 150, "skipped": 0}
    assert sum(1 for r in configured.requests if r.url.path == "/api/messages") == 2
    with pytest.raises(ToolError, match="direction"):
        run(hc.messages_log([{"channel": "telegram", "direction": "sideways"}]))
    with pytest.raises(ToolError, match="search_id"):
        run(hc.messages_log([{"channel": "telegram", "direction": "out", "text": "x"}]))
    out = run(hc.messages_log([{"channel": "telegram", "direction": "out", "text": "x", "listing_id": "l_1"}]))
    assert "warning" in out


def test_drafts_ready_uses_edited_text(configured):
    configured.on("GET", "/api/drafts", [
        {"id": "d1", "text": "original", "edited_text": None, "status": "approved"},
        {"id": "d2", "text": "original", "edited_text": "owner version", "status": "edited"},
    ])
    out = run(hc.drafts_ready("s_1"))
    assert configured.last().url.params["status"] == "ready"
    assert [d["final_text"] for d in out] == ["original", "owner version"]
    assert [d["was_edited"] for d in out] == [False, True]


def test_draft_create_and_mark(configured):
    configured.on("POST", "/api/drafts", lambda r: {"draft": {"id": "d1", "status": "pending", **body(r)}}, status=201)
    out = run(hc.draft_create("s_1", "telegram", "@x", "Hi! Is the villa free from Dec 1?", kind="first_contact", reason="new lead"))
    assert out["draft"]["status"] == "pending"
    with pytest.raises(ToolError, match="kind must be"):
        run(hc.draft_create("s_1", "telegram", "@x", "hi", kind="spam"))
    configured.on("PATCH", "/api/drafts/d1", lambda r: {"draft": {"id": "d1", **body(r)}})
    assert run(hc.draft_mark("d1", "sent"))["draft"]["status"] == "sent"
    with pytest.raises(ToolError):
        run(hc.draft_mark("d1", "approved"))


# ---------------------------------------------------------------- viewings, deals, notify

def test_viewing_update_keeps_existing_fields(configured):
    configured.on("GET", "/api/listings/l1", {"listing": {"id": "l1"}, "viewings": [
        {"id": "v_1", "starts_at": "2026-11-18T10:00:00+08:00", "status": "proposed", "meet_note": "gate 2", "outcome": None}]})
    configured.on("PUT", "/api/viewings/v_1", lambda r: {"viewing": body(r)})
    out = run(hc.viewing_set("s_1", "l1", "v_1", status="confirmed"))
    assert out["viewing"] == {"search_id": "s_1", "listing_id": "l1", "starts_at": "2026-11-18T10:00:00+08:00",
                              "status": "confirmed", "meet_note": "gate 2"}
    with pytest.raises(ToolError, match="offset"):
        run(hc.viewing_set("s_1", "l1", starts_at="2026-11-18 10:00"))
    with pytest.raises(ToolError, match="required"):
        run(hc.viewing_set("s_1", "l1"))


def test_viewings_day_and_plan(configured):
    configured.on("GET", "/api/searches/s_1/viewings", {"viewings": [], "route": None})
    run(hc.viewings_day("s_1", "2026-11-18"))
    assert configured.last().url.params["date"] == "2026-11-18"
    with pytest.raises(ToolError, match="Bad date"):
        run(hc.viewings_day("s_1", "18.11"))
    configured.on("POST", "/api/searches/s_1/day-plan", {"ok": True})
    assert run(hc.day_plan_post("s_1", "2026-11-18")) == {"ok": True}


def test_deal_set_ok_and_server_sensitive_hint(configured):
    configured.on("PUT", "/api/deals/l1", lambda r: {"deal": body(r)})
    assert run(hc.deal_set("l1", {"terms": {"price": 23000000}}))["deal"]["terms"]["price"] == 23000000
    configured.on("PUT", "/api/deals/l1", {"error": "sensitive", "message": "looks like passport numbers"}, status=400)
    with pytest.raises(ToolError, match="Reword"):
        run(hc.deal_set("l1", {"notes": "passport copy sent", "price": 23000000}))


def test_notify(configured):
    configured.on("POST", "/api/notify", {"ok": True})
    run(hc.notify("s_1", "Viewing moved to 11:00", to="chat"))
    assert body(configured.last())["to"] == "chat"
    with pytest.raises(ToolError):
        run(hc.notify("s_1", "x", to="everyone"))


def test_thread_set(configured):
    configured.on("PUT", "/api/threads", lambda r: {"thread": body(r), "created": True})
    out = run(hc.thread_set("s_1", "c_1", "waiting_us", known="22M + power", last="Sent the contract", listing_id="l1"))
    assert out["thread"] == {"search_id": "s_1", "contact_id": "c_1", "state": "waiting_us", "known": "22M + power",
                             "last": "Sent the contract", "listing_id": "l1"}
    with pytest.raises(ToolError, match="state"):
        run(hc.thread_set("s_1", "c_1", "open"))
    with pytest.raises(ToolError, match="too long"):
        run(hc.thread_set("s_1", "c_1", "closed", known="x" * 601))


def test_ratings_get_downloads_voice_once(configured):
    rating = {"score": 4.1, "criteria": {"overall": 4.5, "area": 4.5, "inside": 5, "quiet": 2.5}, "weak": ["quiet"],
              "by_member": [{"user_id": "u_1", "score": 3.8}],
              "notes": [{"user_id": "u_1", "note": "noisy road", "voice": "v/l1/u_1-abc"}, {"user_id": "u_2", "note": "ok"}]}
    configured.on("GET", "/api/searches/s_1/ratings", {"voters": 2, "listings": [
        {"listing_id": "l1", "price": 26000000, "interest": {"score": 3, "max": 6, "votes": 2}, "rating": rating},
        {"listing_id": "l2", "interest": {"score": 2, "max": 6, "votes": 1}, "rating": None}]})
    configured.on("GET", "/api/voice", lambda r: httpx.Response(200, content=b"OggS-audio", headers={"content-type": "audio/ogg"}))
    out = run(hc.ratings_get("s_1"))
    note = out["listings"][0]["rating"]["notes"][0]
    assert note["voice_path"].endswith(".ogg") and open(note["voice_path"], "rb").read() == b"OggS-audio"
    assert configured.last("GET", "/api/voice").url.params["key"] == "v/l1/u_1-abc"
    assert "voice_path" not in out["listings"][0]["rating"]["notes"][1]
    n = len([r for r in configured.requests if r.url.path == "/api/voice"])
    run(hc.ratings_get("s_1"))
    assert len([r for r in configured.requests if r.url.path == "/api/voice"]) == n  # cached
    out2 = run(hc.ratings_get("s_1", download_voice=False))
    assert "voice_path" not in out2["listings"][0]["rating"]["notes"][0]


def test_all_tools_registered():
    tools = run(hc.mcp.list_tools())
    names = {t.name for t in tools}
    expected = {
        "hunt_config_set", "hunt_status", "search_create", "search_list", "search_get", "search_update", "search_digest",
        "listing_upsert", "listing_list", "listing_get", "listing_update", "listing_photos", "listing_publish",
        "contact_resolve", "contact_upsert", "contact_link", "contact_messages", "messages_log",
        "draft_create", "drafts_ready", "draft_mark", "viewing_set", "viewings_day", "day_plan_post", "deal_set",
        "notify", "thread_set", "ratings_get", "region_list", "region_get", "region_doc", "time_info", "dates_between", "route_link",
        "listing_checks_set", "expense_add", "expenses_get", "shares_set", "living_get", "issue_set", "house_contact_set",
        "doc_list", "doc_get", "doc_set", "doc_request", "doc_summary_set", "doc_upload", "deal_dates_set",
    }
    assert expected <= names
    assert all(t.description for t in tools)


# ---------------------------------------------------------------- wave 2

def test_listing_checks_set_validates_and_guards(configured):
    configured.on("PUT", "/api/listings/l1/checks", lambda r: {"listing": {"id": "l1", "checks": body(r)}})
    out = run(hc.listing_checks_set("l1", "caution", [{"status": "warn", "title": "Same villa cheaper elsewhere", "detail": "17M on Rumah123"},
                                                      {"status": "todo", "title": "Owner not verified"}]))
    assert out["listing"]["checks"]["verdict"] == "caution" and "advice" not in body(configured.last("PUT"))
    with pytest.raises(ToolError, match="verdict"):
        run(hc.listing_checks_set("l1", "maybe", [{"status": "ok", "title": "x"}]))
    with pytest.raises(ToolError, match="signals"):
        run(hc.listing_checks_set("l1", "ok", [{"status": "fine", "title": "x"}]))
    with pytest.raises(ToolError, match="sensitive"):
        run(hc.listing_checks_set("l1", "ok", [{"status": "ok", "title": "Owner", "detail": "paid by card 4111 1111 1111 1111"}]))


def test_expense_add_and_shares(configured):
    configured.on("POST", "/api/searches/s_1/expenses", lambda r: {"expense": {"id": "x_1", **body(r)}})
    out = run(hc.expense_add("s_1", "Power tokens", 1500000.0, "u_b", kind="power", method="cash", date="2026-11-24"))
    sent = body(configured.last("POST"))
    assert sent == {"title": "Power tokens", "amount": 1500000, "paid_by": "u_b", "date": "2026-11-24", "kind": "power", "method": "cash"}
    assert out["expense"]["id"] == "x_1"
    for bad in (dict(kind="party"), dict(method="crypto"), dict(date="24.11")):
        with pytest.raises(ToolError):
            run(hc.expense_add("s_1", "x", 1, "u_b", **bad))
    with pytest.raises(ToolError, match="positive"):
        run(hc.expense_add("s_1", "x", 0, "u_b"))
    configured.on("PATCH", "/api/searches/s_1", lambda r: {"search": {"id": "s_1", **body(r)}})
    run(hc.shares_set("s_1", {"u_a": 2, "u_b": 1}))
    assert body(configured.last("PATCH")) == {"shares": {"u_a": 2, "u_b": 1}}
    configured.on("GET", "/api/searches/s_1/expenses", {"currency": "IDR", "balances": {}})
    assert run(hc.expenses_get("s_1"))["currency"] == "IDR"


def test_issue_and_house_contacts(configured):
    configured.on("PUT", "/api/issues/new", lambda r: {"issue": {"id": "is_1", **body(r)}})
    out = run(hc.issue_set("s_1", title="AC hums", note="wrote to Made"))
    assert out["issue"]["title"] == "AC hums" and "status" not in body(configured.last("PUT"))
    configured.on("PUT", "/api/issues/is_1", lambda r: {"issue": {"id": "is_1", **body(r)}})
    run(hc.issue_set("s_1", "is_1", status="scheduled", scheduled_at="2026-11-21T10:00:00+08:00"))
    with pytest.raises(ToolError, match="offset"):
        run(hc.issue_set("s_1", "is_1", status="scheduled", scheduled_at="tomorrow 10:00"))
    with pytest.raises(ToolError, match="title"):
        run(hc.issue_set("s_1"))
    configured.on("PUT", "/api/house-contacts/new", lambda r: {"contact": {"id": "hc_1", **body(r)}})
    run(hc.house_contact_set("s_1", name="Wayan", role="cleaning", cost=400000, currency="IDR", period="month", payer="rent", schedule="Tue, Fri"))
    assert body(configured.last("PUT"))["payer"] == "rent"
    with pytest.raises(ToolError, match="payer"):
        run(hc.house_contact_set("s_1", name="X", payer="owner"))
    configured.on("DELETE", "/api/house-contacts/hc_1", {"ok": True})
    assert run(hc.house_contact_set("s_1", "hc_1", delete=True)) == {"ok": True}


def test_docs_summary_request_and_dates(configured):
    configured.on("PUT", "/api/documents/new", lambda r: {"document": {"id": "doc_1", **body(r)}})
    out = run(hc.doc_request("l1", "owner_consent", "Owner consent", note="Without it the sublease is a risk"))
    assert out["document"]["status"] == "request"
    configured.on("PUT", "/api/documents/doc_1", lambda r: {"document": {"id": "doc_1", **body(r)}})
    run(hc.doc_summary_set("doc_1", [{"icon": "wallet", "title": "Money", "text": "22M a month, cash"}], changes="Added the deposit deadline", changes_from=1, version=2))
    sent = body(configured.last("PUT"))
    assert sent["summary"]["changes_from"] == 1 and sent["version"] == 2
    with pytest.raises(ToolError, match="sensitive"):
        run(hc.doc_summary_set("doc_1", [{"icon": "users", "title": "Landlord", "text": "Natalia, passport 7512 345678"}]))
    with pytest.raises(ToolError, match="title"):
        run(hc.doc_set("l1"))
    with pytest.raises(ToolError, match="kind"):
        run(hc.doc_set("l1", title="x", kind="contract"))
    configured.on("PUT", "/api/deals/l1/dates", lambda r: {"deal": body(r)})
    out = run(hc.deal_dates_set("l1", [{"date": "2026-12-23", "kind": "payment", "title": "Second month", "amount": 22000000}]))
    assert out["deal"]["dates"][0]["kind"] == "payment"
    with pytest.raises(ToolError):
        run(hc.deal_dates_set("l1", [{"date": "2026-12-23", "kind": "rent", "title": "x"}]))


def test_doc_get_downloads_and_upload_multipart(configured, tmp_path):
    configured.on("GET", "/api/documents/doc_1", {"document": {"id": "doc_1", "has_file": True, "file_name": "lease v2.pdf"}})
    configured.on("GET", "/api/documents/doc_1/file", lambda r: httpx.Response(200, content=b"%PDF-1.7", headers={"content-type": "application/pdf"}))
    out = run(hc.doc_get("doc_1", out_dir=str(tmp_path)))
    assert out["path"].startswith(str(tmp_path)) and open(out["path"], "rb").read() == b"%PDF-1.7"
    configured.on("GET", "/api/documents/doc_2", {"document": {"id": "doc_2", "has_file": False}})
    assert run(hc.doc_get("doc_2"))["path"] is None
    f = tmp_path / "lease.pdf"
    f.write_bytes(b"%PDF-1.7 test")
    configured.on("POST", "/api/listings/l1/documents", {"document": {"id": "doc_3", "has_file": True}}, status=201)
    run(hc.doc_upload("l1", str(f), kind="lease", version=2, pages=7))
    req = configured.last("POST", "/api/listings/l1/documents")
    assert req.headers["content-type"].startswith("multipart/form-data")
    assert b'name="file"; filename="lease.pdf"' in req.content and b'name="version"' in req.content and b"lease" in req.content
    with pytest.raises(ToolError, match="not found"):
        run(hc.doc_upload("l1", str(tmp_path / "nope.pdf")))


def test_ratings_get_onsite_labels_and_photos(configured, tmp_path, monkeypatch):
    regions = tmp_path / "regions" / "xx"
    regions.mkdir(parents=True)
    (regions / "pack.yaml").write_text("id: xx\n")
    (regions / "checklist.yaml").write_text('items:\n  - id: ac_all\n    icon: air-vent\n    label: {en: "Every AC works", ru: "Все кондиционеры работают"}\n')
    monkeypatch.setenv("HUNT_REGIONS", str(tmp_path / "regions"))
    configured.on("GET", "/api/searches/s_1/ratings", {"region": "xx/alpha", "voters": 2, "listings": [
        {"listing_id": "l1", "interest": {"score": 0, "max": 6, "votes": 0}, "rating": None,
         "onsite": {"items": {"ac_all": {"ok": 0, "not_ok": 1, "notes": [{"name": "Alex", "ok": False, "note": "bedroom 2 hums"}]}}, "photos": ["o/l1/u_a-1"]}}]})
    configured.on("GET", "/api/media", lambda r: httpx.Response(200, content=b"\xff\xd8jpg", headers={"content-type": "image/jpeg"}))
    out = run(hc.ratings_get("s_1", download_photos=True))
    os_ = out["listings"][0]["onsite"]
    assert os_["items"]["ac_all"]["label"]["en"] == "Every AC works"
    assert os_["photo_paths"][0].endswith(".jpg")


def test_region_doc_scam_and_checklist_names():
    with pytest.raises(ToolError, match="not found"):
        hc.read_doc("xx", "scam.md")
    with pytest.raises(ToolError, match="name must be"):
        hc.read_doc("xx", "secrets.md")


# ---------------------------------------------------------------- wave 3

def test_wave3_tools_registered():
    names = {t.name for t in run(hc.mcp.list_tools())}
    assert {
        "contact_get", "contact_note_add", "rooms_set", "money_mode_set", "power_get", "power_reading_set", "moveout_set", "moveout_get",
        "relet_set", "relet_lead_set", "directory_get", "dir_entry_set", "dir_group_add", "travel_times_set", "travel_times_refresh", "region_districts",
    } <= names


def test_contact_resolve_passes_search_and_notes(configured):
    configured.on("POST", "/api/contacts/resolve", {"contact": {"id": "c1"}, "notes": [{"text": "x"}], "notes_elsewhere": [{"text": "x"}], "stats": {"searches": 2}})
    out = run(hc.contact_resolve(channel="telegram", address="@erna", search_id="s1"))
    assert json.loads(configured.last("POST").content) == {"channel": "telegram", "address": "@erna", "search_id": "s1"}
    assert out["notes_elsewhere"]
    configured.on("GET", "/api/contacts/c1", {"contact": {"id": "c1"}, "notes": []})
    run(hc.contact_get("c1", search_id="s1"))
    assert configured.last("GET").url.params["search_id"] == "s1"


def test_contact_note_add_validates(configured):
    configured.on("POST", "/api/contacts/c1/notes", {"note": {"id": "pn_1"}}, status=201)
    run(hc.contact_note_add("c1", "Repairs at his cost", 1, search_id="s1"))
    assert json.loads(configured.last("POST").content) == {"text": "Repairs at his cost", "sentiment": 1, "search_id": "s1"}
    with pytest.raises(ToolError, match="sentiment"):
        run(hc.contact_note_add("c1", "x", 5))
    with pytest.raises(ToolError, match="passport"):
        run(hc.contact_note_add("c1", "passport number AB1234567", -1))


def test_rooms_and_money_mode(configured):
    configured.on("PATCH", "/api/searches/s1", {"search": {"id": "s1"}})
    run(hc.rooms_set("s1", [{"name": "Master", "user_id": "u1", "share": 55}, {"name": "Second", "user_id": "u2", "share": 45}], others_equal=False))
    assert json.loads(configured.last("PATCH").content) == {"rooms": {"rooms": [{"name": "Master", "user_id": "u1", "share": 55}, {"name": "Second", "user_id": "u2", "share": 45}], "others_equal": False}}
    with pytest.raises(ToolError, match="add up to 100"):
        run(hc.rooms_set("s1", [{"name": "A", "user_id": "u1", "share": 60}]))
    run(hc.rooms_set("s1", None))
    assert json.loads(configured.last("PATCH").content) == {"rooms": None}
    run(hc.money_mode_set("s1", "shared"))
    assert json.loads(configured.last("PATCH").content) == {"money_mode": "shared"}
    with pytest.raises(ToolError):
        run(hc.money_mode_set("s1", "pool"))


def test_power_get_downloads_waiting_photos_and_reading(configured):
    configured.on("GET", "/api/searches/s1/power", {"balance": 10, "readings": [{"kind": "photo", "photo": "m/s1/u_a-k1"}, {"kind": "reading", "kwh": 40, "photo": None}]})
    configured.on("GET", "/api/media", lambda req: httpx.Response(200, content=b"\xff\xd8", headers={"content-type": "image/jpeg"}))
    out = run(hc.power_get("s1"))
    assert out["photo_paths"]["m/s1/u_a-k1"].endswith(".jpg")
    configured.on("POST", "/api/searches/s1/power", {"reading": {"id": "mr_1"}}, status=201)
    run(hc.power_reading_set("s1", 38.5, photo="m/s1/u_a-k1", note="ACs at night"))
    assert json.loads(configured.last("POST").content) == {"kind": "reading", "kwh": 38.5, "photo": "m/s1/u_a-k1", "note": "ACs at night"}
    with pytest.raises(ToolError):
        run(hc.power_reading_set("s1", 5, kind="photo"))


def test_moveout_and_relet(configured):
    configured.on("PUT", "/api/searches/s1/moveout", {"moveout": {}})
    run(hc.moveout_set("s1", date="2026-11-21", steps={"notice": {"status": "done", "note": "20.11 WhatsApp"}}, pushback={"who": "Erna", "quote": "6 months", "points": "no penalty"}))
    b = json.loads(configured.last("PUT").content)
    assert b["date"] == "2026-11-21" and b["steps"]["notice"]["status"] == "done" and b["pushback"]["who"] == "Erna"
    run(hc.moveout_set("s1", clear_pushback=True))
    assert json.loads(configured.last("PUT").content) == {"pushback": None}
    with pytest.raises(ToolError, match="Unknown step"):
        run(hc.moveout_set("s1", steps={"party": {"status": "done"}}))
    with pytest.raises(ToolError, match="YYYY-MM-DD"):
        run(hc.moveout_set("s1", date="21.11"))
    configured.on("PUT", "/api/searches/s1/relet", {"relet": {}})
    run(hc.relet_set("s1", consent="yes", channels=[{"kind": "telegram", "count": 6}], price=23000000, currency="IDR"))
    assert json.loads(configured.last("PUT").content)["consent"] == "yes"
    with pytest.raises(ToolError, match="consent"):
        run(hc.relet_set("s1", consent="maybe"))
    configured.on("PUT", "/api/searches/s1/relet/leads/new", {"lead": {"id": "rl_1"}}, status=201)
    run(hc.relet_lead_set("s1", name="Anna", status="viewing", note="tomorrow 15:00"))
    with pytest.raises(ToolError, match="name"):
        run(hc.relet_lead_set("s1"))
    with pytest.raises(ToolError, match="status"):
        run(hc.relet_lead_set("s1", "rl_1", status="hot"))


def test_directory_tools(configured):
    configured.on("PUT", "/api/searches/s1/directory/new", {"entry": {"id": "dr_1"}}, status=201)
    run(hc.dir_entry_set("s1", group="bikes", name="Bike Rental", channel="whatsapp", address="+62 811"))
    assert json.loads(configured.last("PUT").content) == {"grp": "bikes", "name": "Bike Rental", "channel": "whatsapp", "address": "+62 811"}
    with pytest.raises(ToolError, match="channel"):
        run(hc.dir_entry_set("s1", name="X", channel="email"))
    configured.on("DELETE", "/api/searches/s1/directory/dr_1", {"ok": True})
    run(hc.dir_entry_set("s1", "dr_1", delete=True))
    configured.on("POST", "/api/searches/s1/directory-groups", {"groups": [{"key": "g1", "name": "Kids"}]})
    assert run(hc.dir_group_add("s1", "Kids"))["groups"][0]["name"] == "Kids"


def test_travel_times_refresh_uses_valhalla_cache_and_rush(configured, monkeypatch):
    monkeypatch.setattr(hc, "_VALHALLA_MIN_INTERVAL", 0)
    configured.on("GET", "/api/searches/s1", {"search": {"id": "s1", "region": "xx/alpha", "brief": {
        "anchors": [{"id": "a_surf", "name": "Surf", "lat": -8.85, "lng": 115.17, "mode": "scooter"}, {"id": "a_dps", "name": "Airport", "lat": -8.74, "lng": 115.17, "mode": "car"}]}}})
    configured.on("GET", "/api/searches/s1/listings", [
        {"id": "l1", "lat": -8.80, "lng": 115.16, "status": "new", "travel": None},
        {"id": "l2", "lat": None, "lng": None, "status": "new"},
    ])
    calls = []

    def route(req):
        b = json.loads(req.content)
        calls.append(b["costing"])
        return {"trip": {"summary": {"time": 600, "length": 4.0}}}
    configured.on("POST", "/route", route)
    configured.on("PUT", "/api/listings/l1/travel", {"travel": {}})
    out = run(hc.travel_times_refresh("s1"))
    assert out["rush_factor"] == 1.5 and calls == ["motor_scooter", "auto"]
    body = json.loads(configured.last("PUT", "/api/listings/l1/travel").content)
    assert body["times"][0] == {"anchor_id": "a_surf", "minutes": 15, "km": 4.0, "mode": "scooter"}
    run(hc.travel_times_refresh("s1", force=True))  # second run: served from the disk cache
    assert len(calls) == 2
    with pytest.raises(ToolError, match="anchor_id"):
        run(hc.travel_times_set("l1", [{"minutes": 3}]))


def test_region_districts_and_point():
    out = run(hc.region_districts("xx/alpha", lat=-8.7, lng=115.1))
    assert list(out["areas"]) == ["north"] and out["area"] == "north"
    assert run(hc.region_districts("xx", lat=-9.5, lng=115.1))["area"] is None
    assert "districts.yaml" in hc.available_docs("xx")
