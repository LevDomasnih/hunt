"""Hunt core: updates. What is behind (this plugin, the server, the countries) for hunt_status and packs_update(check=True).
Reads only public data: the plugin manifest on the main branch and the data repository's HEAD, at most once a day (cached in
config.json, key update_check). HUNT_UPDATE_CHECK=0 turns the network part off (tests, offline machines); the cache still
answers. One version for the plugin and the server (scripts/release.mjs)."""
from __future__ import annotations

import asyncio
import os
import re
import subprocess
import time
from typing import Any

import httpx

from huntcore import base as _base, util as _util

LATEST_URL = "https://raw.githubusercontent.com/LevDomasnih/hunt/main/plugins/hunt/.claude-plugin/plugin.json"
CHECK_SECONDS = 24 * 3600
_SEMVER = re.compile(r"^\d+\.\d+\.\d+$")
_HTTPS = re.compile(r"^https://[^\s@]+$")


def cmp_version(a: str, b: str) -> int:
    """Negative when a < b, 0 when equal, positive when a > b (x.y.z)."""
    x, y = [int(p) for p in a.split(".")], [int(p) for p in b.split(".")]
    return (x > y) - (x < y)


def check_enabled() -> bool:
    return os.environ.get("HUNT_UPDATE_CHECK", "1") != "0"


def _cache() -> dict[str, Any]:
    c = _base.load_config().get("update_check")
    return c if isinstance(c, dict) else {}


def _remember(**kv: Any) -> None:
    def put(cfg: dict) -> None:
        c = cfg.get("update_check")
        cfg["update_check"] = {**(c if isinstance(c, dict) else {}), **kv}
    _base.update_config(put)


async def latest_plugin(force: bool = False) -> str | None:
    """The plugin version on the main branch, from the daily cache when it is fresh; None when unknown."""
    c = _cache()
    if not check_enabled() or (not force and float(c.get("plugin_at") or 0) > time.time() - CHECK_SECONDS):
        return c.get("plugin")
    v = ""
    try:
        async with httpx.AsyncClient(transport=_base._TRANSPORT, timeout=5.0) as client:
            r = await client.get(LATEST_URL, headers={"User-Agent": _base.USER_AGENT})
        if r.status_code == 200:
            v = str(r.json().get("version") or "")
    except (httpx.HTTPError, ValueError, AttributeError):
        v = ""
    latest = v if _SEMVER.match(v) else None
    _remember(plugin=latest, plugin_at=time.time())
    return latest


def packs_installed() -> str | None:
    """The short commit of the installed data repository, None for a copy from a local folder or nothing installed."""
    d = _util.packs_dir()
    if not (d / ".git").exists():
        return None
    try:
        return _util._git("rev-parse", "--short", "HEAD", cwd=d)
    except _base.ToolError:
        return None


def _ls_remote(src: str) -> str | None:
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0", "GIT_CONFIG_NOSYSTEM": "1"}
    try:
        r = subprocess.run(["git", "-c", "protocol.ext.allow=never", "ls-remote", "--", src, "HEAD"], env=env, capture_output=True, text=True, timeout=15)
    except (OSError, subprocess.SubprocessError):
        return None
    sha = (r.stdout.split() or [""])[0] if r.returncode == 0 else ""
    return sha if re.fullmatch(r"[0-9a-f]{40}", sha) else None


async def packs_latest(src: str, force: bool = False) -> str | None:
    """The data repository's HEAD commit (full), from the daily cache when it is fresh; None for a local folder or unknown."""
    if not _HTTPS.match(src):
        return None
    c = _cache()
    fresh = c.get("packs_src") == src and float(c.get("packs_at") or 0) > time.time() - CHECK_SECONDS
    if not check_enabled() or (fresh and not force):
        return c.get("packs") if c.get("packs_src") == src else None
    sha = await asyncio.to_thread(_ls_remote, src)
    _remember(packs=sha, packs_at=time.time(), packs_src=src)
    return sha


def same_commit(short: str | None, full: str | None) -> bool:
    return bool(short and full and full.startswith(short))


async def summary(health: Any, packs_src: str) -> dict[str, Any]:
    """The updates block of hunt_status: installed and latest for each part, and one line to say when something is behind."""
    installed, latest = _base.plugin_version(), await latest_plugin()
    out: dict[str, Any] = {"plugin": {"installed": installed, "latest": latest}}
    server = health.get("version") if isinstance(health, dict) else None
    min_plugin = health.get("min_plugin") if isinstance(health, dict) else None
    if server:
        out["server"] = {"version": server, "min_plugin": min_plugin}
    pi = packs_installed()
    pl = await packs_latest(packs_src) if pi else None
    out["packs"] = {"installed": pi, "latest": pl[:7] if pl else None}
    behind = []
    if installed and min_plugin and _SEMVER.match(str(min_plugin)) and cmp_version(installed, str(min_plugin)) < 0:
        behind.append(f"the server needs plugin {min_plugin} or newer (this is {installed})")
    elif installed and latest and cmp_version(latest, installed) > 0:
        behind.append(f"plugin {installed} → {latest}")
    if pi and pl and not same_commit(pi, pl):
        behind.append(f"countries {pi} → {pl[:7]}")
    if server and latest and _SEMVER.match(str(server)) and cmp_version(latest, str(server)) > 0:
        behind.append(f"server {server} → {latest} (its admin updates it)")
    if behind:
        out["next"] = "; ".join(behind) + ". Say it once and offer /hunt:update (Codex: $hunt:update); never in the middle of sending."
    return out
