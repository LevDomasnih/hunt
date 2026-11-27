"""hunt_browser: helpers."""
from __future__ import annotations
import re
import unicodedata
from datetime import datetime, timedelta
from typing import Any

# ---------------------------------------------------------------- pure helpers (unit-tested)

_PHONE_URL = re.compile(r"(?:wa\.me/|phone=)(\+?\d[\d\s\-().]*)")


def phone_digits(peer: str) -> str | None:
    """Digits of a phone number / wa.me link / JID, or None if peer is a name."""
    s = (peer or "").strip()
    m = _PHONE_URL.search(s)
    if m:
        s = m.group(1)
    s = re.sub(r"@(s\.whatsapp\.net|c\.us)$", "", s)
    if not re.fullmatch(r"\+?[\d\s\-().]+", s):
        return None
    d = re.sub(r"\D", "", s)
    return d if 7 <= len(d) <= 15 else None


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKC", s or "")
    s = re.sub(r"[​-‏‪-‮⁠-⁤︎️]", "", s)
    return re.sub(r"\s+", " ", s).strip().casefold()


def _alnum(s: str) -> str:
    return re.sub(r"[\W_]+", "", _norm(s))


def same_text(shown: str, sent: str) -> bool:
    """True if the message as rendered (with time, ticks, 'Edited'...) contains the text we sent."""
    a, b = _norm(shown), _norm(sent)
    if not b:
        return False
    if b in a or (len(b) > 200 and b[:200] in a):
        return True
    aa, bb = _alnum(shown), _alnum(sent)
    return bool(bb) and (bb in aa or (len(bb) > 150 and bb[:150] in aa))


def display_matches(title: str, expect: str) -> bool:
    t, e = _alnum(title), _alnum(expect)
    if len(e) >= 3:
        return e in t
    return bool(_norm(expect)) and _norm(expect) == _norm(title)


def header_check(title: str, header_all: str, digits: str | None, expect_display: str | None) -> dict:
    """Is the open chat the one we meant? Number digits in the header title, or the stored display name."""
    if digits:
        for text in (title, header_all):
            hd = re.sub(r"\D", "", text or "")
            if hd and digits in hd:
                return {"ok": True, "by": "number"}
    if expect_display and (display_matches(title, expect_display) or display_matches(header_all, expect_display)):
        return {"ok": True, "by": "display"}
    why = "header shows neither the number"
    why += " nor the expected display name" if expect_display else " (pass expect_display = the name stored in the CRM for business/saved contacts)"
    return {"ok": False, "by": None, "reason": why, "header": title or header_all}


def parse_quiet_hours(spec: Any) -> tuple[int, int] | None:
    """'21:00-08:00' or {'start': '21:00', 'end': '08:00'} -> (start_min, end_min); None/'off' -> None."""
    if spec in (None, "", False, "off", "none"):
        return None
    if isinstance(spec, dict):
        spec = f"{spec.get('start', '')}-{spec.get('end', '')}"
    m = re.fullmatch(r"\s*(\d{1,2})(?::(\d{2}))?\s*-\s*(\d{1,2})(?::(\d{2}))?\s*", str(spec))
    if not m:
        return None
    a = int(m.group(1)) * 60 + int(m.group(2) or 0)
    b = int(m.group(3)) * 60 + int(m.group(4) or 0)
    return (a % 1440, b % 1440)


def in_quiet_hours(now_local: datetime, qh: tuple[int, int] | None) -> bool:
    if not qh:
        return False
    a, b = qh
    m = now_local.hour * 60 + now_local.minute
    return (a <= m < b) if a < b else (m >= a or m < b)


def quiet_end(now_local: datetime, qh: tuple[int, int]) -> datetime:
    end = now_local.replace(hour=qh[1] // 60, minute=qh[1] % 60, second=0, microsecond=0)
    return end if end > now_local else end + timedelta(days=1)
