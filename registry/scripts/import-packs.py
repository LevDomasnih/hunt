#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = ["pyyaml>=6", "httpx>=0.27"]
# ///
"""Loads the sources of the private region packs into the registry.

  uv run registry/scripts/import-packs.py            dry run: counts per country and section
  SOURCES_URL=… SOURCES_ADMIN_KEY=… uv run registry/scripts/import-packs.py --send
Individual people (entries made of personal @handles) are never sent.
"""
import json
import os
import re
import sys
from pathlib import Path

import httpx
import yaml

REGIONS = Path(os.environ.get("HUNT_REGIONS") or Path(__file__).resolve().parents[2] / "plugins" / "hunt" / "regions")
SECTIONS = ["portals", "telegram", "facebook_groups", "whatsapp_communities", "instagram", "line", "agencies", "official", "guides", "post_request_where"]


def personal(e) -> bool:
    return isinstance(e, dict) and len(re.findall(r"@[A-Za-z0-9_]{4,}", str(e.get("contact") or ""))) >= 2


def load(country: str):
    d = yaml.safe_load((REGIONS / country / "sources.yaml").read_text(encoding="utf-8")) or {}
    out, skipped = {}, 0
    for s in SECTIONS:
        v = d.get(s)
        items = [v] if isinstance(v, dict) else list(v or [])
        keep = [x for x in items if not personal(x)]
        skipped += len(items) - len(keep)
        if keep:
            out[s] = keep
    return out, skipped, sorted(set(d) - set(SECTIONS) - {"verified"})


def main() -> None:
    send = "--send" in sys.argv
    for f in sorted(REGIONS.glob("*/sources.yaml")):
        c = f.parent.name
        sections, skipped, unknown = load(c)
        print(c, {k: len(v) for k, v in sections.items()}, f"personal skipped: {skipped}", f"unknown: {unknown}" if unknown else "")
        if send:
            body = json.loads(json.dumps({"country": c, "sections": sections}, default=str))
            r = httpx.post(os.environ["SOURCES_URL"].rstrip("/") + "/admin/import", json=body, headers={"Authorization": f"Bearer {os.environ['SOURCES_ADMIN_KEY']}"}, timeout=60)
            print("  ", r.status_code, r.text[:200])
            r.raise_for_status()


main()
