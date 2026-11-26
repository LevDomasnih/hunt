-- "Подключить агента": which client the owner's agent runs in (the plugin sends X-Hunt-Client). Additive only.
ALTER TABLE searches ADD COLUMN agent_client TEXT; -- claude-code | codex; NULL = not reported (an older plugin)
