# Hunt

Instructions for coding agents (Claude Code reads them through `CLAUDE.md`, Codex reads this file).

## Three repositories, side by side

- `hunt` (this one, public): all the code. Work here.
- `../hunt-data` (public): the countries, and only there (`regions/<country>/`). The app (`crm/scripts/copy-art.mjs`), the plugin (`regions_root`) and the tests find it next to this folder; `HUNT_REGIONS=<path>/regions` overrides. `plugins/hunt/regions/` keeps only `_generic`. Change a country in `../hunt-data`, not here.
- `../hunt-studio` (private, may be missing): mockups and design history (`design/…`; a `design/…` path in `DESIGN.md` means `../hunt-studio/design/…`), the config of our own server, the tests that need the private demo seed, the leak check. Nothing private goes into `hunt` or `hunt-data`: no real names, phones, house photos, workplace, our server's ids. Both are public.

## UI

UI work follows the design system: @DESIGN.md (tokens live in `crm/public/app.css`, the region screen colour and map accent in `../hunt-data/regions/*/art/theme.yaml`, mockups in `../hunt-studio/design/`). Region art, animals and goods toys: skill `plugins/hunt/skills/hunt-art`. Mockup in pen.dev first, then code.

## Engineering

Layout: the Mini App is TypeScript in `crm/web/` (`app.ts` entry + `app/<area>/*.ts`, Preact + htm from npm), built by `node crm/scripts/build-web.mjs` (esbuild) into `crm/public/app.js` (git-ignored; `npm run dev` and `npm run deploy` build it, `--watch` while editing); types: `npm run typecheck` in `crm/` (the server strict; the Mini App loose, plus the files in `web/typed.json` with stricter options via `scripts/typecheck-web.mjs`: type a module, then add it to the list; API and state types in `web/types/api.ts`, table rows generated into `web/types/rows.ts` by `scripts/web-rows.mjs` after a migration); the server is `crm/src/*.ts`, one module per area; the plugin's core MCP server is `plugins/hunt/mcp/hunt_core.py` (entry) + `huntcore/<area>.py`. Add code to the module of its area, not to the entry files.

Worker + D1 + KV on the Cloudflare free tier, or the same Worker on Node + SQLite (`crm/node/`: D1/KV-shaped adapters and the server, built by `scripts/build-node.mjs`, `crm/Dockerfile`; see `crm/README.md`). Keep `src/` free of `node:` imports so `wrangler deploy` stays the same; API reference `core/API.md`; region pack format `core/PACK_FORMAT.md` (keep `plugins/hunt/docs/PACK_FORMAT.md` identical). The Codex plugin: `plugins/hunt/docs/CODEX.md`; after changing `plugins/hunt/commands/` run `node scripts/codex-skills.mjs`.

Checks: `npm run typecheck`, `node scripts/test-web.mjs`, `npm run test:agent-token`, `npm run test:households`, `npm run test:roles`, `npm run test:ui` (the demo in Chrome; needs `public/` built), `npm run lint` (Biome) and `node scripts/schema.mjs --check` in `crm/`; `uvx ruff@0.17.5 check plugins/hunt/mcp` (after a migration: `node scripts/schema.mjs`), `node registry/scripts/test.mjs`, the plugin tests (`plugins/hunt/mcp/README.md`), `node scripts/codex-skills.mjs --check`.

Deploys (`npm run migrate`, `npm run deploy`) only with the human's go-ahead; our own server deploys with the config from `../hunt-studio`.
