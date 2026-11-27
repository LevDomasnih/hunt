#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "mcp>=1.12,<3",
#   "telethon>=1.36,<2",
#   "keyring>=24",
#   "qrcode>=7.4",
#   "pypng>=0.20220715",
# ]
# [tool.uv]
# exclude-newer = "2026-11-13T00:00:00Z"  # the same packages for everyone; move it forward on purpose
# ///
"""Hunt Telegram MCP server (Telethon, user account).

One TelegramClient per account label lives inside this process, so tools never open the same
SQLite session twice ("database is locked"). A lock file also stops a second Hunt process from
opening the same account.

Files:    ~/.config/hunt/telegram/<label>.session (mode 600), <label>.lock, state.json
Secrets:  api_id/api_hash in the OS keychain (keyring service "hunt-telegram", username = label,
          falling back to "default"). Passwords are never stored or passed through the agent:
          2FA is typed by the user into a one-time page served on 127.0.0.1.
Settings: "telegram" section of ~/.config/hunt/config.json (see tg_settings).
"""
from __future__ import annotations

# Importing a module registers its tools on the one app (hunttg.base.mcp).
from hunttg import base, keychain, clients, errors, entities, pacing, folders, login_page, setup, reading, sending  # noqa: F401
from hunttg.base import mcp

if __name__ == "__main__":
    mcp.run()
