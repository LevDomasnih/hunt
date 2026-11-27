#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "mcp>=1.12,<3",
#   "playwright==1.60.0",
# ]
# [tool.uv]
# exclude-newer = "2026-11-13T00:00:00Z"  # the same packages for everyone; move it forward on purpose
# ///
"""Hunt headless browser MCP server (hunt-browser).

WhatsApp Web, Facebook Messenger and Instagram DMs in dedicated headless Chromium profiles
that run in the background, keep their sessions and never take the hunter's screen.

Profiles: ~/.config/hunt/browser/<channel>-<account>/   (chmod 700, one Chromium per profile)
QR codes: ~/.config/hunt/browser/qr-<account>.png (+ qr-<account>.html that auto-refreshes)
Pacing:   ~/.config/hunt/browser/pacing.json (shared by all Hunt processes, file-locked)
Config:   ~/.config/hunt/config.json, optional "browser" section:
          {"browser": {"quiet_hours": "21:00-08:00", "timezone": "Asia/Makassar", "locale": "en-US",
                       "executable": "/path/to/chrome",
                       "pacing": {"whatsapp": {"min_interval_s": 20, "min_interval_new_s": 150,
                                               "daily_new_cap": 15}}}}

Chromium: reuses the browser Playwright already installed (ms-playwright cache, chromium-1223 for
playwright 1.60). Never downloads browsers; if none is found the tools say how to install one.
Env overrides: HUNT_CONFIG_DIR, HUNT_CHROMIUM (browser executable), PLAYWRIGHT_BROWSERS_PATH.

Rules baked in: the chat is always opened by id and its header checked before sending; a send whose
outcome is unclear is reported as "unknown, check before resending" and never retried; passwords and
the Messenger end-to-end PIN are typed by the human in a visible window (fb_login / ig_login), never
by this server. Never prints to stdout outside the MCP protocol.
"""
from __future__ import annotations

# Importing a module registers its tools on the one app (huntbrowser.base.mcp).
from huntbrowser import base, chromium, helpers, pacing, session, js, whatsapp, messenger, instagram, login, tools, wa_tools, login_tools, fb_tools, ig_tools, misc_tools  # noqa: F401
from huntbrowser.base import mcp

if __name__ == "__main__":
    mcp.run()
