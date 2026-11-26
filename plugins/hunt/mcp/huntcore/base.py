"""Hunt core: base (split from hunt_core.py)."""
from __future__ import annotations
import asyncio
import contextlib
import html
import io
import json
import logging
import math
import mimetypes
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import xml.etree.ElementTree as ET
from collections import Counter
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, quote, unquote, unquote_plus, urlencode, urlparse
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
import httpx
import keyring
import yaml
try:  # mcp 1.x
    from mcp.server.fastmcp import FastMCP
    from mcp.server.fastmcp.exceptions import ToolError
except ImportError:  # mcp 2.x renamed FastMCP to MCPServer
    from mcp.server.mcpserver import MCPServer as FastMCP
    from mcp.server.mcpserver.exceptions import ToolError
try:
    import fcntl
except ImportError:  # Windows: no file locking, writes are still atomic
    fcntl = None  # type: ignore[assignment]

KEYRING_SERVICE = "hunt"
logging.getLogger("httpx").setLevel(logging.WARNING)  # no per-request INFO lines in MCP logs
USER_AGENT = "hunt-mcp/0.1"
_CLIENTS = ("claude-code", "codex")


def client_name(argv: list[str] | None = None) -> str:
    """Which agent runs this server: `--client X` / `--client=X`, else $HUNT_CLIENT, else claude-code (unknown → claude-code)."""
    args = sys.argv[1:] if argv is None else argv
    val = None
    for i, a in enumerate(args):
        if a == "--client" and i + 1 < len(args):
            val = args[i + 1]
        elif a.startswith("--client="):
            val = a.split("=", 1)[1]
    val = (val or os.environ.get("HUNT_CLIENT") or "").strip().lower()
    return val if val in _CLIENTS else "claude-code"


def _crm_headers(token: str = "", **extra: str) -> dict[str, str]:
    """Headers of every call to the CRM: the user agent, which client we are, the token when there is one."""
    h = {"User-Agent": USER_AGENT, "X-Hunt-Client": client_name(), **extra}
    if token:
        h["Authorization"] = f"Bearer {token}"
    return h
# Tests replace this with httpx.MockTransport.
_TRANSPORT: httpx.AsyncBaseTransport | None = None

mcp = FastMCP(
    "hunt",
    instructions=(
        "Hunt CRM, region packs and time helpers for renting a home abroad. "
        "Start with hunt_status. Region knowledge: region_list → region_get → region_doc. "
        "Outgoing messages go through draft_create → (human approves in Telegram) → drafts_ready → "
        "send final_text with a channel tool → draft_mark."
    ),
)


# ---------------------------------------------------------------- config

def config_dir() -> Path:
    return Path(os.environ.get("HUNT_CONFIG_DIR") or (Path.home() / ".config" / "hunt")).expanduser()


def config_path() -> Path:
    return config_dir() / "config.json"


def load_config() -> dict[str, Any]:
    p = config_path()
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text(encoding="utf-8") or "{}")
    except json.JSONDecodeError as e:
        raise ToolError(f"{p} is not valid JSON ({e}). Fix or delete it, then call hunt_config_set.")


@contextlib.contextmanager
def _locked():
    d = config_dir()
    d.mkdir(parents=True, exist_ok=True)
    with contextlib.suppress(OSError):
        os.chmod(d, 0o700)
    if fcntl is None:
        yield
        return
    with open(d / ".config.lock", "a+") as lf:
        fcntl.flock(lf, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lf, fcntl.LOCK_UN)


def update_config(mutate) -> dict[str, Any]:
    """Read-modify-write config.json under a lock, atomically, mode 600."""
    with _locked():
        cfg = load_config()
        mutate(cfg)
        p = config_path()
        fd, tmp = tempfile.mkstemp(dir=p.parent, prefix=".config.", suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(cfg, f, ensure_ascii=False, indent=2)
            os.chmod(tmp, 0o600)
            os.replace(tmp, p)
        except BaseException:
            with contextlib.suppress(OSError):
                os.unlink(tmp)
            raise
        return cfg


def _norm_url(u: str) -> str:
    u = (u or "").strip().rstrip("/")
    if not re.match(r"^https?://", u):
        raise ToolError(f"api_url must start with https:// (got {u!r}).")
    return u


def _keyring_get(api_url: str) -> str | None:
    try:
        return keyring.get_password(KEYRING_SERVICE, api_url)
    except Exception as e:  # NoKeyringError and backend failures
        raise ToolError(
            f"Cannot read the OS keychain ({type(e).__name__}: {e}). "
            "On a headless machine set HUNT_TOKEN in the MCP server environment instead."
        )


def _keyring_set(api_url: str, token: str) -> None:
    try:
        keyring.set_password(KEYRING_SERVICE, api_url, token)
    except Exception as e:
        raise ToolError(
            f"Cannot write to the OS keychain ({type(e).__name__}: {e}). "
            "On a headless machine set HUNT_TOKEN in the MCP server environment instead."
        )


def _creds() -> tuple[str, str]:
    url = os.environ.get("HUNT_API_URL") or load_config().get("api_url")
    if not url:
        raise ToolError(
            "Hunt is not connected to a CRM yet. Ask the user for the CRM URL and agent token "
            "(the bot sends both after /start), then call hunt_config_set(api_url, token)."
        )
    url = _norm_url(url)
    token = os.environ.get("HUNT_TOKEN") or _keyring_get(url)
    if not token:
        raise ToolError(
            f"No agent token for {url} in the keychain. Get one from the bot (/token) and call hunt_config_set."
        )
    return url, token


# ---------------------------------------------------------------- HTTP

_HINTS = {
    401: "The agent token was rejected. Get a fresh token from the bot (/token) and call hunt_config_set.",
    403: "The CRM refused this action for this token.",
    404: "Check the id: it may be wrong or belong to another search/user.",
    409: "Conflict: the id is already used elsewhere; pick another id.",
    413: "The request is too large (try fewer or smaller photos).",
    429: "Rate limited by Cloudflare; wait a minute and retry.",
}


def _clean(d: dict[str, Any] | None) -> dict[str, Any]:
    return {k: v for k, v in (d or {}).items() if v is not None}


async def api(
    method: str,
    path: str,
    *,
    body: Any = None,
    params: dict[str, Any] | None = None,
    files: list | None = None,
    auth: bool = True,
    timeout: float = 30.0,
    creds: tuple[str, str] | None = None,
) -> Any:
    """Call the CRM and return parsed JSON, or raise ToolError with a readable message."""
    if creds:
        url, token = creds
    elif auth:
        url, token = _creds()
    else:
        url = _norm_url(os.environ.get("HUNT_API_URL") or load_config().get("api_url") or "")
        token = ""
    headers = _crm_headers(token if auth else "", Accept="application/json")
    kw: dict[str, Any] = {"headers": headers, "params": _clean(params)}
    if files is not None:
        kw["files"] = files
    elif body is not None:
        kw["json"] = body
    try:
        async with httpx.AsyncClient(base_url=url, transport=_TRANSPORT, timeout=timeout) as c:
            r = await c.request(method, path, **kw)
    except httpx.TimeoutException:
        raise ToolError(f"The CRM at {url} did not answer within {timeout:.0f}s ({method} {path}). Retry later.")
    except httpx.HTTPError as e:
        raise ToolError(f"Cannot reach the CRM at {url} ({type(e).__name__}: {e}). Check the URL and the network.")
    data: Any
    try:
        data = r.json()
    except ValueError:
        data = None
    if r.status_code >= 400:
        code, msg = "http_error", (r.text or "").strip()[:300]
        if isinstance(data, dict):
            code = data.get("error") or code
            msg = data.get("message") or msg
        hint = _HINTS.get(r.status_code) or ("CRM internal error; retry later." if r.status_code >= 500 else "")
        raise ToolError(f"CRM {r.status_code} {code}: {msg} ({method} {path}). {hint}".strip())
    if data is None and r.content:
        raise ToolError(f"The CRM returned non-JSON for {method} {path} (status {r.status_code}). Is api_url right?")
    return data


def _q(s: str) -> str:
    """Quote one path segment."""
    if not s or "/" in str(s):
        raise ToolError(f"Invalid id {s!r}.")
    return quote(str(s), safe="")
