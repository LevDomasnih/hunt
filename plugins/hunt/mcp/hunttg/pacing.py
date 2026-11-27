"""hunt_telegram: pacing."""
from __future__ import annotations
import re
from datetime import datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from hunttg.base import ToolError
from hunttg import base as _base
# ---------------------------------------------------------------- pacing (pure, unit-tested)

def _hm(s: str) -> tuple[int, int]:
    m = re.fullmatch(r"(\d{1,2}):(\d{2})", str(s).strip())
    if not m or int(m.group(1)) > 23 or int(m.group(2)) > 59:
        raise ToolError(f"Bad time {s!r}: use HH:MM.")
    return int(m.group(1)), int(m.group(2))


def in_quiet_hours(quiet: dict | None, now: datetime) -> tuple[bool, str | None]:
    if not quiet or not quiet.get("start") or not quiet.get("end"):
        return False, None
    try:
        tz = ZoneInfo(quiet.get("tz")) if quiet.get("tz") else None
    except (ZoneInfoNotFoundError, ValueError):
        raise ToolError(f"quiet_hours.tz {quiet.get('tz')!r} is not a valid IANA timezone.")
    local = now.astimezone(tz) if tz else now.astimezone()
    cur = local.hour * 60 + local.minute
    sh, sm = _hm(quiet["start"])
    eh, em = _hm(quiet["end"])
    s, e = sh * 60 + sm, eh * 60 + em
    inside = (s <= cur < e) if s < e else (cur >= s or cur < e)
    return inside, local.strftime("%H:%M %Z")


def pacing_check(state: dict, settings: dict, now: datetime, new_chat: bool) -> dict:
    """Decide whether a send may go now. Returns {ok, wait_s, reason}; wait_s>0 with ok=True means
    'sleep this long, then send'."""
    ts = now.timestamp()
    cd = state.get("cooldown_until") or 0
    if cd > ts:
        return {"ok": False, "reason": f"STOP: cooling down after {state.get('cooldown_reason', 'a Telegram limit')} "
                                        f"until {_base._iso(datetime.fromtimestamp(cd, timezone.utc))}. Do not send from this account until then."}
    if new_chat:
        ncd = state.get("new_chat_cooldown_until") or 0
        if ncd > ts:
            return {"ok": False, "reason": f"STOP: new chats are paused after {state.get('new_chat_cooldown_reason', 'PEER_FLOOD')} "
                                            f"until {_base._iso(datetime.fromtimestamp(ncd, timezone.utc))}. Existing chats still work."}
    quiet, local = in_quiet_hours(settings.get("quiet_hours"), now)
    if quiet:
        q = settings["quiet_hours"]
        return {"ok": False, "reason": f"Quiet hours ({q['start']}–{q['end']} {q.get('tz') or 'local'}, now {local}). "
                                        "Queue it and send after the quiet window."}
    if new_chat:
        recent = [x for x in state.get("new_chats", []) if x.get("ts", 0) > ts - 86400]
        cap = int(settings.get("max_new_chats_per_day") or 0)
        if cap and len(recent) >= cap:
            oldest = min(x["ts"] for x in recent)
            return {"ok": False, "reason": f"Daily limit of {cap} new chats reached (rolling 24 h). Next slot at "
                                            f"{_base._iso(datetime.fromtimestamp(oldest + 86400, timezone.utc))}. Continue live conversations instead."}
        gap = float(settings.get("new_chat_interval_s") or 0)
        last_new = max((x["ts"] for x in recent), default=0)
        if gap and ts - last_new < gap:
            return {"ok": False, "retry_after_s": int(gap - (ts - last_new)) + 1,
                    "reason": f"Too soon after the previous new chat (min {int(gap)} s between first messages). "
                              f"Retry in {int(gap - (ts - last_new)) + 1} s."}
    wait = float(settings.get("min_send_interval_s") or 0) - (ts - float(state.get("last_send_ts") or 0))
    if wait > _base.MAX_AUTO_WAIT_S:
        return {"ok": False, "retry_after_s": int(wait) + 1, "reason": f"Too soon after the previous send; retry in {int(wait) + 1} s."}
    return {"ok": True, "wait_s": max(0.0, wait)}
