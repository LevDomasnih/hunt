"""Wave 10 · orders from suppliers: supplier_set, catalog_import (path | items), catalog_get, orders_get, order_set against a
mocked CRM. No network."""
import asyncio
import json

import httpx
import pytest

import hunt_core as hc
from hunt_core import ToolError

URL = "https://crm.test"


def run(coro):
    return asyncio.run(coro)


@pytest.fixture
def net(monkeypatch, isolated):
    reqs = []

    def handler(req: httpx.Request) -> httpx.Response:
        reqs.append(req)
        return httpx.Response(200, json={"ok": True, "path": req.url.path})

    hc.update_config(lambda c: c.__setitem__("api_url", URL))
    isolated.set_password("hunt", URL, "hunt_test_token")
    monkeypatch.setattr(hc, "_TRANSPORT", httpx.MockTransport(handler))
    return reqs


def body(req):
    return json.loads(req.content)


def test_supplier_set(net):
    run(hc.supplier_set("s_1", {"name": "Fruit Market", "kind": "fruit", "min_free_delivery": 300000, "hours": None}))
    assert net[-1].method == "PUT" and net[-1].url.path == "/api/searches/s_1/suppliers/new"
    assert body(net[-1])["min_free_delivery"] == 300000 and body(net[-1])["hours"] is None
    run(hc.supplier_set("s_1", {"hours": "08:00-17:00", "delivery_fee": 30000}, supplier_id="su_abc"))
    assert body(net[-1])["delivery_fee"] == 30000
    assert net[-1].url.path == "/api/searches/s_1/suppliers/su_abc"


@pytest.mark.parametrize("fields,err", [
    ({"kind": "fruit"}, "needs name"),
    ({"name": "x", "kind": "bread"}, "kind"),
    ({"name": "x", "channel": "fax"}, "channel"),
    ({"name": "x", "hours": "all day"}, "hours"),
    ({"name": "x", "min_free_delivery": -1}, "min_free_delivery"),
    ({"name": "x", "delivery_fee": 0}, "delivery_fee"),
    ({"name": "x", "lang": "fr"}, "lang"),
    ({"name": "x", "password": "1"}, "unknown keys"),
    ({"name": "x", "note_ru": "y" * 201}, "longer"),
])
def test_supplier_validation(net, fields, err):
    with pytest.raises(ToolError, match=err):
        run(hc.supplier_set("s_1", fields))
    assert not net


def test_supplier_id_checked(net):
    with pytest.raises(ToolError, match="supplier id"):
        run(hc.supplier_set("s_1", {"name": "x"}, supplier_id="../x"))


def test_import_from_file(net, tmp_path):
    f = tmp_path / "fruit.json"
    f.write_text(json.dumps({"price_at": "2026-11-24", "items": [{"name_id": "Kangkung ", "price": 2500, "unit": "pcs"}, {"name_id": "Asparagus", "price": None}]}))
    run(hc.catalog_import("s_1", "su_a", path=str(f)))
    assert net[-1].method == "POST" and net[-1].url.path == "/api/searches/s_1/suppliers/su_a/import"
    b = body(net[-1])
    assert b["price_at"] == "2026-11-24" and b["items"][0]["name_id"] == "Kangkung" and b["items"][1]["price"] is None and "full" not in b
    f.write_text(json.dumps([{"name_id": "A"}]))
    run(hc.catalog_import("s_1", "su_a", path=str(f), full=True, price_at="2026-12-01"))
    assert body(net[-1])["full"] is True and body(net[-1])["price_at"] == "2026-12-01"


def test_import_errors(net, tmp_path):
    with pytest.raises(ToolError, match="either"):
        run(hc.catalog_import("s_1", "su_a"))
    with pytest.raises(ToolError, match="No file"):
        run(hc.catalog_import("s_1", "su_a", path=str(tmp_path / "no.json")))
    pdf = tmp_path / "x.pdf"
    pdf.write_text("x")
    with pytest.raises(ToolError, match=".json"):
        run(hc.catalog_import("s_1", "su_a", path=str(pdf)))
    bad = tmp_path / "bad.json"
    bad.write_text("{")
    with pytest.raises(ToolError, match="not valid JSON"):
        run(hc.catalog_import("s_1", "su_a", path=str(bad)))
    for items, err in [([], "non-empty"), ([{"name_ru": "x"}], r"items\[0\].*name_id"), ([{"name_id": "A"}, {"name_id": " A"}], "duplicate"), ([{"name_id": "A", "unit": "ton"}], "unit"),
                       ([{"name_id": "A", "price": "90.000"}], "price"), ([{"name_id": "A", "cost": 1}], "unknown keys"), ([{"name_id": f"n{i}"} for i in range(501)], "500")]:
        with pytest.raises(ToolError, match=err):
            run(hc.catalog_import("s_1", "su_a", items=items))
    with pytest.raises(ToolError, match="price_at"):
        run(hc.catalog_import("s_1", "su_a", items=[{"name_id": "A"}], price_at="24.11.2026"))
    assert not net


def test_reads(net):
    run(hc.catalog_get("s_1"))
    assert net[-1].url.path == "/api/searches/s_1/suppliers"
    run(hc.catalog_get("s_1", "su_a"))
    assert net[-1].url.path == "/api/searches/s_1/suppliers/su_a/catalog"
    run(hc.orders_get("s_1", status="sent"))
    assert net[-1].url.path == "/api/searches/s_1/orders" and net[-1].url.params["status"] == "sent"
    with pytest.raises(ToolError, match="status"):
        run(hc.orders_get("s_1", status="lost"))


def test_order_set(net):
    run(hc.order_set("s_1", "or_a", status="confirmed", total=205000, deliver_time="16:00", reply="Bisa"))
    assert net[-1].method == "PATCH" and net[-1].url.path == "/api/searches/s_1/orders/or_a"
    assert body(net[-1]) == {"status": "confirmed", "total": 205000, "deliver_time": "16:00", "reply": "Bisa"}


@pytest.mark.parametrize("kw,err", [
    ({"status": "delivered"}, "pay themselves"), ({"status": "basket"}, "status"), ({"total": 0}, "total"), ({"deliver_time": "4pm"}, "HH:MM"), ({"deliver_day": "завтра"}, "YYYY"), ({}, "Nothing"),
    ({"reply": "x" * 1001}, "longer"),
])
def test_order_set_validation(net, kw, err):
    with pytest.raises(ToolError, match=err):
        run(hc.order_set("s_1", "or_a", **kw))
    with pytest.raises(ToolError, match="order id"):
        run(hc.order_set("s_1", "x", status="sent"))
    assert not net


def test_the_agent_has_no_tool_to_order_or_pay():
    names = {n for n in dir(hc) if n.startswith(("order_", "basket_", "supplier_", "catalog_"))}
    assert {"order_set", "supplier_set", "catalog_import", "catalog_get"} <= names
    assert not {n for n in names if n in ("order_create", "order_send", "order_pay", "basket_set")}
