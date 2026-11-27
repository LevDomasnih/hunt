"""packs_update: country data from a separate repository or folder."""
import asyncio
import subprocess

import pytest

from huntcore import packs, places, util
from huntcore.base import ToolError


def run(c):
    return asyncio.run(c)


@pytest.fixture
def repo(tmp_path, monkeypatch):
    monkeypatch.delenv("HUNT_REGIONS", raising=False)
    d = tmp_path / "data" / "regions" / "xx"
    d.mkdir(parents=True)
    (d / "pack.yaml").write_text("id: xx\nname: {en: X}\ncurrency: XXD\ndrive: car\n", encoding="utf-8")
    return tmp_path / "data"


def test_local_folder_and_update(repo):
    r = run(packs.packs_update(str(repo)))
    assert r["countries"] == ["xx"] and packs.regions_root() == util.packs_dir() / "regions"
    assert packs.merged_pack("xx")["currency"] == "XXD" and places._drive("xx") == "car" and places._drive("nope") == "scooter"
    (repo / "regions" / "xx" / "pack.yaml").write_text("id: xx\ncurrency: NEW\n", encoding="utf-8")
    run(packs.packs_update())  # the same source again
    assert packs.merged_pack("xx")["currency"] == "NEW"


def test_a_bad_update_keeps_the_old_packs(repo, tmp_path):
    run(packs.packs_update(str(repo)))
    for n, make in enumerate([lambda d: (d / "regions" / "xx").mkdir(parents=True),
                              lambda d: ((d / "regions" / "yy").mkdir(parents=True), (d / "regions" / "yy" / "pack.yaml").write_text("id: yy"), (d / "regions" / "yy" / "run.sh").write_text("x")),
                              lambda d: ((d / "regions" / "yy").mkdir(parents=True), (d / "regions" / "yy" / "pack.yaml").symlink_to("/etc/hosts"))]):
        bad = tmp_path / f"bad{n}"
        bad.mkdir()
        make(bad)
        with pytest.raises(ToolError):
            run(packs.packs_update(str(bad)))
        assert packs.merged_pack("xx")["currency"] == "XXD"
    for src in ("http://example.com/x", "ext::sh -c id", "git@host:x", "https://u:p@host/x", "--upload-pack=x", "/nope"):
        with pytest.raises(ToolError):
            run(packs.packs_update(src))


def test_git(repo, monkeypatch):
    for a in (["init", "-q"], ["add", "-A"], ["-c", "user.email=a@example.com", "-c", "user.name=a", "commit", "-qm", "x"]):
        subprocess.run(["git", *a], cwd=repo, check=True)
    real = util._git
    monkeypatch.setattr(util, "_git", lambda *a, cwd=None: real(*[str(repo) if x == "https://example.com/data" else x for x in a], cwd=cwd))
    r = run(packs.packs_update("https://example.com/data"))
    assert r["countries"] == ["xx"] and len(r["version"]) >= 7
