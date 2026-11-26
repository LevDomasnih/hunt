# Hunt in Codex

The same plugin works in OpenAI Codex (checked with Codex CLI 0.145). Codex reads `.codex-plugin/plugin.json` and the marketplace in `.agents/plugins/marketplace.json`; Claude Code keeps `.claude-plugin/` and `.mcp.json`.

## Install

1. Install [uv](https://docs.astral.sh/uv/).
2. Add the marketplace and install the plugin:

   ```
   codex plugin marketplace add LevDomasnih/hunt-app
   codex plugin add hunt@hunt
   ```

   Or in the TUI: `codex` → `/plugins` → Hunt → Install.
3. Open the invite link, press Start in the bot, then start a new Codex session and write `$hunt:new Tbilisi`, paste the address and token from the bot when asked.

Update: `codex plugin marketplace upgrade hunt`, then a new session.

## Commands are skills

Codex has no slash commands. Each Claude Code command has a Codex skill with the same name, mention it with `$`:

| Claude Code | Codex |
|---|---|
| `/hunt:new <place>` | `$hunt:new <place>` |
| `/hunt:connect` | `$hunt:connect` |
| `/hunt:sweep` | `$hunt:sweep` |
| `/hunt:tick` | `$hunt:tick` |
| `/hunt:deal` | `$hunt:deal` |
| `/hunt:region <place>` | `$hunt:region <place>` |
| `/hunt:share <country>` | `$hunt:share <country>` |
| `/hunt:schedule`, `/hunt:close` | `$hunt:schedule`, `$hunt:close` |

Plain words work too ("что нового в поиске"): the main skill `hunt:hunt` picks them up.

The command skills live in `codex-skills/` and are made from `commands/*.md` by `node scripts/codex-skills.mjs` (`--check` fails when they are stale). Only the Codex manifest points at `codex-skills/`, so Claude Code does not show them twice.

## Shared with Claude Code

Logins, the CRM token (OS keychain, service `hunt`), Telegram sessions and browser profiles live in `~/.config/hunt`, so Claude Code and Codex on one computer use the same accounts. One Telegram or browser profile can be open by one process at a time: run Hunt in one agent at a time.

## Differences

- MCP servers start with `cwd` = the plugin folder and relative paths: Codex does not expand `${CLAUDE_PLUGIN_ROOT}` in MCP commands. The servers get only the env Codex passes plus `HUNT_*` overrides listed in the manifest (`env_vars`).
- Regular runs: Claude Code uses a scheduled task or `/loop`; in Codex use an automation in the Codex app, or cron/launchd running `codex exec` with the tick request (the computer must be on).
- No question buttons in the Codex CLI: onboarding asks as a short numbered list.
