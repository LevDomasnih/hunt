"""hunt_telegram: base."""
from __future__ import annotations
import logging
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from huntshared import PACE, config_dir, flock as _flock, private_dir, read_json as _read_json, write_json as _write_json
try:  # mcp 1.x
    from mcp.server.fastmcp import FastMCP
    from mcp.server.fastmcp.exceptions import ToolError
except ImportError:  # mcp 2.x renamed FastMCP to MCPServer
    from mcp.server.mcpserver import MCPServer as FastMCP
    from mcp.server.mcpserver.exceptions import ToolError

KEYRING_SERVICE = "hunt-telegram"
logging.getLogger("telethon").setLevel(logging.WARNING)
SERVICE_USER_IDS = {777000, 42777}  # Telegram service notifications (login codes): never read or write
DEFAULT_SETTINGS: dict[str, Any] = {
    "min_send_interval_s": PACE["telegram"][0],    # between any two sends from one account
    "new_chat_interval_s": PACE["telegram"][1],    # between two first messages to new people
    "max_new_chats_per_day": PACE["telegram"][2],  # rolling 24 h
    "quiet_hours": None,             # {"start": "21:00", "end": "08:00", "tz": "Asia/Makassar"}
    "folder_auto": False,            # add every new chat opened by tg_send to the folder
    "folder_title": "Hunt",
    "read_scope": "non_contacts",    # tg_inbox: "non_contacts" | "folder" (personal account mode)
    "duplicate_window_h": 6,         # refuse to resend the same text to the same chat within this window
    "media_max_mb": 50,              # tg_media skips bigger files
}
MAX_AUTO_WAIT_S = 90

mcp = FastMCP(
    "hunt-telegram",
    instructions=(
        "Telegram user-account tools for Hunt. Read the whole thread (tg_history) before writing. "
        "Only send texts the owner approved (Hunt drafts). On a STOP message (FLOOD_WAIT, PEER_FLOOD, frozen) "
        "stop all outreach on that account and tell the user."
    ),
)


# ---------------------------------------------------------------- files & settings

def tg_dir() -> Path:
    return private_dir("telegram")


def update_json(p: Path, lock: Path, mutate) -> dict:
    with _flock(lock):
        data = _read_json(p)
        mutate(data)
        _write_json(p, data)
        return data


def settings_for(label: str, cfg: dict | None = None) -> dict:
    cfg = cfg if cfg is not None else _read_json(config_dir() / "config.json")
    tg = cfg.get("telegram") or {}
    out = dict(DEFAULT_SETTINGS)
    out.update({k: v for k, v in tg.items() if k in DEFAULT_SETTINGS})
    out.update({k: v for k, v in ((tg.get("accounts") or {}).get(label) or {}).items() if k in DEFAULT_SETTINGS})
    return out


def state_path() -> Path:
    return tg_dir() / "state.json"


def load_state(label: str) -> dict:
    return (_read_json(state_path()).get(label)) or {}


def update_state(label: str, mutate) -> dict:
    def m(all_: dict) -> None:
        st = all_.setdefault(label, {})
        mutate(st)
    return update_json(state_path(), tg_dir() / ".state.lock", m).get(label, {})


def _label(account: str) -> str:
    a = (account or "hunt").strip().lower()
    if not re.match(r"^[a-z0-9_-]{1,32}$", a):
        raise ToolError("account label must be 1-32 chars of a-z, 0-9, _ or - (e.g. 'hunt', 'personal').")
    return a


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def parse_since(s: str | None) -> datetime | None:
    """ISO date/datetime → aware UTC datetime. Naive values are UTC. Also '24h', '3d', '90m'."""
    if not s:
        return None
    s = s.strip()
    m = re.fullmatch(r"(\d+)\s*([mhd])", s)
    if m:
        n, u = int(m.group(1)), m.group(2)
        unit = {"m": "minutes", "h": "hours", "d": "days"}[u]
        return _now() - timedelta(**{unit: n})
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        raise ToolError(f"Bad since {s!r}: use ISO like 2026-11-18T09:00:00+08:00, 2026-11-18, or 24h / 3d.")
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)
