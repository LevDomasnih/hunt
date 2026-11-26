"""Bridges end to end against the example bridge on a local port."""
import asyncio
import os
import socket
import subprocess
import sys
import time
from pathlib import Path

import httpx
import pytest

import hunt_bridge as hb
from hunt_bridge import ToolError

ECHO = Path(__file__).resolve().parents[2] / "channels" / "examples" / "echo_bridge.py"


def run(c):
    return asyncio.run(c)


@pytest.fixture
def url(isolated, monkeypatch):
    import keyring
    monkeypatch.setattr(keyring, "delete_password", lambda s, u: isolated.store.pop((s, u), None))
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    p = subprocess.Popen([sys.executable, str(ECHO), str(port)], env={**os.environ, "BRIDGE_TOKEN": "secret"})
    u = f"http://localhost:{port}"
    for _ in range(100):
        try:
            httpx.get(u)
            break
        except httpx.HTTPError:
            time.sleep(0.05)
    yield u
    p.kill()
    p.wait()


def test_whole_way(url, isolated, monkeypatch):
    monkeypatch.setitem(hb.PACE, "min_interval_s", 0)
    monkeypatch.setitem(hb.PACE, "new_chat_interval_s", 0)
    r = run(hb.bridge_add("echo-1", url, "secret"))
    assert r["channel"] == "echo" and isolated.store[("hunt-bridge", "echo-1")] == "secret"
    assert "secret" not in (hb.config_dir() / "bridges.json").read_text()
    assert run(hb.bridge_status("echo-1"))["connected"]
    assert run(hb.bridge_resolve("echo-1", "ech"))["matches"][0]["peer"] == "@echo"
    assert run(hb.bridge_send("echo-1", "@echo", "привет", expect_display="Somebody"))["status"] == "wrong_chat"
    assert run(hb.bridge_history("echo-1", "@echo"))["messages"] == []
    assert run(hb.bridge_send("echo-1", "@echo", "привет", expect_display="echo"))["status"] == "sent"
    assert [m["dir"] for m in run(hb.bridge_history("echo-1", "@echo"))["messages"]] == ["out", "in"]
    assert run(hb.bridge_send("echo-1", "@echo", "привет"))["status"] == "already_sent"
    assert run(hb.bridge_inbox("echo-1"))["chats"][0]["last_text"] == "echo: привет"
    ch = run(hb.channels_list())
    assert ch["bridges"][0]["channel"] == "echo" and {x["channel"] for x in ch["built_in"]} >= {"telegram", "whatsapp", "messenger", "instagram"}
    run(hb.bridge_remove("echo-1"))
    assert not isolated.store and run(hb.channels_list())["bridges"] == []


def test_pace(url, monkeypatch):
    run(hb.bridge_add("echo-1", url, "secret"))
    assert run(hb.bridge_send("echo-1", "@a", "one"))["status"] == "sent"
    r = run(hb.bridge_send("echo-1", "@b", "two"))
    assert r["status"] == "paced" and r["retry_after"] > 60
    assert run(hb.bridge_history("echo-1", "@b"))["messages"] == []
    monkeypatch.setitem(hb.PACE, "min_interval_s", 0)
    monkeypatch.setitem(hb.PACE, "new_chat_interval_s", 0)
    monkeypatch.setitem(hb.PACE, "max_new_chats_per_day", 1)
    assert run(hb.bridge_send("echo-1", "@b", "two"))["reason"].startswith("new chats")
    assert run(hb.bridge_send("echo-1", "@a", "again"))["status"] == "sent"  # a known chat is not a new one


def test_refusals(url):
    for bad in ("http://example.com", "ftp://localhost", "https://u:p@example.com", "javascript:1", ""):
        with pytest.raises(ToolError):
            run(hb.bridge_add("x1", bad, "t"))
    with pytest.raises(ToolError, match="not a Hunt bridge"):
        run(hb.bridge_add("x1", url, "wrong"))
    with pytest.raises(ToolError):
        run(hb.bridge_add("../x", url, "secret"))
    with pytest.raises(ToolError, match="No bridge"):
        run(hb.bridge_send("nope", "@a", "x"))
    assert run(hb.channels_list())["bridges"] == []


def test_a_bridge_replaces_the_built_in_channel_and_unknown_is_unknown(isolated, monkeypatch):
    def f(req):
        if req.url.path == "/v1/about":
            return httpx.Response(200, json={"contract": 1, "channel": "whatsapp", "name": "My WhatsApp"})
        if req.url.path == "/v1/history":
            return httpx.Response(200, json={"display": "Owner", "messages": []})
        return httpx.Response(200, json={"status": "maybe"})

    monkeypatch.setattr(hb, "_TRANSPORT", httpx.MockTransport(f))
    run(hb.bridge_add("wa", "https://bridge.example", "t"))
    wa = next(x for x in run(hb.channels_list())["built_in"] if x["channel"] == "whatsapp")
    assert wa["use"] is False
    assert run(hb.bridge_send("wa", "+628", "hi"))["status"] == "unknown"
