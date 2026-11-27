"""hunt_browser: chromium."""
from __future__ import annotations
import json
import os
import sys
from pathlib import Path
from typing import Any
from huntbrowser import base as _base
# ---------------------------------------------------------------- Chromium lookup (never downloads)

def playwright_browsers_root() -> Path:
    env = os.environ.get("PLAYWRIGHT_BROWSERS_PATH")
    if env and env != "0":
        return Path(env).expanduser()
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Caches" / "ms-playwright"
    if sys.platform.startswith("win"):
        return Path(os.environ.get("LOCALAPPDATA", Path.home())) / "ms-playwright"
    return Path.home() / ".cache" / "ms-playwright"


def _expected_revision() -> tuple[str | None, str | None]:
    """(chromium revision, browser version) the installed playwright package expects."""
    try:
        import playwright

        p = Path(playwright.__file__).parent / "driver" / "package" / "browsers.json"
        for b in json.loads(p.read_text())["browsers"]:
            if b.get("name") == "chromium":
                return str(b.get("revision")), b.get("browserVersion")
    except Exception:
        pass
    return None, None


_FULL_EXE = (
    "chrome-mac*/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    "chrome-mac*/Chromium.app/Contents/MacOS/Chromium",
    "chrome-linux*/chrome",
    "chrome-win*/chrome.exe",
)
_SHELL_EXE = (
    "chrome-headless-shell-*/chrome-headless-shell",
    "chrome-headless-shell-*/chrome-headless-shell.exe",
)


def find_chromium(root: Path | None = None) -> dict[str, Any]:
    """Locate an installed Chromium. Returns {full, shell, revision, version}; paths may be None."""
    root = root or playwright_browsers_root()
    want, version = _expected_revision()
    found: dict[str, Any] = {"full": None, "shell": None, "revision": None, "version": version, "root": str(root)}
    override = os.environ.get("HUNT_CHROMIUM") or _base.browser_config().get("executable")
    if override and Path(override).exists():
        found["full"] = str(override)
        return found

    def scan(prefix: str, patterns: tuple[str, ...]) -> tuple[str | None, str | None]:
        if not root.is_dir():
            return None, None
        dirs = []
        for d in root.glob(f"{prefix}-*"):
            rev = d.name.rsplit("-", 1)[-1]
            if rev.isdigit() and (d / "INSTALLATION_COMPLETE").exists():
                dirs.append((rev == want, int(rev), d))
        for _, rev, d in sorted(dirs, reverse=True):  # expected revision first, then newest
            for pat in patterns:
                for exe in d.glob(pat):
                    if exe.is_file():
                        return str(exe), str(rev)
        return None, None

    found["full"], rev_full = scan("chromium", _FULL_EXE)
    found["shell"], rev_shell = scan("chromium_headless_shell", _SHELL_EXE)
    found["revision"] = rev_full or rev_shell
    if found["revision"] and found["revision"] != want:
        found["version"] = None  # version string belongs to another revision
    return found


def chromium_missing_message(root: str) -> str:
    want, _ = _expected_revision()
    return (
        f"No Chromium found under {root} (expected chromium-{want or '?'}). hunt-browser never downloads "
        "browsers by itself. Install it once (~250 MB): `uvx --from playwright==1.60.0 playwright install "
        "chromium`, or point HUNT_CHROMIUM (or config.json browser.executable) at an existing Chrome/Chromium."
    )


def user_agent(version: str | None) -> str:
    major = (version or "148").split(".")[0]
    if sys.platform == "darwin":
        os_part = "Macintosh; Intel Mac OS X 10_15_7"
    elif sys.platform.startswith("win"):
        os_part = "Windows NT 10.0; Win64; x64"
    else:
        os_part = "X11; Linux x86_64"
    return f"Mozilla/5.0 ({os_part}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{major}.0.0.0 Safari/537.36"
