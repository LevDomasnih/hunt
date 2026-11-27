"""Helpers every Hunt MCP server uses (hunt_core, hunt_telegram, hunt_browser, hunt_bridge): the config folder and private
JSON files written atomically under a lock. Each server is a uv script started from this folder, so `import huntshared` works.
"""
from __future__ import annotations

import contextlib
import json
import os
import tempfile
from collections.abc import Iterator
from pathlib import Path

try:
    import fcntl
except ImportError:  # Windows: no file locking, writes are still atomic
    fcntl = None  # type: ignore[assignment]

try:  # mcp 1.x
    from mcp.server.fastmcp.exceptions import ToolError
except ImportError:  # mcp 2.x
    from mcp.server.mcpserver.exceptions import ToolError


# One table of safe sending pace for every channel (ban risk): seconds between any two sends from one account, seconds
# between two first messages to new people, first messages a day. Each server keeps its own config keys for overrides
# (channels/headless.md); the numbers come from here.
PACE: dict[str, tuple[int, int, int]] = {
    "telegram": (20, 120, 20),
    "whatsapp": (20, 150, 15),
    "messenger": (30, 240, 10),
    "instagram": (30, 300, 8),
    "bridge": (20, 120, 20),
}
QUIET_DEFAULT = "21:00-08:00"  # the browser channels wait it out by default; Telegram only when quiet_hours is set


def config_dir() -> Path:
    """~/.config/hunt, or $HUNT_CONFIG_DIR (tests, headless machines)."""
    return Path(os.environ.get("HUNT_CONFIG_DIR") or (Path.home() / ".config" / "hunt")).expanduser()


def private_dir(*parts: str) -> Path:
    """A folder under the config dir, created with mode 700 (the config dir too)."""
    d = config_dir().joinpath(*parts)
    d.mkdir(parents=True, exist_ok=True)
    with contextlib.suppress(OSError):
        os.chmod(config_dir(), 0o700)
        os.chmod(d, 0o700)
    return d


def read_json(p: Path, hint: str = "") -> dict:
    """The file's object, {} when it is missing; a broken file is a ToolError that says which one."""
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text(encoding="utf-8") or "{}")
    except ValueError as e:
        raise ToolError(f"{p} is not valid JSON ({e}).{' ' + hint if hint else ''}")


def write_json(p: Path, data: dict, indent: int | None = 2) -> None:
    """Atomic write, mode 600: a crash never leaves half a file."""
    p.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=p.parent, prefix=f".{p.stem}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=indent)
        os.chmod(tmp, 0o600)
        os.replace(tmp, p)
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(tmp)
        raise


@contextlib.contextmanager
def flock(lock: Path) -> Iterator[None]:
    """An exclusive lock on `lock` (a separate file) for read-modify-write across processes."""
    lock.parent.mkdir(parents=True, exist_ok=True)
    if fcntl is None:
        yield
        return
    with open(lock, "a+") as lf:
        fcntl.flock(lf, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lf, fcntl.LOCK_UN)


@contextlib.contextmanager
def edit_json(p: Path, lock: Path | None = None, hint: str = "") -> Iterator[dict]:
    """with edit_json(path) as data: change data; it is written back atomically under the lock when the block ends."""
    with flock(lock or p.with_name(f".{p.name}.lock")):
        data = read_json(p, hint)
        yield data
        write_json(p, data)
