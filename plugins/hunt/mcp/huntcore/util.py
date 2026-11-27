"""Hunt core: small helpers shared by the packs, the registry and the places (no other huntcore module imported but base)."""
from __future__ import annotations

import os
import subprocess
from datetime import date, datetime
from pathlib import Path
from typing import Any

from huntcore import base as _base
from huntcore.base import ToolError


def packs_dir() -> Path:
    return _base.config_dir() / "packs"


def _git(*args: str, cwd: Path | None = None, strip: bool = True) -> str:
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0", "GIT_CONFIG_NOSYSTEM": "1"}
    try:
        r = subprocess.run(["git", "-c", "core.hooksPath=/dev/null", "-c", "protocol.ext.allow=never", *args], cwd=cwd, env=env, capture_output=True, text=True, timeout=180)
    except FileNotFoundError:
        raise ToolError("git is not installed.")
    except subprocess.TimeoutExpired:
        raise ToolError("git did not finish in 3 minutes.")
    if r.returncode:
        raise ToolError(f"git {args[0]} failed: {(r.stderr or r.stdout).strip()[-300:]}")
    return r.stdout.strip() if strip else r.stdout


def _base_text(repo: Path, rel: str) -> bytes | None:
    """The file as the catalogue had it, None if it was not there."""
    try:
        r = subprocess.run(["git", "-c", "core.hooksPath=/dev/null", "show", f"HEAD:{rel}"], cwd=repo, capture_output=True, timeout=30)
    except (OSError, subprocess.SubprocessError):
        return None
    return r.stdout if r.returncode == 0 else None


def jsonable(v: Any) -> Any:
    if isinstance(v, dict):
        return {str(k): jsonable(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [jsonable(x) for x in v]
    if isinstance(v, (date, datetime)):
        return v.isoformat()
    return v
