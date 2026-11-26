"""Where the real country packs are for the tests that check them: inside the plugin (an old checkout) or a hunt-data clone next to
the hunt repository. Without either those tests are skipped (conftest)."""
from pathlib import Path

_MCP = Path(__file__).resolve().parent.parent


def real_regions() -> Path:
    for c in (_MCP.parent / "regions", _MCP.parents[3] / "hunt-data" / "regions"):
        if (c / "bali" / "pack.yaml").exists():
            return c
    return _MCP.parent / "regions"


# The generic pack ships with the plugin (plugins/hunt/regions/_generic), not with hunt-data.
GENERIC = _MCP.parent / "regions" / "_generic"
