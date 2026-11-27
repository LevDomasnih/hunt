"""hunt_browser: instagram."""
from __future__ import annotations
import asyncio
import contextlib
import json
import re
import time
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote
from huntbrowser.base import ToolError
from playwright.async_api import Page
from playwright.async_api import Error as PWError
from playwright.async_api import TimeoutError as PWTimeout
from huntbrowser import base as _base, helpers as _helpers, js as _js, pacing as _pacing, session as _session
# ---------------------------------------------------------------- Instagram

IG_API_JS = r"""
async ([path, method, form]) => {
  const csrf = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1] || '';
  const opts = {method: method || 'GET', credentials: 'include', headers: {
    'X-IG-App-ID': '""" + _base.IG_APP_ID + r"""', 'X-CSRFToken': csrf, 'X-Requested-With': 'XMLHttpRequest',
    'X-IG-WWW-Claim': sessionStorage.getItem('www-claim-v2') || '0'}};
  if (form) { opts.headers['Content-Type'] = 'application/x-www-form-urlencoded'; opts.body = form; }
  const r = await fetch(path, opts);
  return {status: r.status, body: await r.text()};
}
"""

IG_BOX = 'div[role="textbox"][contenteditable="true"], textarea[placeholder*="essage"]'


def _ig_time(ts: Any) -> str | None:
    try:
        v = int(ts)
    except (TypeError, ValueError):
        return None
    if v > 10**14:
        v //= 1_000_000
    elif v > 10**11:
        v //= 1000
    return datetime.fromtimestamp(v).astimezone().isoformat(timespec="minutes")


def ig_item(item: dict, viewer_id: str) -> dict:
    """Instagram direct item -> Hunt message dict (text + media descriptors)."""
    t = item.get("item_type") or "unknown"
    out: dict[str, Any] = {"id": item.get("item_id"), "dir": "out" if str(item.get("user_id")) == str(viewer_id) else "in",
                           "time": _ig_time(item.get("timestamp")), "type": t, "text": item.get("text") or "", "media": []}

    def best_image(m: dict) -> str | None:
        c = ((m or {}).get("image_versions2") or {}).get("candidates") or []
        return max(c, key=lambda x: x.get("width", 0) * x.get("height", 0)).get("url") if c else None

    def media_desc(m: dict, kind: str) -> dict:
        d: dict[str, Any] = {"type": kind}
        if m.get("video_versions"):
            d["type"] = "video"
            d["url"] = m["video_versions"][0].get("url")
        img = best_image(m)
        if img:
            d["image_url"] = img
        if m.get("code"):
            d["post"] = f"https://www.instagram.com/p/{m['code']}/"
        cap = (m.get("caption") or {}).get("text") if isinstance(m.get("caption"), dict) else None
        if cap:
            d["caption"] = cap
        return d

    if t == "media":
        m = item.get("media") or {}
        out["media"].append(media_desc(m, "image"))
    elif t in ("media_share", "clip", "felix_share", "story_share", "reel_share"):
        m = item.get(t) or {}
        inner = m.get("media") or m.get("clip") or m
        out["media"].append(media_desc(inner, t))
        if m.get("text"):
            out["text"] = out["text"] or m["text"]
    elif t == "link":
        ln = item.get("link") or {}
        out["text"] = ln.get("text") or out["text"]
        url = (ln.get("link_context") or {}).get("link_url")
        if url:
            out["media"].append({"type": "link", "url": url})
    elif t == "voice_media":
        out["media"].append({"type": "voice"})
    elif t == "animated_media":
        out["media"].append({"type": "gif"})
    elif t == "like":
        out["text"] = out["text"] or item.get("like") or "❤️"
    elif t == "action_log":
        out["dir"] = "system"
        out["text"] = (item.get("action_log") or {}).get("description") or ""
    elif t.startswith("xma"):
        for x in item.get(t) or []:
            out["media"].append({"type": "link", "url": x.get("target_url"), "title": x.get("title_text")})
    elif t == "raven_media" or t == "visual_media":
        out["media"].append({"type": "disappearing_media"})
    elif t == "placeholder":
        out["text"] = out["text"] or ((item.get("placeholder") or {}).get("message") or "")
    return out


def ig_peer(peer: str) -> tuple[str | None, str | None]:
    """(thread_id, username) from a thread URL/id or @username/profile URL."""
    s = (peer or "").strip()
    m = re.search(r"/direct/t/(\d+)", s)
    if m:
        return m.group(1), None
    if re.fullmatch(r"\d{15,}", s):
        return s, None
    m = re.search(r"instagram\.com/([A-Za-z0-9._]+)/?", s)
    if m and m.group(1) not in ("direct", "p", "reel", "stories"):
        return None, m.group(1)
    s = s.lstrip("@")
    if re.fullmatch(r"[A-Za-z0-9._]{1,30}", s):
        return None, s
    return None, None


class Instagram:
    channel = "instagram"
    cookie = "sessionid"

    def __init__(self, base: str = _base.IG):
        self.base = base

    async def ensure_origin(self, page: Page, sess: _session.Session) -> None:
        ck = await sess.cookies(self.base)
        if not ck.get(self.cookie):
            raise _session.LoginNeeded("Instagram is not logged in: call ig_login (a window opens; the hunter logs in).")
        if not page.url.startswith(self.base):
            await page.goto(self.base + "/direct/inbox/", wait_until="domcontentloaded")
            await page.wait_for_timeout(2500)
        if "/accounts/login" in page.url or "/challenge" in page.url:
            raise _session.LoginNeeded("Instagram wants the hunter to log in again or pass a check: call ig_login.")

    async def api(self, page: Page, path: str, method: str = "GET", form: str | None = None) -> dict:
        r = await _session.safe_eval(page, IG_API_JS, [path, method, form], None)
        if not r:
            raise ToolError("Instagram API call failed (page navigated?); retry.")
        if r["status"] in (401, 403) or '"require_login"' in r["body"][:500]:
            raise _session.LoginNeeded("Instagram session expired: call ig_login.")
        if r["status"] == 429:
            raise ToolError("Instagram says 'please wait a few minutes' (429). Stop Instagram for now.")
        try:
            data = json.loads(r["body"])
        except json.JSONDecodeError:
            raise ToolError(f"Instagram API {path.split('?')[0]} returned {r['status']} (not JSON).")
        if r["status"] >= 400:
            raise ToolError(f"Instagram API {path.split('?')[0]} -> {r['status']}: {str(data.get('message', ''))[:200]}")
        return data

    async def status(self, page: Page, sess: _session.Session) -> dict:
        try:
            await self.ensure_origin(page, sess)
            me = await self.api(page, "/api/v1/accounts/current_user/?edit=true")
        except _session.LoginNeeded as e:
            return {"logged_in": False, "how": str(e)}
        u = me.get("user") or {}
        return {"logged_in": True, "user_id": str(u.get("pk") or u.get("pk_id") or ""), "username": u.get("username"),
                "full_name": u.get("full_name")}

    def _thread_summary(self, t: dict, viewer: str, request: bool = False) -> dict:
        users = [{"user_id": str(u.get("pk")), "username": u.get("username"), "full_name": u.get("full_name")}
                 for u in t.get("users") or []]
        items = t.get("items") or []
        last = ig_item(items[0], viewer) if items else None
        seen = (t.get("last_seen_at") or {}).get(str(viewer), {}).get("item_id")
        unread = bool(t.get("read_state")) or (last is not None and last["dir"] == "in" and seen and seen != last["id"])
        return {"thread_id": t.get("thread_id"), "thread_v2_id": t.get("thread_v2_id"),
                "title": t.get("thread_title"), "users": users, "unread": bool(unread), "request": request,
                "last": last and {"dir": last["dir"], "time": last["time"], "text": last["text"][:300], "media": last["media"]}}

    async def inbox(self, page: Page, sess: _session.Session, limit: int = 30, all_chats: bool = False, requests: bool = True) -> dict:
        await self.ensure_origin(page, sess)
        data = await self.api(page, f"/api/v1/direct_v2/inbox/?persistentBadging=true&folder=&limit={min(max(limit, 10), 50)}&thread_message_limit=1")
        viewer = str((data.get("viewer") or {}).get("pk") or (await sess.cookies(self.base)).get("ds_user_id") or "")
        threads = [self._thread_summary(t, viewer) for t in (data.get("inbox") or {}).get("threads") or []]
        if requests:
            with contextlib.suppress(ToolError):
                pend = await self.api(page, "/api/v1/direct_v2/pending_inbox/?persistentBadging=true&limit=20")
                threads += [self._thread_summary(t, viewer, request=True) for t in (pend.get("inbox") or {}).get("threads") or []]
        chats = [t for t in threads if all_chats or t["unread"] or t["request"]][:limit]
        return {"chats": chats, "unread_total": sum(1 for t in chats if t["unread"]),
                "note": "request=true: message requests from people you don't follow; replying accepts the request."}

    async def thread_by_username(self, page: Page, username: str) -> tuple[str | None, dict | None]:
        prof = await self.api(page, f"/api/v1/users/web_profile_info/?username={quote(username)}")
        u = (prof.get("data") or {}).get("user") or {}
        pk = u.get("id")
        if not pk:
            return None, None
        user = {"user_id": str(pk), "username": u.get("username"), "full_name": u.get("full_name")}
        with contextlib.suppress(ToolError):
            t = await self.api(page, f"/api/v1/direct_v2/threads/get_by_participants/?recipient_users=%5B{pk}%5D")
            tid = (t.get("thread") or {}).get("thread_id")
            if tid:
                return str(tid), user
        return None, user

    async def fetch_thread(self, page: Page, tid: str, limit: int) -> tuple[dict, list[dict]]:
        items: list[dict] = []
        cursor, thread = None, {}
        for _ in range(40):
            q = f"/api/v1/direct_v2/threads/{tid}/?limit=20" + (f"&cursor={quote(cursor)}" if cursor else "")
            data = await self.api(page, q)
            thread = data.get("thread") or {}
            items += thread.get("items") or []
            if len(items) >= limit or not thread.get("has_older"):
                break
            cursor = thread.get("oldest_cursor")
            if not cursor:
                break
            await asyncio.sleep(0.8)
        return thread, items[:limit]

    async def resolve_peer(self, page: Page, sess: _session.Session, peer: str) -> dict:
        await self.ensure_origin(page, sess)
        tid, username = ig_peer(peer)
        if not tid and not username:
            raise ToolError("Instagram peer must be a thread id / instagram.com/direct/t/<id> URL or a username.")
        user = None
        if username:
            tid, user = await self.thread_by_username(page, username)
            if not user:
                return {"ok": False, "status": "no_chat", "reason": f"no Instagram user {username!r}"}
        return {"ok": True, "thread_id": tid, "user": user, "username": username}

    def _verify_users(self, thread: dict, expect_display: str | None, username: str | None) -> dict:
        users = thread.get("users") or []
        names = [f"{u.get('username', '')} {u.get('full_name', '')}" for u in users] + [thread.get("thread_title") or ""]
        if username and any((u.get("username") or "").lower() == username.lower() for u in users):
            return {"ok": True, "by": "username"}
        if expect_display and any(_helpers.display_matches(n, expect_display) for n in names):
            return {"ok": True, "by": "display"}
        if not username and not expect_display:
            return {"ok": True, "by": "thread_id"}
        return {"ok": False, "status": "wrong_chat", "reason": f"thread participants {names[:3]} do not match"}

    async def history(self, page: Page, sess: _session.Session, peer: str, limit: int = 200, expect_display: str | None = None) -> dict:
        r = await self.resolve_peer(page, sess, peer)
        if not r["ok"]:
            return {"status": "no_chat", "reason": r["reason"], "messages": []}
        if not r["thread_id"]:
            return {"status": "no_chat", "reason": "no conversation with this user yet", "user": r["user"], "messages": []}
        viewer = (await sess.cookies(self.base)).get("ds_user_id", "")
        thread, items = await self.fetch_thread(page, r["thread_id"], limit)
        v = self._verify_users(thread, expect_display, r.get("username"))
        msgs = [ig_item(i, viewer) for i in reversed(items)]
        return {"status": "ok", "thread_id": r["thread_id"], "header": thread.get("thread_title"),
                "users": [{"username": u.get("username"), "full_name": u.get("full_name")} for u in thread.get("users") or []],
                "verified": v["ok"], "verified_by": v.get("by"), "verify_note": v.get("reason"),
                "complete": not thread.get("has_older") or len(items) < limit, "count": len(msgs), "messages": msgs}

    async def media(self, page: Page, sess: _session.Session, peer: str, out: Path, limit: int = 20, expect_display: str | None = None) -> dict:
        h = await self.history(page, sess, peer, 300, expect_display)
        if h["status"] != "ok":
            return {**h, "files": []}
        files, skipped = [], 0
        for m in reversed(h["messages"]):
            for d in m["media"]:
                url = d.get("image_url") if d["type"] in ("image", "media_share", "clip", "story_share", "reel_share", "felix_share", "video") else None
                if not url or len(files) >= limit:
                    continue
                try:
                    resp = await page.context.request.get(url)
                    if not resp.ok:
                        skipped += 1
                        continue
                    path = out / f"ig_{len(files) + 1:03d}{'' if d['type'] == 'image' else '_' + d['type']}{_js._ext_for(resp.headers.get('content-type', ''), url)}"
                    _base._write_private(path, await resp.body())
                    files.append(str(path))
                except PWError:
                    skipped += 1
        return {"status": "ok", "verified": h["verified"], "files": files, "skipped": skipped, "dir": str(out),
                "note": "Newest first, full-size images (videos: cover image only)."}

    async def send(self, page: Page, sess: _session.Session, peer: str, text: str, expect_display: str | None = None,
                   pacer: _pacing.Pacer | None = None, allow_repeat: bool = False) -> dict:
        if pacer:
            await pacer.check(new_chat=None)
        r = await self.resolve_peer(page, sess, peer)
        if not r["ok"]:
            return {"status": "no_chat", "sent": False, "reason": r["reason"]}
        viewer = (await sess.cookies(self.base)).get("ds_user_id", "")
        tid = r["thread_id"]
        thread, items = ({}, [])
        if tid:
            thread, items = await self.fetch_thread(page, tid, 20)
            v = self._verify_users(thread, expect_display, r.get("username"))
            if not v["ok"]:
                return {"status": "wrong_chat", "sent": False, "reason": v["reason"]}
            last_out = next((ig_item(i, viewer) for i in items if str(i.get("user_id")) == str(viewer)), None)
            if last_out and not allow_repeat and items and str(items[0].get("user_id")) == str(viewer) and _helpers.same_text(last_out["text"], text):
                return {"status": "already_sent", "sent": False, "reason": "the last message is ours with this text (allow_repeat=true to send again)"}
        new_chat = not items
        if pacer:
            await pacer.check(new_chat=new_chat)
        if tid:
            await page.goto(f"{self.base}/direct/t/{tid}/", wait_until="domcontentloaded")
        else:  # no conversation yet: profile → "Message" opens an empty thread (nothing is sent)
            await page.goto(f"{self.base}/{r['username']}/", wait_until="domcontentloaded")
            await page.wait_for_timeout(2500)
            btn = page.get_by_role("button", name=re.compile(r"^\s*message\s*$", re.I))
            if not await btn.count():
                btn = page.get_by_text(re.compile(r"^\s*Message\s*$"))
            try:
                await btn.first.click(timeout=5000)
                await page.wait_for_url(re.compile(r"/direct/t/\d+"), timeout=15000)
            except (PWTimeout, PWError):
                return {"status": "not_sent", "sent": False, "reason": "could not open a new conversation (no Message button: private account or DMs closed?)"}
            tid = re.search(r"/direct/t/(\d+)", page.url).group(1)
        await page.wait_for_timeout(2500)
        with contextlib.suppress(Exception):  # "Turn on notifications?" → Not now
            nn = page.get_by_role("button", name=re.compile(r"not now", re.I))
            if await nn.count():
                await nn.first.click(timeout=2000)
        if f"/direct/t/{tid}" not in page.url:
            return {"status": "not_sent", "sent": False, "reason": "Instagram did not open the thread"}
        try:
            await page.locator(IG_BOX).last.wait_for(timeout=10000)
        except PWTimeout:
            return {"status": "not_sent", "sent": False, "reason": "message box not found"}
        before_ts = int(items[0].get("timestamp", 0)) if items else 0
        if not await _js._fill_box(page, IG_BOX, text, paste_first=False):
            await _js._clear_box(page, IG_BOX)
            return {"status": "not_sent", "sent": False, "reason": "could not put the text into the message box"}
        if pacer:
            pacer.record(tid, new_chat)
        try:
            await page.keyboard.press("Enter")
        except PWError:
            return {"status": "unknown", "sent": None, "reason": _base.UNKNOWN}
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            await asyncio.sleep(2)
            with contextlib.suppress(ToolError, _session.LoginNeeded):
                _, latest = await self.fetch_thread(page, tid, 5)
                for it in latest:
                    if str(it.get("user_id")) == str(viewer) and int(it.get("timestamp", 0)) > before_ts and _helpers.same_text(it.get("text") or "", text):
                        warn = await _js._limit_warning(page)
                        if warn and pacer:
                            pacer.block(warn)
                        return {"status": "sent", "sent": True, "thread_id": tid, "message_id": it.get("item_id"),
                                "verified_by": "api", "new_chat": new_chat, "limit_warning": warn,
                                "note": "first message to a non-follower lands in their Requests; one message until they accept" if new_chat else None}
        warn = await _js._limit_warning(page)
        if warn and pacer:
            pacer.block(warn)
        return {"status": "unknown", "sent": None, "reason": _base.UNKNOWN, "thread_id": tid, "limit_warning": warn,
                "next": "call ig_history for this peer and look at the last messages"}

    async def resolve(self, page: Page, sess: _session.Session, query: str) -> dict:
        await self.ensure_origin(page, sess)
        tid, username = ig_peer(query)
        if tid:
            thread, _ = await self.fetch_thread(page, tid, 1)
            return {"query": query, "thread_id": tid, "title": thread.get("thread_title"),
                    "users": [{"user_id": str(u.get("pk")), "username": u.get("username"), "full_name": u.get("full_name")} for u in thread.get("users") or []]}
        res: dict[str, Any] = {"query": query, "matches": []}
        if username:
            with contextlib.suppress(ToolError):
                t, user = await self.thread_by_username(page, username)
                if user:
                    res["matches"].append({**user, "thread_id": t})
        if not res["matches"]:
            with contextlib.suppress(ToolError):
                data = await self.api(page, f"/api/v1/direct_v2/ranked_recipients/?mode=raven&show_threads=true&query={quote(query)}")
                for rr in data.get("ranked_recipients") or []:
                    if rr.get("thread"):
                        t = rr["thread"]
                        res["matches"].append({"thread_id": t.get("thread_id"), "title": t.get("thread_title")})
                    elif rr.get("user"):
                        u = rr["user"]
                        res["matches"].append({"user_id": str(u.get("pk")), "username": u.get("username"), "full_name": u.get("full_name")})
        return res
