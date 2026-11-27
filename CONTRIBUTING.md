# Contributing to Hunt

Thanks for looking. Hunt is made in spare time by a few friends who rent homes abroad together; answers can take a few days.

## The easiest way to help: add your city

Your city is missing? `/hunt:region Lisbon` in Claude Code (or `$hunt:region Lisbon` in Codex) drafts the country and city pack: rules with sources, prices, districts with a short card each, scams, message templates, the main forums. Check it, fix what you know better, then `/hunt:share pt` offers it to everyone: the bot shows you the whole text first and nothing is sent without your yes. A pull request to [hunt-data](https://github.com/LevDomasnih/hunt-data) works too. Format: [PACK_FORMAT.md](core/PACK_FORMAT.md). Art for a new place (animals, colour, the toy city map): the skill [hunt-art](plugins/hunt/skills/hunt-art/SKILL.md).

No people, no private phone numbers, no listings in a pack, and the month you checked each rule (`verified`).

## Code

| Part | Where | Run it |
|---|---|---|
| Server, bot, site (TypeScript) | `crm/src/` | `cd crm && npm ci && npm run dev` (Cloudflare's runtime) or `npm run build:node && npm run start:node` (Node + SQLite) |
| Mini App (TypeScript, Preact + htm) | `crm/web/` | built by `npm run dev`; open `/app` and press *See the demo* |
| The agent's plugin (Python MCP servers, skills, commands) | `plugins/hunt/` | see [plugins/hunt/mcp/README.md](plugins/hunt/mcp/README.md) |
| Design | [DESIGN.md](DESIGN.md) | screens follow it; a new screen starts as a mockup |

Clone [hunt-data](https://github.com/LevDomasnih/hunt-data) next to `hunt`: the app and the tests find the countries there.

Before a pull request, in `crm/`: `npm run lint`, `npm run typecheck`, `node scripts/test-web.mjs`, `npm run test:households`, `npm run test:roles`; for the plugin: `uvx ruff@0.17.5 check plugins/hunt/mcp` and its tests. CI runs all of it on every push. After a database migration: `node scripts/schema.mjs` and `node scripts/web-rows.mjs`.

Small, focused pull requests with a line on why. Code, comments and commits in English; the app speaks Russian first and English.

## Rules that stay

- The agent never pays, signs, or types passwords and codes. A message waits for the person's yes.
- Nothing private in this repository: no real names, phones, house photos or server ids. Pictures and the demo use invented people and toy homes.
- Personal WhatsApp, Messenger and Instagram accounts can be banned for automation: these channels stay optional and say so.
- Hunt is for your own home. It is not a brokerage and does not take a cut of a deal.

## Questions and ideas

An issue is fine. Security problems: see [SECURITY.md](SECURITY.md), not a public issue.
