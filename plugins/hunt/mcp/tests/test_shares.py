"""pack_share: what goes into a request, and that an update keeps the hunter's own city."""
import asyncio
import json
import subprocess

import pytest

from huntcore import base, packs, registry, util
from huntcore.base import ToolError


def run(c):
    return asyncio.run(c)


def git(d, *a):
    subprocess.run(["git", "-c", "user.email=a@example.com", "-c", "user.name=a", *a], cwd=d, check=True, capture_output=True)


@pytest.fixture
def data(tmp_path, monkeypatch):
    monkeypatch.delenv("HUNT_REGIONS", raising=False)
    d = tmp_path / "data" / "regions" / "xx"
    d.mkdir(parents=True)
    (d / "pack.yaml").write_text("id: xx\nname: {en: X}\n", encoding="utf-8")
    (d / "market.md").write_text("Prices\n", encoding="utf-8")
    (d / "sources.yaml").write_text('portals:\n  - {name: P, url: "https://p.example", contact: "call"}\ntelegram:\n  - {handle: "@old_chat"}\n', encoding="utf-8")
    repo = tmp_path / "data"
    git(repo, "init", "-q"); git(repo, "add", "-A"); git(repo, "commit", "-qm", "x")
    real = util._git
    monkeypatch.setattr(util, "_git", lambda *a, cwd=None, strip=True: real(*[str(repo) if x == "https://example.com/data" else x for x in a], cwd=cwd, strip=strip))
    run(packs.packs_update("https://example.com/data"))
    return repo


@pytest.fixture
def sent(monkeypatch):
    calls = []

    async def api(method, path, **kw):
        calls.append((method, path, kw.get("body")))
        return {"status": "asked"}

    monkeypatch.setattr(base, "api", api)
    return calls


def test_only_what_is_new_goes(data, sent):
    assert run(registry.pack_share("xx", "X"))["status"] == "nothing_new" and not sent
    reg = util.packs_dir() / "regions" / "xx"
    (reg / "town").mkdir()
    (reg / "town" / "pack.yaml").write_text("id: town\n", encoding="utf-8")
    (reg / "art" / "toys").mkdir(parents=True)
    (reg / "art" / "toys" / "fox-192.webp").write_bytes(b"RIFF")
    (reg / "notes.txt").write_text("my own notes", encoding="utf-8")
    (reg / "sources.yaml").write_text('portals:\n  - {name: P, url: "https://p.example", contact: "call", note: "n"}\ntelegram:\n  - {handle: "@old_chat"}\n  - {handle: "@new_chat", contact: "@person"}\n  - {title: "private", url: "https://t.me/+abc"}\n  - {title: "x", url: "https://t.me/y", note: "+381 64 123 4567"}\n', encoding="utf-8")
    r = run(registry.pack_share("xx", "X: Town", note="lived there"))
    body = sent[0][2]
    assert [f["path"] for f in body["files"]] == ["regions/xx/town/pack.yaml"] and r["not_included"].startswith("2 ")
    assert body["sources"] == [{"section": "telegram", "entry": {"handle": "@new_chat"}}] and len(body["base"]) >= 7
    assert "person" not in json.dumps(body) and "my own notes" not in json.dumps(body)


def test_private_lines_are_shown_to_the_agent_first(data, sent):
    reg = util.packs_dir() / "regions" / "xx"
    (reg / "market.md").write_text("Prices\nCall the owner +381 64 123 45 67\nask @ivan_owner, ivan@example.com\n<!-- hi -->\n", encoding="utf-8")
    (reg / "emergency.yaml").write_text('numbers:\n  - {id: a, phone: "+381 11 123 4567"}\n', encoding="utf-8")
    r = run(registry.pack_share("xx", "X"))
    assert r["status"] == "look_first" and len(r["look"]) == 4 and not any("emergency" in x for x in r["look"]) and not sent
    assert run(registry.pack_share("xx", "X", looked=True))["status"] == "asked" and len(sent) == 1


def test_a_new_country_in_a_folder_of_its_own(data, sent, tmp_path):
    d = tmp_path / "draft" / "regions" / "yy"
    d.mkdir(parents=True)
    (d / "pack.yaml").write_text("id: yy\n", encoding="utf-8")
    (d / "link.md").symlink_to("/etc/hosts")
    for f in (tmp_path / "draft", d):
        run(registry.pack_share("yy", "Y", folder=str(f)))
        assert [x["path"] for x in sent[-1][2]["files"]] == ["regions/yy/pack.yaml"]
    for bad in ("../xx", "X Y", ""):
        with pytest.raises(ToolError):
            run(registry.pack_share(bad, "t"))
    with pytest.raises(ToolError):
        run(registry.pack_share("zz", "t"))


def test_an_update_keeps_the_hunters_own_city(data):
    reg = util.packs_dir() / "regions"
    (reg / "xx" / "town").mkdir()
    (reg / "xx" / "town" / "pack.yaml").write_text("id: town\n", encoding="utf-8")
    (reg / "zz").mkdir()
    (reg / "zz" / "pack.yaml").write_text("id: zz\n", encoding="utf-8")
    (reg / "xx" / "pack.yaml").write_text("id: xx\nname: {en: Mine}\n", encoding="utf-8")
    (reg / "xx" / "market.md").write_text("My prices\n", encoding="utf-8")
    (data / "regions" / "xx" / "market.md").write_text("Their new prices\n", encoding="utf-8")
    git(data, "commit", "-qam", "y")
    r = run(packs.packs_update())
    reg = util.packs_dir() / "regions"
    assert r["countries"] == ["xx", "zz"] and (reg / "xx" / "town" / "pack.yaml").is_file() and "Mine" in (reg / "xx" / "pack.yaml").read_text()
    assert (reg / "xx" / "market.md").read_text() == "Their new prices\n" and r["changed_in_both"] == ["regions/xx/market.md"]
    assert (packs.packs_own() / "regions" / "xx" / "market.md").read_text() == "My prices\n"
    assert run(packs.packs_update())["your_changes_kept"] == sorted(["regions/xx/pack.yaml", "regions/xx/town/pack.yaml", "regions/zz/pack.yaml"])
