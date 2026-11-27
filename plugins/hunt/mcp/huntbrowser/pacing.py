"""hunt_browser: pacing."""
from __future__ import annotations
import asyncio
import contextlib
import json
import re
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
try:
    import fcntl
except ImportError:  # Windows: no file locking
    fcntl = None  # type: ignore[assignment]
from huntshared import PACE, QUIET_DEFAULT
from huntbrowser import base as _base, helpers as _helpers
# ---------------------------------------------------------------- pacing

DEFAULT_PACING = {
    # min_interval_s: between any two sends on this account; min_interval_new_s: between first
    # messages to new people; daily_new_cap: first messages per local day.
    ch: {"min_interval_s": PACE[ch][0], "min_interval_new_s": PACE[ch][1], "daily_new_cap": PACE[ch][2]} for ch in ("whatsapp", "messenger", "instagram")
}
DEFAULT_QUIET = QUIET_DEFAULT
MAX_INLINE_WAIT_S = 30


class Paced(Exception):
    def __init__(self, reason: str, retry_after: datetime | None):
        super().__init__(reason)
        self.reason = reason
        self.retry_after = retry_after

    def result(self) -> dict:
        return {"status": "paced", "sent": False, "reason": self.reason,
                "retry_after": self.retry_after.isoformat(timespec="minutes") if self.retry_after else None}


class Pacer:
    """Per channel+account send guard. State in browser/pacing.json, shared across processes."""

    def __init__(self, channel: str, account: str, state_path: Path | None = None, now=None):
        self.channel, self.account = channel, account
        self.key = f"{channel}-{account}"
        self.path = state_path or (_base.browser_dir() / "pacing.json")
        self._now = now
        bc = _base.browser_config()
        self.limits = dict(DEFAULT_PACING[channel])
        self.limits.update((bc.get("pacing") or {}).get(channel) or {})
        # browser.quiet_hours, else the Telegram server's quiet_hours (same config file), else 21:00-08:00
        tg = _base.load_config().get("telegram") or {}
        qspec = bc["quiet_hours"] if "quiet_hours" in bc else (tg.get("quiet_hours") or DEFAULT_QUIET)
        self.qh = _helpers.parse_quiet_hours(qspec)
        tzname = (qspec.get("tz") if isinstance(qspec, dict) else None) or bc.get("timezone")
        try:
            self.tz = ZoneInfo(tzname) if tzname else None
        except (ZoneInfoNotFoundError, ValueError):
            self.tz = None

    def now(self) -> datetime:
        n = self._now() if self._now else datetime.now().astimezone()
        return n.astimezone(self.tz) if self.tz else n.astimezone()

    @contextlib.contextmanager
    def _state(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        lock = open(self.path.with_suffix(".lock"), "a+")
        try:
            if fcntl:
                fcntl.flock(lock, fcntl.LOCK_EX)
            try:
                data = json.loads(self.path.read_text() or "{}")
            except (OSError, json.JSONDecodeError):
                data = {}
            st = data.setdefault(self.key, {})
            yield st
            _base._write_private(self.path, json.dumps(data, ensure_ascii=False, indent=1).encode())
        finally:
            if fcntl:
                fcntl.flock(lock, fcntl.LOCK_UN)
            lock.close()

    def _today(self, now: datetime) -> str:
        return now.date().isoformat()

    async def check(self, new_chat: bool | None) -> None:
        """Raise Paced if we must not send now. Short waits (<=30 s) are slept out instead."""
        now = self.now()
        with self._state() as st:
            blocked = st.get("blocked_until")
            if blocked and datetime.fromisoformat(blocked) > now:
                raise Paced(f"{self.channel} showed a limit warning earlier ({st.get('blocked_reason', '')}); "
                            "paused for this account", datetime.fromisoformat(blocked))
            if _helpers.in_quiet_hours(now, self.qh):
                raise Paced("quiet hours (config browser.quiet_hours, default 21:00-08:00 local)",
                            _helpers.quiet_end(now, self.qh))
            last = st.get("last_send_ts")
            wait = 0.0
            if last:
                wait = max(wait, float(self.limits["min_interval_s"]) - (now.timestamp() - last))
            if new_chat:
                day = st.get("new_chats", {}).get(self._today(now), [])
                if len(day) >= int(self.limits["daily_new_cap"]):
                    tomorrow = (now + timedelta(days=1)).replace(hour=self.qh[1] // 60 if self.qh else 9,
                                                                 minute=0, second=0, microsecond=0)
                    raise Paced(f"daily cap of {self.limits['daily_new_cap']} new chats reached", tomorrow)
                last_new = st.get("last_new_ts")
                if last_new:
                    wait = max(wait, float(self.limits["min_interval_new_s"]) - (now.timestamp() - last_new))
        if wait > MAX_INLINE_WAIT_S:
            raise Paced(f"too soon after the previous {'new chat' if new_chat else 'message'}",
                        now + timedelta(seconds=wait))
        if wait > 0:
            await asyncio.sleep(wait)

    def record(self, peer: str, new_chat: bool) -> None:
        now = self.now()
        with self._state() as st:
            st["last_send_ts"] = now.timestamp()
            if new_chat:
                st["last_new_ts"] = now.timestamp()
                nc = st.setdefault("new_chats", {})
                nc.setdefault(self._today(now), []).append(peer)
                for d in sorted(nc)[:-7]:  # keep a week
                    nc.pop(d, None)

    def block(self, reason: str, hours: int = 24) -> None:
        with self._state() as st:
            st["blocked_until"] = (self.now() + timedelta(hours=hours)).isoformat()
            st["blocked_reason"] = reason[:200]

    def summary(self) -> dict:
        now = self.now()
        with self._state() as st:
            return {"limits": self.limits, "quiet_hours": self.qh and f"{self.qh[0]//60:02d}:{self.qh[0]%60:02d}-{self.qh[1]//60:02d}:{self.qh[1]%60:02d}",
                    "new_chats_today": len(st.get("new_chats", {}).get(self._today(now), [])),
                    "blocked_until": st.get("blocked_until")}


LIMIT_RE = re.compile(
    r"approaching (the |your )?limit|temporarily (blocked|restricted|limited)|account (is )?restricted|"
    r"try again later|you.re temporarily|we limit how often|limit reached|too many messages|"
    r"временно (заблок|огранич)|попробуйте позже|лимит", re.I)
