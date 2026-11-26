#!/usr/bin/env python3
"""The smallest Hunt bridge: one fake chat in memory that answers itself. Start here to write a real one.
   BRIDGE_TOKEN=secret python3 echo_bridge.py [port]      then in Claude Code: bridge_add("echo", "http://localhost:8799", "secret")
"""
import hmac
import json
import os
import sys
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

TOKEN = os.environ.get("BRIDGE_TOKEN") or sys.exit("set BRIDGE_TOKEN")
CHATS = {"@echo": {"display": "Echo", "messages": []}}


def add(peer, direction, text):
    m = CHATS.setdefault(peer, {"display": peer, "messages": []})["messages"]
    m.append({"id": str(len(m) + 1), "dir": direction, "at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "text": text, "media": []})
    return m[-1]["id"]


class Bridge(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def answer(self, data, status=200):
        b = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def handle_one(self, method):
        if not hmac.compare_digest(self.headers.get("authorization", ""), f"Bearer {TOKEN}"):
            return self.answer({"error": "bad_token"}, 401)
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        body = json.loads(self.rfile.read(int(self.headers.get("content-length") or 0)) or b"{}") if method == "POST" else {}
        chat = CHATS.get(q.get("peer", ""), {"display": "", "messages": []})
        match (method, u.path):
            case ("GET", "/v1/about"):
                self.answer({"contract": 1, "channel": "echo", "name": "Echo", "features": ["resolve"]})
            case ("GET", "/v1/status"):
                self.answer({"connected": True, "account": "@me"})
            case ("POST", "/v1/login"):
                self.answer({"status": "connected"})
            case ("GET", "/v1/inbox"):
                self.answer({"chats": [{"peer": p, "display": c["display"], "unread": 0, "last_at": c["messages"][-1]["at"], "last_text": c["messages"][-1]["text"]} for p, c in CHATS.items() if c["messages"]], "cursor": None})
            case ("GET", "/v1/history"):
                self.answer({"peer": q.get("peer"), "display": chat["display"], "messages": chat["messages"][-int(q.get("limit", 200)):]})
            case ("GET", "/v1/resolve"):
                self.answer({"matches": [{"peer": p, "display": c["display"]} for p, c in CHATS.items() if q.get("query", "").lower() in f"{p} {c['display']}".lower()]})
            case ("POST", "/v1/send"):
                i = add(body["peer"], "out", body["text"])
                add(body["peer"], "in", f"echo: {body['text']}")
                self.answer({"status": "sent", "id": i})
            case _:
                self.answer({"error": "not_found"}, 404)

    def do_GET(self):
        self.handle_one("GET")

    def do_POST(self):
        self.handle_one("POST")


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1]) if len(sys.argv) > 1 else 8799), Bridge).serve_forever()
