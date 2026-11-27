#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "mcp>=1.12,<3",
#   "httpx>=0.27",
#   "pyyaml>=6",
#   "keyring>=24",
#   "pillow>=10",
# ]
# [tool.uv]
# exclude-newer = "2026-11-13T00:00:00Z"  # the same packages for everyone; move it forward on purpose
# ///
"""Hunt core MCP server.

Talks to the Hunt CRM (a Cloudflare Worker, see core/API.md), reads region packs
(regions/<country>/pack.yaml + <city>/pack.yaml) and offers small time/route helpers.

Config:  ~/.config/hunt/config.json  ({"api_url": ..., "digest_cursors": {...}})
Token:   OS keychain via `keyring`, service "hunt", username = api_url
Packs:   $HUNT_REGIONS, else the hunt-data copy packs_update installs, else a hunt-data checkout next to the hunt
         repository, else <plugin root>/regions (only _generic; plugin root = parent of mcp/, or $CLAUDE_PLUGIN_ROOT)

Env overrides (for headless/CI use): HUNT_CONFIG_DIR, HUNT_API_URL, HUNT_TOKEN.
Client:  `--client codex` (the Codex manifest passes it), else $HUNT_CLIENT, else claude-code; sent as X-Hunt-Client so the
         Mini App shows which agent is connected.
Never prints to stdout outside the MCP protocol.
"""
from __future__ import annotations

# Importing an area module registers its tools on the one FastMCP app (huntcore.base.mcp). The order matters only for
# reading: base first, the rest by area. Tests import huntcore.<area> directly and patch a name in the module that owns it.
from huntcore import base, util, setup, searches, listings, messages, deals, money, house, home, places, packs, registry, routes, location, flood, items, living, stage, useful, events, parties, orders, event_photos, event_sources, portals  # noqa: F401
from huntcore.base import mcp

if __name__ == "__main__":
    mcp.run()
