"""hunt_browser: base."""
from __future__ import annotations
import contextlib
import json
import os
import re
import tempfile
from pathlib import Path
from typing import Any
from huntshared import config_dir, private_dir
try:  # mcp 1.x
    from mcp.server.fastmcp import FastMCP
    from mcp.server.fastmcp.exceptions import ToolError
except ImportError:  # mcp 2.x renamed FastMCP to MCPServer
    from mcp.server.mcpserver import MCPServer as FastMCP
    from mcp.server.mcpserver.exceptions import ToolError

CHANNELS = ("whatsapp", "messenger", "instagram")
WA = "https://web.whatsapp.com"
FB = "https://www.facebook.com"
IG = "https://www.instagram.com"
IG_APP_ID = "936619743392459"  # public id the instagram.com web app sends with its own API calls
UNKNOWN = "unknown, check before resending"

mcp = FastMCP(
    "hunt-browser",
    instructions=(
        "Headless WhatsApp Web, Facebook Messenger and Instagram DMs for Hunt. Each channel+account has "
        "its own background Chromium profile. Connect once: wa_login (QR PNG for the hunter to scan), "
        "fb_login / ig_login (a window opens, the hunter logs in themselves). Then *_status, *_inbox, "
        "*_history, *_media, *_send, *_resolve. Before sending read the history; pick the language from "
        "messages with dir='in' only. If a send returns status 'unknown', read the history before doing "
        "anything else; never resend blindly."
    ),
)


# ---------------------------------------------------------------- paths & config

def browser_dir() -> Path:
    return private_dir("browser")


def load_config() -> dict[str, Any]:
    p = config_dir() / "config.json"
    try:
        return json.loads(p.read_text(encoding="utf-8") or "{}")
    except (OSError, json.JSONDecodeError):
        return {}


def browser_config() -> dict[str, Any]:
    cfg = load_config()
    b = cfg.get("browser") if isinstance(cfg.get("browser"), dict) else {}
    out = dict(b)
    out.setdefault("timezone", cfg.get("timezone"))
    return out


_ACCOUNT_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,31}$")


def check_account(account: str) -> str:
    a = (account or "main").strip().lower()
    if not _ACCOUNT_RE.match(a):
        raise ToolError("account must be 1-32 chars: lowercase letters, digits, '-' or '_' (e.g. 'main', 'hunt').")
    return a


def profile_dir(channel: str, account: str) -> Path:
    d = browser_dir() / f"{channel}-{account}"
    d.mkdir(parents=True, exist_ok=True)
    with contextlib.suppress(OSError):
        os.chmod(d, 0o700)
    return d


def _write_private(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if config_dir() in path.parents:  # our own folders (screens/, media/) stay private too
        with contextlib.suppress(OSError):
            os.chmod(path.parent, 0o700)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".tmp.", suffix=path.suffix)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        os.chmod(tmp, 0o600)
        os.replace(tmp, path)
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(tmp)
        raise
