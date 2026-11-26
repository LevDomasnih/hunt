"""One-tap handoff links (Viber, LINE, WhatsApp, Telegram): pure functions, invented numbers and ids."""
import asyncio
from urllib.parse import unquote

import pytest

import hunt_bridge as hb
from hunt_bridge import ToolError

RU = "Здравствуйте! Квартира свободна с 1.12? 2 человека, на 3 мес"


def test_e164():
    assert hb.e164("+381 64 123-45-67") == "+381641234567"
    assert hb.e164("00381641234567") == "+381641234567"
    assert hb.e164("381641234567") == "+381641234567"
    assert hb.e164("+66 (81) 234 5678") == "+66812345678"
    for bad in ("064 123 4567", "+0381641234567", "12345", "+3816412345678901", "38164+1234567", "call me", "", "+38 1 64 abc"):
        with pytest.raises(ToolError):
            hb.e164(bad)


def test_viber_link_keeps_the_plus_and_encodes_the_text():
    r = hb.handoff("viber", "+381 64 123 4567", RU + " & ok?")
    assert r["url"].startswith("viber://chat?number=%2B381641234567&draft=")
    assert unquote(r["url"].split("draft=")[1]) == RU + " & ok?"
    assert " " not in r["url"] and "&" not in r["url"].split("draft=")[1]
    assert r["prefilled"] is False and r["prefill"] == "best_effort"
    assert r["peer"] == "+381641234567" and r["fallback_text"] == RU + " & ok?"
    assert r["alternatives"][0]["url"].startswith("https://viber.me/381641234567?draft=")
    assert "fallback_text" in r["how"]["en"] and "Отправить" in r["how"]["ru"]


def test_line_official_account_is_prefilled():
    r = hb.handoff("line", "@123ABCDE", "hello, is the condo free?")
    assert r["url"] == "https://line.me/R/oaMessage/%40123abcde/?hello%2C%20is%20the%20condo%20free%3F"
    assert r["prefilled"] is True and r["peer_kind"] == "oa"


def test_line_personal_id_gives_profile_and_share():
    r = hb.handoff("line", "~Somchai.K_88", "hi")
    assert r["url"] == "https://line.me/R/ti/p/~somchai.k_88"
    assert r["share_url"] == "https://line.me/R/share?text=hi"
    assert r["prefilled"] is False and r["peer_kind"] == "id"
    assert "share_url" in r["how"]["en"]


def test_line_link_and_phone():
    r = hb.handoff("line", "https://line.me/ti/p/AbC-12_xyz", "hi")
    assert r["url"] == "https://line.me/R/ti/p/AbC-12_xyz" and r["peer_kind"] == "link"
    r = hb.handoff("line", "+66 81 234 5678", "hi")
    assert r["peer_kind"] == "phone" and r["url"] == "https://line.me/R/share?text=hi" and r["prefilled"] is False
    assert "+66812345678" in r["how"]["en"]
    assert hb.line_peer("66 81 234 5678") == ("phone", "+66812345678")
    assert hb.line_peer("12345678") == ("id", "12345678")  # LINE IDs may be digits only
    assert hb.line_peer("~0812345678") == ("id", "0812345678")
    with pytest.raises(ToolError, match="country code"):
        hb.line_peer("0812345678")


def test_line_refusals():
    for bad in ("has space", "a" * 21, "@bad id", "привет", "https://evil.example/ti/p/x", ""):
        with pytest.raises(ToolError):
            hb.handoff("line", bad, "hi")


def test_whatsapp_and_telegram():
    r = hb.handoff("whatsapp", "+62 812-0000-0033", "halo\npak")
    assert r["url"] == "https://wa.me/6281200000033?text=halo%0Apak" and r["prefilled"] is True
    r = hb.handoff("telegram", "@Some_Agent", "hi there")
    assert r["url"] == "https://t.me/Some_Agent?text=hi%20there" and r["peer"] == "@some_agent"
    r = hb.handoff("telegram", "+7 701 000 0000", "hi")
    assert r["url"] == "https://t.me/+77010000000?text=hi" and r["warnings"]
    for bad in ("123456789", "@ab", "bad name"):
        with pytest.raises(ToolError):
            hb.handoff("telegram", bad, "hi")


def test_text_limits_and_channels():
    with pytest.raises(ToolError, match="channel"):
        hb.handoff("signal", "+381641234567", "hi")
    with pytest.raises(ToolError, match="empty"):
        hb.handoff("viber", "+381641234567", "   ")
    with pytest.raises(ToolError, match="4000"):
        hb.handoff("viber", "+381641234567", "x" * 4001)
    long_ru = "я" * 1500  # 9000 characters once encoded: no prefill, the hunter pastes
    r = hb.handoff("whatsapp", "+381641234567", long_ru)
    assert r["url"] == "https://wa.me/381641234567" and r["prefilled"] is False and r["fallback_text"] == long_ru
    r = hb.handoff("line", "somchai", long_ru)
    assert r["share_url"] is None and "share_url" not in r["how"]["en"]


def test_log_item_is_stable_and_clean():
    a = hb.handoff_item("viber", "+381 64 123 4567", "Da, slobodan je ", "in", search_id="s_1", at="2026-11-26T14:05:00+01:00")
    b = hb.handoff_item("viber", "381641234567", "Da,  slobodan je", "in", search_id="s_1", at="2026-11-26T18:00:00+01:00")
    assert a["external_id"] == b["external_id"] and a["external_id"].startswith("handoff:viber:")
    assert a["channel"] == "viber" and a["direction"] == "in" and "listing_id" not in a
    c = hb.handoff_item("viber", "+381641234567", "Da, slobodan je", "in", search_id="s_1", at="2026-11-27T09:00:00+01:00")
    assert c["external_id"] != a["external_id"]
    o = hb.handoff_item("line", "@123abcde", "hi", "out", listing_id="l_1", draft_id="d_9")
    assert o["external_id"] == "handoff:line:d_9" and o["at"].endswith("+00:00")
    for kw in ({"direction": "sideways"}, {"search_id": None}, {"at": "2026-11-26T14:05:00"}, {"at": "tomorrow"}, {"text": " "}):
        args = {"channel": "viber", "peer": "+381641234567", "text": "x", "direction": "in", "search_id": "s_1", **kw}
        with pytest.raises(ToolError):
            hb.handoff_item(**args)


def test_tools_and_channels_list():
    r = asyncio.run(hb.handoff_link("viber", "+381641234567", "zdravo"))
    assert r["url"].endswith("draft=zdravo")
    r = asyncio.run(hb.handoff_log_item("line", "somchai", "ok", "in", search_id="s_1"))
    assert r["item"]["channel"] == "line" and "messages_log" in r["next"]
    ch = asyncio.run(hb.channels_list())
    assert {"viber", "line"} <= {x["channel"] for x in ch["built_in"] if x["use"]}
