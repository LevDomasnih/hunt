---
description: Collect fresh listings from the region's sources, dedupe, filter by the brief, add cards
argument-hint: "[days back, default 3]"
---
Use skill `hunt` → "Collecting listings". Sources from `region_doc(<search region>, "sources.yaml")`, look back "$ARGUMENTS" days (3 if empty). For each portal call `listing_source_read` on its search URL first, then open only the listings you will add; blocked portals (`skipped: "blocked"`) are opened by hand. Publish good matches as cards with full-size photos and a one-line summary. Report how many were found, skipped (and why) and added.
