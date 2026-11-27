"""Offline tests for hunt_browser: pure helpers + WhatsApp send/verify/history logic against a local
fixture that mimics the WhatsApp Web DOM (served at https://web.whatsapp.com via request routing, so
nothing goes to the network). Needs an installed Playwright Chromium; skipped otherwise."""
import asyncio
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

pytest.importorskip("playwright")
import hunt_browser  # noqa: E402,F401  (registers every tool)
from huntbrowser import base as hb_base  # noqa: E402
from huntbrowser import chromium as hb_chromium  # noqa: E402
from huntbrowser import helpers as hb_helpers  # noqa: E402
from huntbrowser import instagram as hb_instagram  # noqa: E402
from huntbrowser import login as hb_login  # noqa: E402
from huntbrowser import messenger as hb_messenger  # noqa: E402
from huntbrowser import pacing as hb_pacing  # noqa: E402
from huntbrowser import session as hb_session  # noqa: E402
from huntbrowser import whatsapp as hb_whatsapp  # noqa: E402
from playwright.async_api import async_playwright  # noqa: E402

FIXTURE = (Path(__file__).parent / "fixtures" / "wa_web.html").read_text(encoding="utf-8")
PHONE = "6281234567890"


# ---------------------------------------------------------------- pure helpers

def test_phone_digits():
    assert hb_helpers.phone_digits("+62 812-3456-7890") == PHONE
    assert hb_helpers.phone_digits("https://wa.me/6281234567890") == PHONE
    assert hb_helpers.phone_digits("6281234567890@s.whatsapp.net") == PHONE
    assert hb_helpers.phone_digits("https://web.whatsapp.com/send?phone=6281234567890") == PHONE
    assert hb_helpers.phone_digits("Made Villa Canggu") is None
    assert hb_helpers.phone_digits("123") is None


def test_header_check_number_display_and_mismatch():
    ok = hb_helpers.header_check("+62 812-3456-7890", "", PHONE, None)
    assert ok == {"ok": True, "by": "number"}
    biz = hb_helpers.header_check("Bali Villas Agency ✅", "Bali Villas Agency ✅ business account", PHONE, "bali villas agency")
    assert biz["ok"] and biz["by"] == "display"
    bad = hb_helpers.header_check("Bali Villas Agency", "", PHONE, None)
    assert not bad["ok"] and "expect_display" in bad["reason"]
    wrong = hb_helpers.header_check("+62 811-0000-0000", "", PHONE, "Ketut")
    assert not wrong["ok"]


def test_same_text_tolerates_time_ticks_and_emoji():
    assert hb_helpers.same_text("hi! is it free from Nov 22?\n10:21", "hi! is it free from Nov 22?")
    assert hb_helpers.same_text("hello  there 🙏‎ 10:21 ✓✓", "hello there 🙏")
    assert hb_helpers.same_text("line one line two 10:00", "line one\nline two")
    assert not hb_helpers.same_text("something else", "hi! is it free?")
    assert not hb_helpers.same_text("anything", "")


def test_quiet_hours_overnight_and_dict():
    qh = hb_helpers.parse_quiet_hours("21:00-08:00")
    assert qh == (21 * 60, 8 * 60)
    assert hb_helpers.in_quiet_hours(datetime(2026, 11, 19, 23, 0), qh)
    assert hb_helpers.in_quiet_hours(datetime(2026, 11, 19, 7, 59), qh)
    assert not hb_helpers.in_quiet_hours(datetime(2026, 11, 19, 12, 0), qh)
    assert hb_helpers.parse_quiet_hours({"start": "13:00", "end": "14:30"}) == (780, 870)
    assert hb_helpers.parse_quiet_hours("off") is None


def _pacer(tmp_path, now, **limits):
    p = hb_pacing.Pacer("whatsapp", "t", state_path=tmp_path / "pacing.json", now=lambda: now)
    p.qh = None
    p.limits.update(limits)
    return p


def test_pacer_interval_cap_quiet_and_block(tmp_path):
    t0 = datetime(2026, 11, 19, 12, 0, tzinfo=timezone.utc)
    p = _pacer(tmp_path, t0, min_interval_s=20, min_interval_new_s=150, daily_new_cap=2)
    asyncio.run(p.check(new_chat=True))
    p.record("a", True)
    with pytest.raises(hb_pacing.Paced) as e:  # 150 s between new chats > 30 s inline wait
        asyncio.run(p.check(new_chat=True))
    assert e.value.retry_after > t0
    later = _pacer(tmp_path, t0 + timedelta(minutes=5), daily_new_cap=2)
    asyncio.run(later.check(new_chat=True))
    later.record("b", True)
    capped = _pacer(tmp_path, t0 + timedelta(minutes=10), daily_new_cap=2)
    with pytest.raises(hb_pacing.Paced, match="daily cap"):
        asyncio.run(capped.check(new_chat=True))
    asyncio.run(capped.check(new_chat=False))  # replies are still fine
    quiet = _pacer(tmp_path, datetime(2026, 11, 19, 22, 30))
    quiet.qh = hb_helpers.parse_quiet_hours("21:00-08:00")
    with pytest.raises(hb_pacing.Paced, match="quiet hours"):
        asyncio.run(quiet.check(new_chat=False))
    capped.block("You're approaching the limit")
    with pytest.raises(hb_pacing.Paced, match="limit warning"):
        asyncio.run(_pacer(tmp_path, t0 + timedelta(minutes=11)).check(new_chat=False))


def test_pacer_reads_config(tmp_path, monkeypatch):
    cfg = Path(hb_base.config_dir())
    cfg.mkdir(parents=True, exist_ok=True)
    (cfg / "config.json").write_text(json.dumps({"browser": {"quiet_hours": {"start": "22:00", "end": "07:00", "tz": "Asia/Makassar"},
                                                            "pacing": {"whatsapp": {"daily_new_cap": 3}}}}))
    p = hb_pacing.Pacer("whatsapp", "main", state_path=tmp_path / "p.json")
    assert p.limits["daily_new_cap"] == 3 and p.limits["min_interval_s"] == 20
    assert p.qh == (22 * 60, 7 * 60) and str(p.tz) == "Asia/Makassar"


def test_convert_cookies_filters_domains():
    raw = [{"name": "c_user", "value": "100", "domain": ".facebook.com", "path": "/", "expirationDate": 1893456000,
            "secure": True, "httpOnly": False, "sameSite": "no_restriction"},
           {"name": "xs", "value": "secret", "domain": ".facebook.com", "httpOnly": True, "sameSite": "lax"},
           {"name": "other", "value": "1", "domain": ".example.com"}]
    out = hb_login.convert_cookies(raw, "messenger")
    assert [c["name"] for c in out] == ["c_user", "xs"]
    assert out[0]["sameSite"] == "None" and out[0]["expires"] == 1893456000
    assert hb_login.convert_cookies({"cookies": raw}, "instagram") == []


def test_peer_parsers():
    assert hb_messenger.fb_thread_id("https://web.facebook.com/messages/e2ee/t/123456/") == ("123456", True)
    assert hb_messenger.fb_thread_id("https://m.me/villa.bali") == ("villa.bali", False)
    assert hb_instagram.ig_peer("https://www.instagram.com/direct/t/340282366841710300949128123456789/") == ("340282366841710300949128123456789", None)
    assert hb_instagram.ig_peer("@bali.villa_rent") == (None, "bali.villa_rent")
    assert hb_instagram.ig_peer("https://instagram.com/bali.villa/") == (None, "bali.villa")


def test_ig_item_mapping():
    viewer = "42"
    img = {"item_id": "1", "user_id": 7, "timestamp": 1763540000000000, "item_type": "media",
           "media": {"image_versions2": {"candidates": [{"url": "s.jpg", "width": 100, "height": 100},
                                                        {"url": "big.jpg", "width": 1080, "height": 1350}]}}}
    m = hb_instagram.ig_item(img, viewer)
    assert m["dir"] == "in" and m["media"][0]["image_url"] == "big.jpg" and m["time"].startswith("2025")
    t = hb_instagram.ig_item({"item_id": "2", "user_id": 42, "timestamp": 1763540000000000, "item_type": "text", "text": "hi"}, viewer)
    assert t["dir"] == "out" and t["text"] == "hi"


def test_find_chromium_never_downloads(tmp_path, monkeypatch):
    monkeypatch.delenv("HUNT_CHROMIUM", raising=False)
    found = hb_chromium.find_chromium(tmp_path / "empty")
    assert found["full"] is None and found["shell"] is None
    assert "never downloads" in hb_chromium.chromium_missing_message(found["root"])


# ---------------------------------------------------------------- WhatsApp against the DOM fixture

def run_wa(cfg: dict, fn):
    async def main():
        found = hb_chromium.find_chromium()
        exe = found["full"] or found["shell"]
        if not exe:
            pytest.skip("no Playwright Chromium installed")
        async with async_playwright() as p:
            browser = await p.chromium.launch(executable_path=exe, headless=True)
            try:
                ctx = await browser.new_context(viewport={"width": 1280, "height": 900})
                await ctx.add_init_script(f"window.__WA = {json.dumps(cfg)};")
                await ctx.route("https://web.whatsapp.com/**",
                                lambda r: r.fulfill(status=200, content_type="text/html", body=FIXTURE))
                await ctx.route(lambda url: not url.startswith("https://web.whatsapp.com"), lambda r: r.abort())
                page = await ctx.new_page()
                page.set_default_timeout(8000)
                return await fn(page)
            finally:
                await browser.close()
    return asyncio.run(main())


def fast_pacer(tmp_path):
    p = hb_pacing.Pacer("whatsapp", "t", state_path=tmp_path / "pacing.json")
    p.qh = None
    p.limits.update(min_interval_s=0, min_interval_new_s=0, daily_new_cap=50)
    return p


async def outgoing(page):
    return [r for r in await hb_whatsapp.WhatsApp().rows(page) if r["dir"] == "out"]


def test_send_new_chat_verified_by_number(tmp_path):
    pacer = fast_pacer(tmp_path)

    async def go(page):
        res = await hb_whatsapp.WhatsApp().send(page, "+62 812-3456-7890", "hi! saw your villa, is it free from Nov 22?", pacer=pacer)
        return res, await outgoing(page)

    res, outs = run_wa({}, go)
    assert res["status"] == "sent" and res["sent"] is True
    assert res["verified_by"] == "number" and res["new_chat"] is True
    assert len(outs) == 1 and outs[0]["text"] == "hi! saw your villa, is it free from Nov 22?"
    assert pacer.summary()["new_chats_today"] == 1


def test_send_multiline_into_existing_chat(tmp_path):
    text = "thanks!\ncan we come at 3pm tomorrow?"

    async def go(page):
        res = await hb_whatsapp.WhatsApp().send(page, PHONE, text, pacer=fast_pacer(tmp_path))
        return res, await outgoing(page)

    res, outs = run_wa({"rows": [{"dir": "in", "text": "yes it is free"}]}, go)
    assert res["status"] == "sent" and res["new_chat"] is False
    assert outs[-1]["text"] == text


def test_wrong_header_blocks_send():
    async def go(page):
        res = await hb_whatsapp.WhatsApp().send(page, PHONE, "hello")
        return res, await outgoing(page), await page.locator("#box").inner_text()

    res, outs, box = run_wa({"header": "Some Other Villa"}, go)
    assert res["status"] == "wrong_chat" and res["sent"] is False
    assert outs == [] and box == ""


def test_business_account_matches_expect_display():
    async def go(page):
        return await hb_whatsapp.WhatsApp().send(page, PHONE, "hello", expect_display="bali villas agency")

    res = run_wa({"header": "Bali Villas Agency ✅"}, go)
    assert res["status"] == "sent" and res["verified_by"] == "display"


def test_page_reload_right_after_send_is_still_verified():
    async def go(page):
        return await hb_whatsapp.WhatsApp().send(page, PHONE, "reload test")

    res = run_wa({"sendMode": "reload"}, go)
    assert res["status"] == "sent"


def test_unverifiable_send_is_unknown_not_retried(tmp_path):
    pacer = fast_pacer(tmp_path)

    async def go(page):
        res = await hb_whatsapp.WhatsApp().send(page, PHONE, "lost message", pacer=pacer)
        return res, await outgoing(page)

    res, outs = run_wa({"sendMode": "noop"}, go)
    assert res["status"] == "unknown" and res["reason"] == hb_base.UNKNOWN and res["sent"] is None
    assert outs == []
    assert pacer.summary()["new_chats_today"] == 1  # counted: it may have gone out


def test_clock_icon_is_sent_pending():
    res = run_wa({"sendMode": "pending"}, lambda page: hb_whatsapp.WhatsApp().send(page, PHONE, "queued"))
    assert res["status"] == "sent_pending" and res["sent"] is True


def test_invalid_number_is_no_chat():
    res = run_wa({"invalid": True}, lambda page: hb_whatsapp.WhatsApp().send(page, PHONE, "hello"))
    assert res["status"] == "no_chat" and res["sent"] is False


def test_duplicate_guard():
    cfg = {"rows": [{"dir": "in", "text": "ok"}, {"dir": "out", "text": "see you at 3"}]}
    res = run_wa(cfg, lambda page: hb_whatsapp.WhatsApp().send(page, PHONE, "see you at 3"))
    assert res["status"] == "already_sent"


def test_paced_before_typing(tmp_path):
    t0 = datetime.now().astimezone()
    pacer = hb_pacing.Pacer("whatsapp", "t", state_path=tmp_path / "pacing.json", now=lambda: t0)
    pacer.qh = None
    pacer.limits.update(min_interval_s=0, min_interval_new_s=600, daily_new_cap=50)
    pacer.record("someone-else", True)

    async def go(page):
        with pytest.raises(hb_pacing.Paced):
            await hb_whatsapp.WhatsApp().send(page, PHONE, "hello", pacer=pacer)
        return await page.locator("#box").inner_text()

    assert run_wa({}, go) == ""


def test_history_scrolls_to_start():
    cfg = {"older": 12, "rows": [{"dir": "in", "text": "hi"}, {"dir": "out", "text": "hello"}]}

    async def go(page):
        return await hb_whatsapp.WhatsApp().history(page, PHONE, limit=200)

    res = run_wa(cfg, go)
    msgs = [m for m in res["messages"] if m["dir"] != "system"]
    assert res["verified"] and res["complete"]
    assert len(msgs) == 14
    assert msgs[0]["text"] == "older message 1" and msgs[11]["text"] == "older message 12" and msgs[-1] == {**msgs[-1], "dir": "out", "text": "hello"}
    assert msgs[-2]["sender"] == "Landlord" and msgs[-2]["time"].endswith("11/19/2026")


def test_inbox_unread_and_missed_calls():
    cfg = {"chats": [{"name": "+62 812-3456-7890", "preview": "is it still free?", "unread": 2},
                     {"name": "Made", "preview": "Missed voice call", "missed": True},
                     {"name": "Old chat", "preview": "thanks"}]}

    async def go(page):
        await page.goto("https://web.whatsapp.com/")
        return await hb_whatsapp.WhatsApp().inbox(page, 30)

    res = run_wa(cfg, go)
    names = {c["name"]: c for c in res["chats"]}
    assert set(names) == {"+62 812-3456-7890", "Made"}
    assert names["+62 812-3456-7890"]["unread"] == 2 and names["+62 812-3456-7890"]["number"] == PHONE
    assert names["Made"]["missed_call"] and res["missed_calls"] == ["Made"]


def test_logged_out_reports_login_needed_and_saves_qr(tmp_path):
    async def go(page):
        wa = hb_whatsapp.WhatsApp()
        with pytest.raises(hb_session.LoginNeeded):
            await wa.ensure_app(page, timeout=10)
        return await wa.qr_snapshot(page, tmp_path / "qr.png")

    assert run_wa({"loggedOut": True}, go) is True
    assert (tmp_path / "qr.png").read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"


def test_media_saves_full_size_from_viewer(tmp_path):
    async def go(page):
        return await hb_whatsapp.WhatsApp().media(page, PHONE, tmp_path, limit=5)

    res = run_wa({"images": 2}, go)
    assert len(res["files"]) == 2 and not any("_thumb" in f for f in res["files"])
    data = Path(res["files"][0]).read_bytes()
    assert data[:4] == b"\x89PNG" and int.from_bytes(data[16:20], "big") == 1200  # viewer image, not the thumbnail
