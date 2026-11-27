"""Updates: X-Hunt-Version, the updates block of hunt_status (daily cache, offline switch), packs_update check and rollback."""
import asyncio
import json
import subprocess
import time
from pathlib import Path

import httpx
import pytest

from huntcore import base, packs, searches, setup, updates, util
from huntcore.base import ToolError

URL = "https://crm.test"
MANIFEST = Path(__file__).resolve().parents[2] / ".claude-plugin" / "plugin.json"


def run(c):
    return asyncio.run(c)


class Fake:
    """The CRM and raw.githubusercontent.com behind one MockTransport; records every request."""

    def __init__(self):
        self.requests, self.latest, self.health = [], "9.9.9", {"ok": True, "service": "hunt-crm", "version": "0.1.0", "api": 1, "min_plugin": "0.1.0"}

    def __call__(self, req):
        self.requests.append(req)
        if req.url.host == "raw.githubusercontent.com":
            return httpx.Response(200, json={"name": "hunt", "version": self.latest})
        if req.url.path == "/health":
            return httpx.Response(200, json=self.health)
        if req.url.path == "/api/me":
            return httpx.Response(200, json={"user": {"id": "u_t"}, "profile": None})
        if req.url.path == "/api/searches":
            return httpx.Response(426, json={"error": "plugin_outdated", "message": "This Hunt server needs the plugin 0.3.0 or newer"})
        return httpx.Response(404, json={"error": "not_found"})

    def to(self, host):
        return [r for r in self.requests if r.url.host == host]


@pytest.fixture
def fake(monkeypatch, isolated):
    f = Fake()
    monkeypatch.setattr(base, "_TRANSPORT", httpx.MockTransport(f))
    base.update_config(lambda c: c.__setitem__("api_url", URL))
    isolated.set_password("hunt", URL, "hunt_test_token")
    return f


def test_the_plugin_says_its_version(fake):
    v = json.loads(MANIFEST.read_text())["version"]
    assert base.plugin_version() == v
    run(setup.hunt_status())
    assert fake.to("crm.test")[-1].headers["x-hunt-version"] == v and fake.to("crm.test")[0].headers["x-hunt-version"] == v


def test_an_outdated_plugin_gets_the_way_to_update(fake):
    with pytest.raises(ToolError, match="426 plugin_outdated.*hunt-onboarding, step 7"):
        run(searches.search_list())


def test_status_says_what_is_behind_once_a_day(fake, monkeypatch):
    monkeypatch.setenv("HUNT_UPDATE_CHECK", "1")
    monkeypatch.setattr(base, "plugin_version", lambda: "0.2.0")
    st = run(setup.hunt_status())
    u = st["updates"]
    assert u["plugin"] == {"installed": "0.2.0", "latest": "9.9.9"} and u["server"] == {"version": "0.1.0", "min_plugin": "0.1.0"}
    assert "plugin 0.2.0 → 9.9.9" in u["next"] and "server 0.1.0 → 9.9.9" in u["next"] and "/hunt:update" in u["next"]
    assert len(fake.to("raw.githubusercontent.com")) == 1
    run(setup.hunt_status())
    assert len(fake.to("raw.githubusercontent.com")) == 1  # cached for a day
    base.update_config(lambda c: c["update_check"].__setitem__("plugin_at", time.time() - 25 * 3600))
    fake.latest = "0.2.0"
    nxt = run(setup.hunt_status())["updates"].get("next") or ""
    assert "plugin 0.2.0" not in nxt and "server 0.1.0 → 0.2.0" in nxt  # the next day: checked again, the plugin is current
    assert len(fake.to("raw.githubusercontent.com")) == 2


def test_status_when_the_server_needs_a_newer_plugin(fake, monkeypatch):
    monkeypatch.setenv("HUNT_UPDATE_CHECK", "1")
    monkeypatch.setattr(base, "plugin_version", lambda: "0.2.0")
    fake.health = {**fake.health, "version": "0.3.0", "min_plugin": "0.3.0"}
    fake.latest = "0.3.0"
    assert run(setup.hunt_status())["updates"]["next"].startswith("the server needs plugin 0.3.0 or newer (this is 0.2.0)")


def test_offline_switch_and_broken_answers(fake, monkeypatch):
    st = run(setup.hunt_status())  # HUNT_UPDATE_CHECK=0 from conftest
    assert not fake.to("raw.githubusercontent.com") and st["updates"]["plugin"]["latest"] is None and "next" not in st["updates"]
    monkeypatch.setenv("HUNT_UPDATE_CHECK", "1")
    fake.latest = "<script>"
    assert run(setup.hunt_status())["updates"]["plugin"]["latest"] is None
    monkeypatch.setattr(updates, "summary", lambda *a: (_ for _ in ()).throw(RuntimeError("x")))
    assert run(setup.hunt_status())["updates"] == {"error": "RuntimeError"} and run(setup.hunt_status())["ready"]


def test_status_without_a_crm_still_checks_the_plugin(monkeypatch, isolated):
    monkeypatch.setattr(base, "_TRANSPORT", httpx.MockTransport(Fake()))
    monkeypatch.setenv("HUNT_UPDATE_CHECK", "1")
    st = run(setup.hunt_status())
    assert st["ready"] is False and st["updates"]["plugin"]["latest"] == "9.9.9"


def test_versions_compare_as_numbers():
    assert updates.cmp_version("0.10.0", "0.9.9") > 0 and updates.cmp_version("1.0.0", "1.0.0") == 0 and updates.cmp_version("0.2.1", "0.3.0") < 0


# ---------------------------------------------------------------- packs

def _pack(root, currency):
    d = root / "regions" / "xx"
    d.mkdir(parents=True, exist_ok=True)
    (d / "pack.yaml").write_text(f"id: xx\ncurrency: {currency}\n", encoding="utf-8")


def test_rollback_puts_the_previous_copy_back(tmp_path, monkeypatch):
    monkeypatch.delenv("HUNT_REGIONS", raising=False)
    with pytest.raises(ToolError, match="no earlier copy"):
        run(packs.packs_update(rollback=True))
    src = tmp_path / "data"
    _pack(src, "OLD")
    first = run(packs.packs_update(str(src)))
    assert "previous_version" not in first
    _pack(src, "NEW")
    r = run(packs.packs_update())
    assert r["previous_version"] == "local" and "rollback=True" in r["rollback"] and packs.merged_pack("xx")["currency"] == "NEW"
    back = run(packs.packs_update(rollback=True))
    assert back["countries"] == ["xx"] and packs.merged_pack("xx")["currency"] == "OLD"
    run(packs.packs_update(rollback=True))  # and forward again
    assert packs.merged_pack("xx")["currency"] == "NEW"


def test_check_compares_without_downloading(tmp_path, monkeypatch):
    monkeypatch.delenv("HUNT_REGIONS", raising=False)
    repo = tmp_path / "repo"
    _pack(repo, "A")
    git = lambda *a: subprocess.run(["git", *a], cwd=repo, check=True, capture_output=True, text=True).stdout.strip()  # noqa: E731
    git("init", "-q")
    git("add", "-A")
    git("-c", "user.email=a@example.com", "-c", "user.name=a", "commit", "-qm", "a")
    real = util._git
    monkeypatch.setattr(util, "_git", lambda *a, cwd=None, strip=True: real(*[str(repo) if x == "https://example.com/data" else x for x in a], cwd=cwd, strip=strip))
    monkeypatch.setattr(updates, "_ls_remote", lambda src: git("rev-parse", "HEAD") if src == "https://example.com/data" else None)
    monkeypatch.setenv("HUNT_UPDATE_CHECK", "1")
    run(packs.packs_update("https://example.com/data"))
    c = run(packs.packs_update(check=True))
    assert c["behind"] is False and c["installed"] == c["latest"] and c["source"] == "https://example.com/data"
    _pack(repo, "B")
    git("-c", "user.email=a@example.com", "-c", "user.name=a", "commit", "-qam", "b")
    c = run(packs.packs_update(check=True))
    assert c["behind"] is True and packs.merged_pack("xx")["currency"] == "A"  # nothing downloaded
    r = run(packs.packs_update())
    assert r["version"] == c["latest"] and r["previous_version"] == c["installed"] and packs.merged_pack("xx")["currency"] == "B"


def test_check_of_a_local_folder(tmp_path, monkeypatch):
    monkeypatch.delenv("HUNT_REGIONS", raising=False)
    _pack(tmp_path / "d", "A")
    run(packs.packs_update(str(tmp_path / "d")))
    c = run(packs.packs_update(check=True))
    assert c["installed"] == "local" and c["latest"] is None and "note" in c
