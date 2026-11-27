"""hunt_telegram: keychain."""
from __future__ import annotations
import json
import keyring
from hunttg.base import ToolError
from hunttg import base as _base
# ---------------------------------------------------------------- keychain

def api_creds(label: str) -> tuple[int, str]:
    for user in (label, "default"):
        try:
            raw = keyring.get_password(_base.KEYRING_SERVICE, user)
        except Exception as e:
            raise ToolError(f"Cannot read the OS keychain ({type(e).__name__}: {e}).")
        if raw:
            try:
                d = json.loads(raw)
                return int(d["api_id"]), str(d["api_hash"])
            except (ValueError, KeyError, TypeError):
                raise ToolError(f"Keychain entry hunt-telegram/{user} is damaged; call tg_setup_api again.")
    raise ToolError(
        "No Telegram API credentials. The user creates them at https://my.telegram.org → API development tools "
        "(app title e.g. 'Hunt'), then call tg_setup_api(api_id, api_hash, account)."
    )
