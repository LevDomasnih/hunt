"""hunt_telegram pure helpers with real Telethon types, offline (no client is connected)."""
import asyncio
from datetime import datetime, timedelta, timezone

import pytest

pytest.importorskip("telethon")

from hunttg import base, clients, entities, folders, keychain, pacing, reading, setup  # noqa: E402
from hunttg.base import ToolError  # noqa: E402
from telethon.tl import types  # noqa: E402

NOW = datetime(2026, 11, 18, 12, 0, tzinfo=timezone.utc)  # 20:00 in Bali


def test_parse_peer():
    assert entities.parse_peer("@odegalle") == ("username", "odegalle")
    assert entities.parse_peer("https://t.me/Some_User") == ("username", "Some_User")
    assert entities.parse_peer("+62 812-0000-0033") == ("phone", "+6281200000033")
    assert entities.parse_peer("123456789") == ("id", 123456789)
    assert entities.parse_peer(42) == ("id", 42)
    with pytest.raises(ToolError):
        entities.parse_peer("not a peer!")


def test_parse_post_link():
    assert reading.parse_post_link("https://t.me/balichatparties/83340") == ("balichatparties", 83340)
    assert reading.parse_post_link("t.me/balichat_bukit/301573?single") == ("balichat_bukit", 301573)
    assert reading.parse_post_link("https://t.me/c/1234567890/55") == (-1001234567890, 55)
    assert reading.parse_post_link("https://t.me/somegroup/12/345") == ("somegroup", 345)
    with pytest.raises(ToolError):
        reading.parse_post_link("https://t.me/balichatparties")
    with pytest.raises(ToolError):
        reading.parse_post_link("https://example.com/a/1")


def test_parse_since():
    assert base.parse_since("2026-11-18") == datetime(2026, 11, 18, tzinfo=timezone.utc)
    assert base.parse_since("2026-11-18T09:00:00+08:00") == datetime(2026, 11, 18, 1, tzinfo=timezone.utc)
    d = base.parse_since("3d")
    assert timedelta(days=2, hours=23) < datetime.now(timezone.utc) - d < timedelta(days=3, minutes=1)
    with pytest.raises(ToolError):
        base.parse_since("yesterday")


def test_quiet_hours_wrap_midnight():
    q = {"start": "21:00", "end": "08:00", "tz": "Asia/Makassar"}
    assert pacing.in_quiet_hours(q, NOW)[0] is False                      # 20:00 WITA
    assert pacing.in_quiet_hours(q, NOW + timedelta(hours=1, minutes=30))[0] is True   # 21:30
    assert pacing.in_quiet_hours(q, NOW + timedelta(hours=11))[0] is True  # 07:00 next day
    assert pacing.in_quiet_hours(q, NOW + timedelta(hours=13))[0] is False  # 09:00
    assert pacing.in_quiet_hours(None, NOW) == (False, None)


S = dict(base.DEFAULT_SETTINGS)


def test_pacing_ok_and_wait():
    assert pacing.pacing_check({}, S, NOW, new_chat=True) == {"ok": True, "wait_s": 0.0}
    r = pacing.pacing_check({"last_send_ts": NOW.timestamp() - 5}, S, NOW, new_chat=False)
    assert r["ok"] and 14 < r["wait_s"] <= 15


def test_pacing_cooldowns():
    st = {"cooldown_until": NOW.timestamp() + 600, "cooldown_reason": "FLOOD_WAIT 600s"}
    r = pacing.pacing_check(st, S, NOW, new_chat=False)
    assert not r["ok"] and r["reason"].startswith("STOP")
    st = {"new_chat_cooldown_until": NOW.timestamp() + 3600}
    assert pacing.pacing_check(st, S, NOW, new_chat=False)["ok"]          # existing chats still fine
    assert not pacing.pacing_check(st, S, NOW, new_chat=True)["ok"]


def test_pacing_daily_cap_and_gap():
    ts = NOW.timestamp()
    st = {"new_chats": [{"ts": ts - 3600 - i * 600, "peer": i} for i in range(20)]}
    r = pacing.pacing_check(st, S, NOW, new_chat=True)
    assert not r["ok"] and "Daily limit" in r["reason"]
    assert pacing.pacing_check(st, S, NOW, new_chat=False)["ok"]
    old = {"new_chats": [{"ts": ts - 90000, "peer": 1}]}               # older than 24 h: ignored
    assert pacing.pacing_check(old, S, NOW, new_chat=True)["ok"]
    gap = {"new_chats": [{"ts": ts - 30, "peer": 1}], "last_send_ts": ts - 30}
    r = pacing.pacing_check(gap, S, NOW, new_chat=True)
    assert not r["ok"] and 85 <= r["retry_after_s"] <= 91


def test_pacing_quiet_hours():
    s = {**S, "quiet_hours": {"start": "19:00", "end": "08:00", "tz": "Asia/Makassar"}}
    r = pacing.pacing_check({}, s, NOW, new_chat=False)
    assert not r["ok"] and "Quiet hours" in r["reason"]


def _filter(peers, fid=3, title="Hunt"):
    return types.DialogFilter(id=fid, title=folders.make_title(title), pinned_peers=[], include_peers=list(peers), exclude_peers=[])


def test_folder_add_replaces_placeholder_and_dedupes():
    f = _filter([types.InputPeerSelf()])
    u = types.InputPeerUser(user_id=111, access_hash=1)
    assert folders.add_peer_to_filter(f, u, premium=False) == "added"
    assert f.include_peers == [u]
    assert folders.add_peer_to_filter(f, types.InputPeerUser(user_id=111, access_hash=1), premium=False) == "already"
    assert folders._title_text(f) == "Hunt"


def test_folder_limit():
    f = _filter([types.InputPeerUser(user_id=i, access_hash=1) for i in range(1, 101)])
    with pytest.raises(ToolError, match="full"):
        folders.add_peer_to_filter(f, types.InputPeerUser(user_id=999, access_hash=1), premium=False)
    assert folders.add_peer_to_filter(f, types.InputPeerUser(user_id=999, access_hash=1), premium=True) == "added"


def test_folder_remove_keeps_folder_valid():
    u = types.InputPeerUser(user_id=5, access_hash=1)
    f = _filter([u])
    assert folders.remove_peer_from_filter(f, u) == "removed"
    assert isinstance(f.include_peers[0], types.InputPeerSelf)
    assert folders.remove_peer_from_filter(f, u) == "absent"


def test_free_filter_id_and_find():
    fs = [types.DialogFilterDefault(), _filter([types.InputPeerSelf()], fid=2, title="Work"), _filter([types.InputPeerSelf()], fid=3)]
    assert folders.free_filter_id(fs) == 4
    assert folders._find_folder(fs, "hunt").id == 3
    assert folders._find_folder(fs, "Nope") is None


def _msg(**kw):
    base = dict(id=10, peer_id=types.PeerUser(user_id=5), date=NOW, message="", out=False)
    base.update(kw)
    return types.Message(**base)


def test_describe_text_location_photo():
    d = entities.describe(_msg(message="Hello, still available?"), me_id=1, peer_id=5)
    assert d == {"id": 10, "date": "2026-11-18T12:00:00Z", "direction": "in", "text": "Hello, still available?",
                 "external_id": "tg:1:5:10"}
    geo = _msg(id=11, out=True, media=types.MessageMediaGeo(geo=types.GeoPoint(long=115.12, lat=-8.81, access_hash=0)))
    g = entities.describe(geo, 1, 5)
    assert g["direction"] == "out" and g["media"][0]["type"] == "location" and g["media"][0]["lat"] == -8.81
    photo = types.Photo(id=1, access_hash=1, file_reference=b"", date=NOW, dc_id=1,
                        sizes=[types.PhotoSize(type="y", w=800, h=600, size=12345)])
    p = entities.describe(_msg(id=12, message="living room", grouped_id=777, media=types.MessageMediaPhoto(photo=photo)), 1, 5)
    assert p["media"][0]["type"] == "photo" and p["caption"] == "living room" and p["album"] == "777"


def test_summarize_user_masks_phone():
    u = types.User(id=5, first_name="Wayan", username="wayan_villas", phone="6281200000033", contact=False)
    s = entities.summarize(u, mask_phone=True)
    assert s["peer"] == "@wayan_villas" and s["type"] == "user" and s["phone"].startswith("+628") and "*" in s["phone"]
    assert entities.summarize(u)["phone"] == "+6281200000033"


def test_process_lock_blocks_second_open():
    f = clients._take_process_lock("hunt")
    try:
        with pytest.raises(ToolError, match="already open"):
            clients._take_process_lock("hunt")
    finally:
        f.close()
    clients._take_process_lock("hunt").close()


def test_api_creds_and_setup(isolated):
    with pytest.raises(ToolError, match="my.telegram.org"):
        keychain.api_creds("hunt")
    out = asyncio.run(setup.tg_setup_api(12345, "0123456789abcdef0123456789abcdef", "hunt"))
    assert out["ok"] and out["also_default"]
    assert keychain.api_creds("hunt") == (12345, "0123456789abcdef0123456789abcdef")
    assert keychain.api_creds("personal") == (12345, "0123456789abcdef0123456789abcdef")  # default fallback
    with pytest.raises(ToolError):
        asyncio.run(setup.tg_setup_api(1, "short", "hunt"))


def test_settings_roundtrip():
    asyncio.run(setup.tg_settings(max_new_chats_per_day=10, quiet_start="21:00", quiet_end="08:00", quiet_tz="Asia/Makassar"))
    asyncio.run(setup.tg_settings(account="personal", read_scope="folder", folder_auto=True))
    assert base.settings_for("hunt")["max_new_chats_per_day"] == 10
    p = base.settings_for("personal")
    assert p["read_scope"] == "folder" and p["folder_auto"] and p["quiet_hours"]["tz"] == "Asia/Makassar"
    assert base.settings_for("hunt")["read_scope"] == "non_contacts"


def test_tools_registered():
    import hunt_telegram  # noqa: F401  (the entry imports every module, so every tool is registered)
    names = {t.name for t in asyncio.run(base.mcp.list_tools())}
    assert {"tg_setup_api", "tg_login_qr", "tg_login_status", "tg_status", "tg_inbox", "tg_history", "tg_media",
            "tg_send", "tg_folder_ensure", "tg_folder_add", "tg_folder_remove", "tg_resolve", "tg_settings"} <= names
