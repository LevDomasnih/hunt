"""Hunt core: portals (split from hunt_core.py)."""
from __future__ import annotations
import contextlib
import html
import json
import logging
import math
import re
from datetime import datetime
from typing import Any
from urllib.parse import parse_qs, urlparse
from zoneinfo import ZoneInfo
from huntcore.base import ToolError
from huntcore import base as _base, deals as _deals, event_photos as _event_photos, event_sources as _event_sources, events as _events, places as _places
# ---------------------------------------------------------------- portal pages (read-only): listing_source_read

# Sites that refuse automated reads (403 / 401 / bot challenge): the tool answers "open it by hand" without fetching.
# Key = registrable domain, or "<brand>.*" for every country domain of a brand. Checked 2026-11-25/26.
BLOCKED_SITES: dict[str, str] = {
    "halooglasi.com": "Halo oglasi answers 403 to automated reads",
    "nekretnine.rs": "Nekretnine.rs answers 403 to automated reads",
    "ss.ge": "ss.ge answers 403 to automated reads",
    "myhome.ge": "myhome.ge answers 403 to automated reads",
    "korter.ge": "Korter answers 403 to automated reads",
    "sahibinden.com": "sahibinden.com answers 403 to automated reads",
    "hepsiemlak.com": "Hepsiemlak answers 403 to automated reads",
    "emlakjet.com": "Emlakjet answers 403 to automated reads",
    "lamudi.*": "Lamudi answers 401/403 (Cloudflare) to automated reads",
    "olx.*": "OLX answers 403 to automated reads",
    "krisha.kz": "Krisha.kz serves a bot challenge (HTTP 468) instead of the page",
    "ddproperty.com": "DDproperty serves a Cloudflare challenge (403) instead of the page",
    "fazwaz.*": "FazWaz serves a Cloudflare challenge (403) instead of the page",
    "hipflat.*": "Hipflat serves a Cloudflare challenge (403), even for robots.txt",
    "livinginsider.com": "Livinginsider answers 403 to automated reads",
}
_LISTING_OTHER_TOOLS = {"facebook.com", "fb.com", "fb.me", "instagram.com", "t.me", "telegram.me"}
_SECOND_LEVEL = {"co.th", "in.th", "ac.th", "go.th", "or.th", "co.id", "or.id", "web.id", "my.id", "com.tr", "gen.tr",
                 "co.uk", "com.au", "com.ph", "com.my", "com.sg", "com.ge", "com.kz", "org.kz", "co.rs", "org.rs",
                 "in.rs", "com.vn", "co.jp", "com.br", "com.ru"}
LISTING_PTYPES = ("villa", "house", "apartment", "condo", "townhouse", "room")
_LISTING_TYPES = {"RealEstateListing", "Apartment", "House", "SingleFamilyResidence", "Residence", "Accommodation",
                  "Room", "Suite", "HotelRoom", "Product", "Offer"}
_ACCOM_TYPES = {"Apartment", "House", "SingleFamilyResidence", "Residence", "Accommodation", "Room", "Suite", "HotelRoom"}
_CHALLENGE_TITLE = re.compile(r"just a moment|attention required|access denied|captcha|security check|verify you are human|"
                              r"are you a robot|не робот|проверка безопасности", re.I)
_LISTING_LINK_HINT = re.compile(
    r"/(listings?|property|properti|properties|ads?|oglas\w*|a/show|price|realty|real-estate|unit|units|room|rooms|"
    r"villa|villas|condo|apartment|object|obyavlenie|item|detail|rent-\d+)(/|-|_|\.)|[/_-]\d{5,}(/|\.html?|$)|"
    r"/[0-9a-f]{24}(/|$)", re.I)
_CURRENCY_WORDS = [
    (re.compile(r"\bIDR\b|\bRp\b\.?", re.I), "IDR"), (re.compile(r"US\$|\$|\bUSD\b|долл", re.I), "USD"),
    (re.compile(r"€|\bEUR\b|евро|\beuros?\b", re.I), "EUR"), (re.compile(r"₽|\bRUB\b|руб", re.I), "RUB"),
    (re.compile(r"฿|\bTHB\b|บาท|\bbaht\b", re.I), "THB"), (re.compile(r"₸|\bKZT\b|\bтг\b|тенге", re.I), "KZT"),
    (re.compile(r"₺|\bTRY\b|\bTL\b"), "TRY"), (re.compile(r"₾|\bGEL\b|лари", re.I), "GEL"),
    (re.compile(r"\bRSD\b|\bdin\b\.?|динар", re.I), "RSD")]
_PERIOD_WORDS = [
    ("month", re.compile(r"/\s*(month|mo|mon|bulan|bln|мес\w*|mesec\w*|ay)\b|\bper\s*(month|bulan)\b|\bmonthly\b|"
                         r"\bbulanan\b|за\s*месяц|в\s*месяц|ежемесячн\w*|\bmese[čc]no\b|\baylık\b", re.I)),
    ("year", re.compile(r"/\s*(year|yr|tahun|thn|год)\b|\bper\s*(year|tahun|annum)\b|\byearly\b|\bannual\w*\b|"
                        r"\btahunan\b|за\s*год|в\s*год|\bgodi[šs]nje\b|\byıllık\b", re.I)),
    ("week", re.compile(r"/\s*(week|wk|minggu|недел\w*)\b|\bper\s*(week|minggu)\b|\bweekly\b|\bmingguan\b|"
                        r"за\s*неделю|в\s*неделю", re.I)),
    ("day", re.compile(r"/\s*(day|night|hari|malam|сутки|день|ночь)\b|\bper\s*(day|night|hari|malam)\b|\bdaily\b|"
                       r"\bnightly\b|\bharian\b|за\s*(день|сутки|ночь)|в\s*сутки", re.I)),
]
_PRICE_NUM = re.compile(r"(\d[\d   .,]*\d|\d)\s*(juta|jt|miliar|milyar|ribu|rb|млн|тыс\.?|million|mio|k|m|b)?"
                        r"(?![²\w])", re.I)
_MULT = {"juta": 1e6, "jt": 1e6, "млн": 1e6, "million": 1e6, "mio": 1e6, "m": 1e6, "miliar": 1e9, "milyar": 1e9,
         "b": 1e9, "ribu": 1e3, "rb": 1e3, "тыс": 1e3, "тыс.": 1e3, "k": 1e3}
_AREA_IN_TEXT = re.compile(r"(\d+(?:[.,]\d+)?)\s*(?:m²|m2\b|кв\.?\s*м|sq\.?\s*m\b|sqm\b|м²|metara)", re.I)
_BEDS_IN_TEXT = re.compile(r"(\d+)\s*(?:-\s*)?(?:br\b|bed(?:room)?s?\b|спал\w*|kamar tidur|kt\b|bedroom)", re.I)
_PTYPE_WORDS = [("villa", r"villa|вилл"), ("townhouse", r"townhouse|таунхаус"), ("condo", r"condo|кондо"),
                ("room", r"\broom\b|\bkost\b|комнат|\bsoba\b"),
                ("apartment", r"apartment|apartemen|apart|flat|studio|квартир|апартамент|\bstan\b|daire"),
                ("house", r"\bhouse\b|\brumah\b|\bдом\b|\bkuća\b|\bkuca\b|residence")]


def _reg_domain(host: str) -> str:
    """www.dotproperty.co.th → dotproperty.co.th, home.ss.ge → ss.ge (a small public-suffix table, enough for portals)."""
    labels = (host or "").lower().rstrip(".").split(".")
    if len(labels) >= 3 and ".".join(labels[-2:]) in _SECOND_LEVEL:
        return ".".join(labels[-3:])
    return ".".join(labels[-2:])


def blocked_site(host: str) -> str | None:
    """Why a portal is known to refuse automated reads (BLOCKED_SITES), or None."""
    rd = _reg_domain(host)
    return BLOCKED_SITES.get(rd) or BLOCKED_SITES.get(rd.split(".")[0] + ".*")


def _listing_other_tool(host: str) -> bool:
    rd = _reg_domain(host)
    return rd in _LISTING_OTHER_TOOLS or rd.split(".")[0] == "airbnb"


def _amount(num: str, mult: str | None) -> float | None:
    s = re.sub(r"[\s  ]", "", num or "")
    if not s:
        return None
    if re.fullmatch(r"\d{1,3}([.,]\d{3})+", s) and not (mult and re.fullmatch(r"\d+[.,]\d{1,2}", s)):
        s = re.sub(r"[.,]", "", s)
    elif re.fullmatch(r"\d+[.,]\d{1,2}", s):
        s = s.replace(",", ".")
    else:
        s = re.sub(r"[.,]", "", s)
    try:
        v = float(s)
    except ValueError:
        return None
    if mult:
        v *= _MULT.get(mult.lower(), 1)
    return v if math.isfinite(v) and v > 0 else None


def _period_in(text: Any) -> str | None:
    if not isinstance(text, str):
        return None
    hits = [p for p, rx in _PERIOD_WORDS if rx.search(text)]
    return hits[0] if len(hits) == 1 else None


def _currency_in(text: Any) -> str | None:
    if not isinstance(text, str):
        return None
    for rx, code in _CURRENCY_WORDS:
        if rx.search(text):
            return code
    return None


def parse_price_text(text: Any) -> dict:
    """"Rp 185 Juta /tahun" → {amount: 185000000, currency: IDR, period: year}; "$ 1,550 /month", "IDR 80.1M",
    "63 700 ₽", "1 700 евро за месяц". Missing parts stay None; a text with no number gives {}."""
    if not isinstance(text, str) or not text.strip():
        return {}
    t = html.unescape(text).replace(" ", " ")
    m = _PRICE_NUM.search(t)
    if not m:
        return {}
    return {"amount": _amount(m.group(1), m.group(2)), "currency": _currency_in(t), "period": _period_in(t),
            "text": re.sub(r"\s+", " ", t).strip()[:80]}


def _unit_period(unit: Any, value: Any = 1) -> str | None:
    """UN/CEFACT or plain words (+ quantity) → month | year | week | day."""
    if not isinstance(unit, str):
        return None
    u = unit.strip().upper()
    v = _places._num(value) if value is not None else 1.0
    v = 1.0 if v is None else v
    if u in ("MON", "MONTH", "MONTHS", "MONTHLY", "PER MONTH", "BULAN"):
        return "month" if v == 1 else "year" if v == 12 else None
    if u in ("ANN", "YEAR", "YEARS", "YEARLY", "ANNUAL", "PER YEAR", "TAHUN"):
        return "year" if v == 1 else None
    if u in ("WEE", "WEEK", "WEEKS", "WEEKLY", "PER WEEK"):
        return "week" if v == 1 else "month" if v == 4 else None
    if u in ("DAY", "DAYS", "DAILY", "NIGHT", "NIGHTS", "PER DAY", "PER NIGHT"):
        return "day" if v == 1 else "week" if v == 7 else "month" if 28 <= v <= 31 else "year" if v in (360, 365) else None
    return _period_in("/" + unit) if len(unit) < 30 else None


def _ld_period(offer: dict) -> str | None:
    specs = offer.get("priceSpecification")
    specs = specs if isinstance(specs, list) else [specs]
    for s in [offer] + [x for x in specs if isinstance(x, dict)]:
        for k in ("eligibleQuantity", "referenceQuantity", "billingDuration", "eligibleDuration"):
            q = s.get(k)
            if isinstance(q, dict):
                p = _unit_period(q.get("unitCode") or q.get("unitText"), q.get("value"))
                if p:
                    return p
        p = _unit_period(s.get("unitText")) or (_unit_period(s.get("unitCode")) if s is not offer else None)
        if p:
            return p
    return None


def _qv(v: Any) -> tuple[float | None, str | None]:
    """QuantitativeValue / number / "60 m²" → (value, unitCode)."""
    if isinstance(v, list):
        v = v[0] if v else None
    if isinstance(v, dict):
        return _places._num(v.get("value") if v.get("value") is not None else v.get("minValue")), v.get("unitCode") or v.get("unitText")
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return float(v), None
    if isinstance(v, str):
        m = re.search(r"\d+(?:[.,]\d+)?", v)
        return (float(m.group(0).replace(",", ".")), None) if m else (None, None)
    return None, None


def _area_m2(v: Any) -> float | None:
    val, unit = _qv(v)
    if val is None or val <= 0:
        return None
    if isinstance(unit, str) and unit.upper() in ("FTK", "SQFT", "FT2", "SQ FT"):
        return round(val * 0.092903, 1)
    return round(val, 1)


def _int_or_none(v: Any) -> int | None:
    n = _places._num(v.get("value") if isinstance(v, dict) else v)
    return int(n) if n is not None and 0 <= n < 100 and n == int(n) else None


def _rooms(v: Any) -> float | None:
    n = _qv(v)[0]
    return n if n is not None and 0 <= n < 100 else None


def _ptype(types: list[str], *texts: Any) -> str | None:
    if any(t in ("SingleFamilyResidence", "House") for t in types):
        base = "house"
    elif "Apartment" in types:
        base = "apartment"
    elif any(t in ("Room", "HotelRoom") for t in types):
        base = "room"
    else:
        base = None
    blob = " ".join(t for t in texts if isinstance(t, str))[:400]
    for name, rx in _PTYPE_WORDS:
        if re.search(rx, blob, re.I):
            if base and name in ("apartment", "house") and name != base:
                return base
            return name
    return base


def _villa_or(ptype: str | None, title: Any) -> str | None:
    """Indonesian portals file villas under "Rumah" (house): the title says which."""
    return "villa" if ptype == "house" and isinstance(title, str) and re.search(r"villa|вилл", title, re.I) else ptype


def _ts_date(v: Any) -> str | None:
    """Unix seconds/ms or ISO text → ISO (date-time kept as the site gives it)."""
    if isinstance(v, bool) or v is None:
        return None
    if isinstance(v, (int, float)):
        s = float(v) / (1000 if v > 1e11 else 1)
        if 9e8 < s < 4e9:
            return datetime.fromtimestamp(s, tz=ZoneInfo("UTC")).strftime("%Y-%m-%dT%H:%M:%SZ")
        return None
    if isinstance(v, str):
        s = v.strip()
        if s.isdigit():
            return _ts_date(int(s))
        if re.match(r"^\d{4}-\d{2}-\d{2}", s):
            return s[:25]
        m = re.match(r"^(\d{2})[./](\d{2})[./](\d{4})$", s)
        if m:
            return f"{m.group(3)}-{m.group(2)}-{m.group(1)}"
    return None


def _photo_list(base: str, *vals: Any, limit: int = 10) -> list[str]:
    out: list[str] = []

    def add(v: Any) -> None:
        if len(out) >= limit:
            return
        if isinstance(v, list):
            for x in v:
                add(x)
            return
        u = _event_sources._abs_https(base, v)
        if u and u not in out and not re.search(r"\.svg(\?|$)|logo|avatar|placeholder|/icons?/", u, re.I):
            out.append(u)

    for v in vals:
        add(v)
    return out


def _blank_listing(src: str) -> dict:
    return {"from": src, "id": None, "url": None, "title": None, "description": None, "price": None, "currency": None,
            "period": None, "period_source": None, "price_text": None, "price_note": None, "property_type": None,
            "rooms": None, "bedrooms": None, "bathrooms": None, "area_m2": None, "city": None, "district": None,
            "address": None, "lat": None, "lng": None, "photos": [], "posted": None, "updated": None,
            "owner_or_agent": None, "extras": {}}


def _set_geo(li: dict, lat: Any, lng: Any) -> None:
    la, lo = _places._num(lat), _places._num(lng)
    if la is not None and lo is not None and -90 <= la <= 90 and -180 <= lo <= 180 and (la, lo) != (0, 0):
        li["lat"], li["lng"] = round(la, 6), round(lo, 6)


def _set_price(li: dict, amount: Any, currency: Any = None, period: str | None = None, text: Any = None,
               source: str = "page") -> None:
    p = parse_price_text(text) if isinstance(text, str) else {}
    a = _places._num(amount) if amount is not None and not isinstance(amount, bool) else None
    a = a if a is not None and a > 0 else p.get("amount")
    if a is None:
        return
    li["price"] = round(a, 2) if a != int(a) else int(a)
    cur = currency.strip().upper() if isinstance(currency, str) and _events._CURRENCY.match(currency.strip().upper()) else None
    li["currency"] = cur or p.get("currency")
    per = period or p.get("period")
    if per:
        li["period"], li["period_source"] = per, source
    if isinstance(text, str) and text.strip():
        li["price_text"] = re.sub(r"\s+", " ", html.unescape(text)).strip()[:80]


def _text_facts(li: dict, *texts: Any) -> None:
    """Fill area / bedrooms / period / property type from titles and descriptions when the data has none."""
    blob = " ".join(t for t in texts if isinstance(t, str))
    if not blob:
        return
    if li["area_m2"] is None:
        m = _AREA_IN_TEXT.search(blob)
        if m:
            li["area_m2"] = float(m.group(1).replace(",", "."))
    if li["bedrooms"] is None:
        m = _BEDS_IN_TEXT.search(blob)
        if m and int(m.group(1)) < 30:
            li["bedrooms"] = int(m.group(1))
    if li["price"] is not None and li["period"] is None:
        per = _period_in(blob)
        if per:
            li["period"], li["period_source"] = per, "text"
    if li["property_type"] is None:
        li["property_type"] = _ptype([], blob)


def _merge_listing(a: dict, b: dict) -> dict:
    """a wins; b fills a's empty fields (photos and extras are merged)."""
    out = dict(a)
    for k, v in b.items():
        if k in ("from",):
            continue
        if k == "photos":
            out["photos"] = (a.get("photos") or []) + [p for p in (v or []) if p not in (a.get("photos") or [])]
            out["photos"] = out["photos"][:10]
        elif k == "extras":
            out["extras"] = {**(v or {}), **(a.get("extras") or {})}
        elif out.get(k) in (None, "", []) and v not in (None, "", []):
            out[k] = v
    if out.get("price") is not None and a.get("price") is not None and out.get("currency") is None:
        out["currency"] = b.get("currency")
    return out


def _url_key(u: str | None) -> str | None:
    from urllib.parse import urldefrag
    if not u:
        return None
    k = urldefrag(u)[0].rstrip("/")
    return re.sub(r"^https://www\.", "https://", k, flags=re.I).lower()


# ---- generic: schema.org JSON-LD

def _ld_all_nodes(blob: Any, depth: int = 0, out: list | None = None) -> list[dict]:
    out = [] if out is None else out
    if depth > 12 or len(out) > 3000:
        return out
    if isinstance(blob, list):
        for x in blob:
            _ld_all_nodes(x, depth + 1, out)
    elif isinstance(blob, dict):
        out.append(blob)
        for k, v in blob.items():
            if k != "@context" and isinstance(v, (dict, list)):
                _ld_all_nodes(v, depth + 1, out)
    return out


def _ld_listings(blobs: list[Any], base: str) -> list[dict]:
    """Listings from schema.org JSON-LD: RealEstateListing, Apartment / House / SingleFamilyResidence / Residence /
    Accommodation / Room, Product or Offer with a price — in @graph, ItemList elements, or split over several blobs
    joined by @id references (resolved). Nodes of one listing (listing + offer + itemOffered) are merged by URL."""
    from urllib.parse import urldefrag
    nodes = [n for b in blobs for n in _ld_all_nodes(b)]
    idx: dict[str, dict] = {}
    for n in nodes:
        i = n.get("@id")
        if isinstance(i, str) and set(n) - {"@id", "@type", "@context"}:
            idx[i] = {**n, **idx.get(i, {})} if i in idx else n

    def ref(v: Any) -> Any:
        if isinstance(v, list):
            return [ref(x) for x in v]
        if isinstance(v, dict) and isinstance(v.get("@id"), str) and not (set(v) - {"@id", "@type"}):
            return idx.get(v["@id"], v)
        return v

    def key_of(n: dict) -> str | None:
        u = _event_sources._abs_https(base, n.get("url")) if isinstance(n.get("url"), str) else None
        if not u and isinstance(n.get("@id"), str) and n["@id"].startswith("http"):
            u = urldefrag(n["@id"])[0]
        if not u and "Offer" in _event_sources._ld_types(n):
            io = ref(n.get("itemOffered"))
            io = io[0] if isinstance(io, list) and io else io
            if isinstance(io, dict):
                return key_of(io) if io is not n else None
        return _url_key(u)

    groups: dict[str, list[dict]] = {}
    order: list[str] = []
    for n in nodes:
        ts = set(_event_sources._ld_types(n))
        if not ts & _LISTING_TYPES:
            continue
        if ts <= {"Product", "Offer"} and not (n.get("offers") or n.get("price") or n.get("priceSpecification")):
            continue
        k = key_of(n)
        if not k:
            continue
        if k not in groups:
            groups[k], _ = [], order.append(k)
        if n not in groups[k]:
            groups[k].append(n)
    page_key = _url_key(base)
    out = []
    for k in order:
        parts = list(groups[k])
        for n in list(parts):
            for rel in ("itemOffered", "about", "mainEntity", "offers", "containedInPlace", "location", "makesOffer"):
                if rel == "makesOffer":
                    continue  # a page-level node's offers are separate listings
                for r in (ref(n.get(rel)) if isinstance(ref(n.get(rel)), list) else [ref(n.get(rel))]):
                    if isinstance(r, dict) and r not in parts and set(r) - {"@id", "@type"}:
                        parts.append(r)
                        for rel2 in ("itemOffered", "containedInPlace", "geo"):
                            r2 = ref(r.get(rel2))
                            if isinstance(r2, dict) and r2 not in parts and set(r2) - {"@id", "@type"}:
                                parts.append(r2)
        offers = [p for p in parts if "Offer" in _event_sources._ld_types(p) or "AggregateOffer" in _event_sources._ld_types(p)]
        if any("AggregateOffer" in _event_sources._ld_types(o) and _places._num(o.get("offerCount") or 0) and not o.get("price") for o in offers):
            continue  # a search page's summary ("5,349 homes from 12M"), not a listing
        if k == page_key and len(order) > 1:
            continue
        li = _blank_listing("jsonld")
        own = (_event_sources._abs_https(base, p.get("url")) for p in parts if isinstance(p.get("url"), str))
        ids = (p["@id"] for p in parts if str(p.get("@id", "")).startswith("http"))
        li["url"] = next((u for u in own if _url_key(u) == k), None) or urldefrag(next(ids, base))[0]
        head = next((p for p in parts if "RealEstateListing" in _event_sources._ld_types(p)), None) or \
            next((p for p in parts if set(_event_sources._ld_types(p)) & _ACCOM_TYPES), None) or parts[0]
        accom = next((p for p in parts if set(_event_sources._ld_types(p)) & _ACCOM_TYPES), {})
        types = [t for p in parts for t in _event_sources._ld_types(p)]
        li["title"] = _event_sources._text(head.get("name"), 160) or _event_sources._text(accom.get("name"), 160)
        li["description"] = _event_sources._text(head.get("description") or accom.get("description"), 400)
        for o in offers:
            if "AggregateOffer" in _event_sources._ld_types(o):
                continue
            pr = _event_sources._ld_offers(o)
            if pr.get("low") is not None:
                _set_price(li, pr["low"], pr.get("currency"), _ld_period(o))
                break
        rooms = accom.get("numberOfRooms")
        li["rooms"] = _rooms(rooms)
        li["bedrooms"] = _int_or_none(accom.get("numberOfBedrooms") if accom.get("numberOfBedrooms") is not None
                                      else head.get("numberOfBedrooms"))
        li["bathrooms"] = _int_or_none(accom.get("numberOfBathroomsTotal") or accom.get("numberOfFullBathrooms"))
        li["area_m2"] = _area_m2(accom.get("floorSize") or accom.get("area") or head.get("floorSize"))
        for p in parts:
            addr = p.get("address")
            if isinstance(addr, dict):
                bits = [_event_sources._text(addr.get(x), 80) for x in ("streetAddress", "addressLocality", "addressRegion")]
                bits = [b for i, b in enumerate(bits) if b and b not in bits[:i]]
                if bits and not li["address"]:
                    li["address"] = ", ".join(bits)[:200]
                    li["district"] = _event_sources._text(addr.get("addressLocality"), 80)
                    reg = _event_sources._text(addr.get("addressRegion"), 80)
                    li["city"] = reg if reg and reg != li["district"] else None
            geo = ref(p.get("geo"))
            if isinstance(geo, dict) and li["lat"] is None:
                _set_geo(li, geo.get("latitude"), geo.get("longitude"))
        li["photos"] = _photo_list(base, *[ref(p.get("image")) for p in parts if p.get("image")])
        li["posted"] = _ts_date(head.get("datePosted") or head.get("datePublished"))
        li["updated"] = _ts_date(head.get("dateModified"))
        li["property_type"] = _ptype(types, li["title"])
        _text_facts(li, li["title"], li["description"])
        if li["title"] or li["price"] is not None:
            out.append(li)
    return out


# ---- generic: embedded app JSON (Next.js, Nuxt, Redux state, Angular state, React Server Components)

def next_flight(body: str) -> list[Any]:
    """JSON values carried by a Next.js app-router page (self.__next_f.push chunks, rows "id:JSON" / "id:T<len>,JSON")."""
    parts = []
    for m in re.finditer(r'self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)', body):
        with contextlib.suppress(ValueError):
            parts.append(json.loads(m.group(1)))
    if not parts:
        return []
    out: list[Any] = []
    dec = json.JSONDecoder()
    stream = "".join(parts)
    for m in re.finditer(r"(?:^|\n)[0-9a-f]{1,6}:(T[0-9a-f]+,)?(?=[\[{])", stream):
        with contextlib.suppress(ValueError):
            v, _ = dec.raw_decode(stream, m.end())
            out.append(v)
    return out


def app_json_values(body: str) -> list[tuple[str, Any]]:
    """[(kind, value)] for __NEXT_DATA__, window.__INITIAL_STATE__ / __NUXT__ / __PRELOADED_STATE__ /
    __APOLLO_STATE__, Angular ng-state and Next.js flight data (whatever the page carries)."""
    out: list[tuple[str, Any]] = []
    dec = json.JSONDecoder()
    for kind, rx in (("next_data", r'<script[^>]*\bid=["\']__NEXT_DATA__["\'][^>]*>(.*?)</script'),
                     ("ng_state", r'<script[^>]*\bid=["\']ng-state["\'][^>]*>(.*?)</script')):
        m = re.search(rx, body, re.S | re.I)
        if m:
            with contextlib.suppress(ValueError):
                out.append((kind, json.loads(m.group(1))))
    for name in ("__INITIAL_STATE__", "__NUXT__", "__PRELOADED_STATE__", "__APOLLO_STATE__"):
        m = re.search(r"window\." + name + r"\s*=\s*(?=[\[{])", body)
        if m:
            with contextlib.suppress(ValueError):
                out.append((name.strip("_").lower(), dec.raw_decode(body, m.end())[0]))
    out += [("next_flight", v) for v in next_flight(body)]
    return out


def _walk_dicts(v: Any, pred, out: list, depth: int = 0, limit: int = 400) -> list:
    if depth > 40 or len(out) >= limit:
        return out
    if isinstance(v, dict):
        if pred(v):
            out.append(v)
            return out
        for x in v.values():
            _walk_dicts(x, pred, out, depth + 1, limit)
    elif isinstance(v, list):
        for x in v:
            _walk_dicts(x, pred, out, depth + 1, limit)
    return out


def _first(d: dict, *keys: str) -> Any:
    for k in keys:
        v = d.get(k)
        if v not in (None, "", [], {}):
            return v
    return None


_APP_TITLE = ("title", "name", "headline")
_APP_PRICE = ("price", "price_month", "priceMonthly", "monthlyPrice", "rent", "rentPrice", "priceValue", "price_value")
_APP_URL = ("url", "link", "href", "permalink", "slug", "urlPath", "seoUrl", "detailUrl", "path")


def _app_listing_like(d: dict) -> bool:
    return any(k in d for k in _APP_TITLE) and any(k in d for k in _APP_PRICE) and any(k in d for k in _APP_URL)


def _app_norm(d: dict, base: str) -> dict | None:
    li = _blank_listing("app_json")
    li["extras"]["guessed"] = True
    u = _first(d, *_APP_URL)
    li["url"] = _event_sources._abs_https(base, u) if isinstance(u, str) else None
    li["id"] = str(_first(d, "id", "listingId", "listing_id", "propertyId", "adId") or "") or None
    li["title"] = _event_sources._text(_first(d, *_APP_TITLE), 160)
    pr = _first(d, *_APP_PRICE)
    cur = _first(d, "currency", "currencyCode", "currency_code", "display_currency")
    cur = cur.get("code") if isinstance(cur, dict) and isinstance(cur.get("code"), str) else cur
    if isinstance(pr, dict):
        amt = _first(pr, "value", "amount", "price", "offer", "min", "minPrice")
        cur = cur or _first(pr, "currency", "currencyCode")
        _set_price(li, amt if not isinstance(amt, (dict, str)) else None, cur if isinstance(cur, str) else None,
                   text=_first(pr, "display", "formatted", "text") or (amt if isinstance(amt, str) else None))
    else:
        _set_price(li, pr if isinstance(pr, (int, float)) else None, cur if isinstance(cur, str) else None,
                   text=pr if isinstance(pr, str) else None)
    li["bedrooms"] = _int_or_none(_first(d, "bedrooms", "beds", "bedroomCount", "numberOfBedrooms", "bedroom"))
    li["bathrooms"] = _int_or_none(_first(d, "bathrooms", "baths", "bathroomCount", "bathroom"))
    li["area_m2"] = _area_m2(_first(d, "area", "size", "floorSize", "sqm", "m2", "livingArea", "buildingSize"))
    loc = _first(d, "location", "geo", "coordinates", "position")
    if isinstance(loc, dict):
        _set_geo(li, _first(loc, "lat", "latitude"), _first(loc, "lng", "lon", "long", "longitude"))
        txt = _first(loc, "text", "name", "address")
        li["address"] = _event_sources._text(txt, 200) if isinstance(txt, str) else None
    elif isinstance(loc, str):
        li["address"] = _event_sources._text(loc, 200)
    if li["lat"] is None:
        _set_geo(li, _first(d, "lat", "latitude"), _first(d, "lng", "lon", "longitude"))
    li["photos"] = _photo_list(base, _first(d, "photos", "images", "image", "coverPicture", "cover", "thumbnail", "picture"))
    li["posted"] = _ts_date(_first(d, "createdAt", "created_at", "publishedAt", "published_at", "datePosted", "postedAt"))
    li["updated"] = _ts_date(_first(d, "updatedAt", "updated_at", "modifiedAt", "refreshedAt"))
    li["property_type"] = _ptype([], li["title"])
    _text_facts(li, li["title"], _first(d, "description", "shortDescription"))
    return li if li["url"] and li["title"] else None


def _app_listings(values: list[tuple[str, Any]], base: str, limit: int = 200) -> list[dict]:
    out, seen = [], set()
    for _, v in values:
        for d in _walk_dicts(v, _app_listing_like, [], limit=limit):
            li = _app_norm(d, base)
            if li and _url_key(li["url"]) not in seen and _url_key(li["url"]) != _url_key(base):
                seen.add(_url_key(li["url"]))
                out.append(li)
    return out if len(out) >= 2 else []


def _og_listing(metas: dict[str, str], base: str) -> dict | None:
    title = _event_sources._text(metas.get("og:title") or metas.get("twitter:title"), 160)
    if not title:
        return None
    li = _blank_listing("og")
    li["url"] = _event_sources._abs_https(base, metas.get("og:url")) or base
    li["title"] = title
    li["description"] = _event_sources._text(metas.get("og:description") or metas.get("description"), 400)
    li["photos"] = _photo_list(base, metas.get("og:image:secure_url") or metas.get("og:image") or metas.get("twitter:image"))
    amt = metas.get("product:price:amount") or metas.get("og:price:amount")
    if amt:
        _set_price(li, _event_sources._num_price(amt), metas.get("product:price:currency") or metas.get("og:price:currency"))
    if li["price"] is None:
        p = parse_price_text(title) if _currency_in(title) else {}
        if p.get("amount") and p.get("currency"):
            _set_price(li, p["amount"], p["currency"], p.get("period"), source="text")
    _set_geo(li, metas.get("place:location:latitude") or metas.get("geo.position", ";").split(";")[0],
             metas.get("place:location:longitude") or (metas.get("geo.position", ";").split(";") + [None])[1])
    li["property_type"] = _ptype([], title)
    _text_facts(li, title, li["description"])
    return li


def _listing_links(html_text: str, base: str, limit: int = 40) -> list[dict]:
    """Candidate listing pages linked from a search page, same site only (no crawling: you open the ones you need)."""
    from urllib.parse import urldefrag, urljoin
    site = _reg_domain(urlparse(base).hostname or "")
    seen, out = {_url_key(base)}, []
    for attrs, inner in _event_sources._A_TAG.findall(html_text[:3_000_000]):
        a = {k.lower(): v.strip("\"'") for k, v in _event_photos._ATTR.findall(attrs)}
        href = html.unescape(a.get("href") or "").strip()
        if not href or href.startswith(("#", "mailto:", "tel:", "javascript:")):
            continue
        u = urldefrag(urljoin(base, href))[0]
        p = urlparse(u)
        if p.scheme != "https" or _reg_domain(p.hostname or "") != site or not _LISTING_LINK_HINT.search(p.path or ""):
            continue
        if _url_key(u) in seen:
            continue
        seen.add(_url_key(u))
        out.append({"url": u, "text": _event_sources._text(inner, 120)})
        if len(out) >= limit:
            break
    return out


def _next_link(html_text: str, base: str) -> str | None:
    from urllib.parse import urljoin
    for tag in re.findall(r"<(?:link|a)\b[^>]*\brel=[\"']?next[\"']?[^>]*>", html_text[:3_000_000], re.I):
        a = {k.lower(): v.strip("\"'") for k, v in _event_photos._ATTR.findall(tag)}
        if a.get("href"):
            u = urljoin(base, html.unescape(a["href"]))
            if _events._HTTPS.match(u) and _reg_domain(urlparse(u).hostname or "") == _reg_domain(urlparse(base).hostname or ""):
                return u
    return None


def _next_by_param(html_text: str, base: str, param: str) -> str | None:
    """The page's own link to page N+1 (?strana=2, ?page=3): only a link that is on the page, never an invented one."""
    from urllib.parse import urljoin
    cur = parse_qs(urlparse(base).query).get(param, ["1"])[0]
    try:
        nxt = int(cur) + 1
    except ValueError:
        return None
    for href in re.findall(r'href="([^"]*[?&](?:amp;)?' + re.escape(param) + r'=' + str(nxt) + r'(?:[&#][^"]*)?)"', html_text):
        u = urljoin(base, html.unescape(href))
        if _events._HTTPS.match(u):
            return u
    return None


# ---- per-portal adapters: (body, base) → {"listings": [...], "next_url"?}

def _ad_4zida(body: str, base: str) -> dict:
    """4zida.rs (Serbia): JSON-LD on list and listing pages (generic, merged in) + the Next.js flight data with the
    ad records: places, payment term, created/renewed dates, owner (advertiserType 4 = "Vlasnik") or agency (1)."""
    recs = []
    for v in next_flight(body):
        _walk_dicts(v, lambda d: {"id", "price"} <= set(d) and ("urlPath" in d or "advertiserType" in d)
                    and isinstance(d.get("urlPath") or d.get("url"), str) and d.get("for") in ("rent", "sale", None), recs)
    out, seen = [], set()
    for r in recs:
        if str(r["id"]) in seen:
            continue
        seen.add(str(r["id"]))
        li = _blank_listing("adapter")
        li["id"] = str(r["id"])
        li["url"] = _event_sources._abs_https(base, r.get("urlPath") or r.get("url"))
        label = _event_sources._text(r.get("structureLabel") or r.get("structureName"), 60)
        li["title"] = " · ".join(x for x in (label, _event_sources._text(r.get("title"), 100)) if x) or None
        per = {"month": "month", "year": "year", "day": "day", "week": "week"}.get(str(r.get("paymentTerm") or ""))
        _set_price(li, r.get("price"), None, per or "month", source="page" if per else "site_convention")
        li["rooms"] = _rooms(r.get("roomCount"))
        li["area_m2"] = _area_m2(r.get("m2"))
        places = [p for p in (r.get("placeTitles") or []) if isinstance(p, str)] or \
            [p.get("title") for p in (r.get("placeIdsAndTitles") or []) if isinstance(p, dict) and isinstance(p.get("title"), str)]
        if places:
            li["district"] = places[0] if len(places) > 1 else None
            li["city"] = places[-1]
            li["address"] = ", ".join(places)[:200]
        li["posted"] = _ts_date(r.get("createdAt"))
        li["updated"] = _ts_date(r.get("lastActivatedAt") or r.get("refreshedAt"))
        li["owner_or_agent"] = {4: "owner", 1: "agent"}.get(r.get("advertiserType"))
        t = r.get("type")
        li["property_type"] = {"apartment": "apartment", "house": "house", "room": "room"}.get(t) or _ptype([], label)
        photos = []
        for th in ([r.get("image")] + list(r.get("thumbnails") or [])):
            if isinstance(th, dict) and isinstance(th.get("search"), dict):
                s = th["search"]
                photos.append(next((s[k] for k in s if "840" in k and k.endswith("jpeg")), None) or next(iter(s.values()), None))
        li["photos"] = _photo_list(base, photos)
        ex = {"deposit": r.get("deposit"), "furnished": r.get("furnished"), "pets_allowed": r.get("petsAllowed"),
              "available_from": (_ts_date(r.get("inhabitableFrom")) or "")[:10] or None}
        li["extras"] = {k: v for k, v in ex.items() if v not in (None, "")}
        if li["url"]:
            out.append(li)
    return {"listings": out, "next_url": _next_by_param(body, base, "strana")}


def _ad_rumah123(body: str, base: str) -> dict:
    """Rumah123 (Indonesia): the Next.js flight data of a search page (20 ads with price + display text "/tahun" or
    "/bulan", rooms, sizes, district, photos, posted/updated, the agent's isHomeOwner flag). JSON-LD covers 9 of them."""
    recs = []
    for v in next_flight(body):
        _walk_dicts(v, lambda d: "originId" in d and isinstance(d.get("price"), dict) and "title" in d and
                    ("slug" in d or "url" in d) and ("attributes" in d or "medias" in d), recs)
    out, seen = [], set()
    for r in recs:
        oid = r.get("originId")
        oid = oid.get("formattedValue") if isinstance(oid, dict) else oid
        if not oid or oid in seen:
            continue
        seen.add(oid)
        li = _blank_listing("adapter")
        li["id"] = str(oid)
        li["url"] = _event_sources._abs_https(base, r.get("slug") or r.get("url"))
        li["title"] = _event_sources._text(r.get("title"), 160)
        li["description"] = _event_sources._text(r.get("shortDescription"), 400)
        pr = r.get("price") if isinstance(r.get("price"), dict) else {}
        disp = pr.get("display")
        _set_price(li, pr.get("offer"), "IDR" if isinstance(disp, str) and re.match(r"\s*Rp", disp) else None, text=disp)
        at = r.get("attributes") if isinstance(r.get("attributes"), dict) else {}
        val = lambda k: (at.get(k) or {}).get("value") if isinstance(at.get(k), dict) else None  # noqa: E731, B023 (used in this iteration)
        li["bedrooms"] = _int_or_none(val("bedrooms"))
        li["bathrooms"] = _int_or_none(val("bathrooms"))
        li["area_m2"] = _area_m2(val("buildingSize"))
        pt = (r.get("propertyType") or {}).get("formattedValue") if isinstance(r.get("propertyType"), dict) else None
        li["property_type"] = _villa_or({"rumah": "house", "apartemen": "apartment", "villa": "villa", "kost": "room",
                                         "kamar": "room"}.get(str(pt or "").lower()) or _ptype([], li["title"]), li["title"])
        loc = r.get("location") if isinstance(r.get("location"), dict) else {}
        li["address"] = _event_sources._text(loc.get("text"), 200)
        li["district"] = _event_sources._text((loc.get("district") or {}).get("name"), 80) if isinstance(loc.get("district"), dict) else None
        li["city"] = _event_sources._text((loc.get("city") or {}).get("name"), 80) if isinstance(loc.get("city"), dict) else None
        pin = r.get("locationPin")
        if isinstance(pin, dict):
            _set_geo(li, _first(pin, "lat", "latitude"), _first(pin, "lng", "lon", "longitude"))
        li["photos"] = _photo_list(base, [mi.get("mediaUrl") for m in (r.get("medias") or []) if isinstance(m, dict)
                                          for mi in (m.get("mediaInfo") or []) if isinstance(mi, dict)])
        tm = r.get("time") if isinstance(r.get("time"), dict) else {}
        li["posted"], li["updated"] = _ts_date(tm.get("posted")), _ts_date(tm.get("updated"))
        ag = r.get("agent") if isinstance(r.get("agent"), dict) else None
        if ag is not None:
            home = (ag.get("attributes") or {}).get("isHomeOwner") if isinstance(ag.get("attributes"), dict) else None
            li["owner_or_agent"] = "owner" if home is True else "agent" if home is False else None
        if val("furnishing"):
            li["extras"]["furnished"] = val("furnishing")
        if li["url"]:
            out.append(li)
    return {"listings": out, "next_url": _next_link(body, base) or _next_by_param(body, base, "page")}


def _ad_99co(body: str, base: str) -> dict:
    """99.co Indonesia: __NEXT_DATA__ listings (price + rent_type yearly / monthly, rent_prices when the ad has them,
    rooms, sizes, map pin, photos, published/updated, the is_owner flag)."""
    from urllib.parse import urljoin
    recs = []
    for _, v in app_json_values(body):
        _walk_dicts(v, lambda d: "business_id" in d and "price" in d and "url" in d, recs)
    out, seen = [], set()
    for r in recs:
        bid = str(r.get("business_id") or "")
        if not bid or bid in seen:
            continue
        seen.add(bid)
        li = _blank_listing("adapter")
        li["id"] = bid
        u = r.get("url")
        li["url"] = _event_sources._abs_https(base, u if str(u).startswith(("/", "http")) else urljoin("https://www.99.co/id/properti/", str(u)))
        li["title"] = _event_sources._text(r.get("title"), 160)
        pr = r.get("price") if isinstance(r.get("price"), dict) else {}
        rp = pr.get("rent_prices") if isinstance(pr.get("rent_prices"), dict) else {}
        cur = "IDR" if ((pr.get("currency") or {}).get("symbol") if isinstance(pr.get("currency"), dict) else "") == "Rp" else None
        per_map = {"monthly": "month", "yearly": "year", "daily": "day", "weekly": "week"}
        picked = next(((k, rp[k]) for k in ("monthly", "yearly", "weekly", "daily") if _places._num(rp.get(k))), None)
        if picked:
            _set_price(li, rp[picked[0]], cur, per_map[picked[0]])
        else:
            rt = (r.get("rent_type") or {}).get("value") if isinstance(r.get("rent_type"), dict) else None
            _set_price(li, pr.get("price"), cur, per_map.get(str(rt)), text=pr.get("price_tag"))
        at = r.get("attributes") if isinstance(r.get("attributes"), dict) else {}
        li["bedrooms"], li["bathrooms"] = _int_or_none(at.get("bedrooms")), _int_or_none(at.get("bathrooms"))
        li["area_m2"] = _area_m2((at.get("builtup_area") or {}).get("value") if isinstance(at.get("builtup_area"), dict) else None)
        pt = (at.get("property_type") or {}).get("value") if isinstance(at.get("property_type"), dict) else None
        li["property_type"] = _villa_or({"rumah": "house", "apartemen": "apartment", "villa": "villa", "kost": "room"}.get(
            str(pt or "").lower()) or _ptype([], li["title"]), li["title"])
        pin = r.get("location_pin") if isinstance(r.get("location_pin"), dict) else {}
        _set_geo(li, pin.get("lat"), pin.get("long") if pin.get("long") is not None else pin.get("lng"))
        loc = r.get("location") if isinstance(r.get("location"), dict) else {}
        name = lambda k: _event_sources._text((loc.get(k) or {}).get("name"), 80) if isinstance(loc.get(k), dict) else None  # noqa: E731, B023 (used in this iteration)
        li["city"], li["district"] = name("city"), name("district")
        li["address"] = _event_sources._text(r.get("full_address"), 200)
        li["photos"] = _photo_list(base, [mi.get("url") for m in (r.get("media") or []) if isinstance(m, dict)
                                          for mi in (m.get("media_info") or []) if isinstance(mi, dict)])
        ts = r.get("timestamps") if isinstance(r.get("timestamps"), dict) else {}
        li["posted"], li["updated"] = _ts_date(ts.get("published") or None), _ts_date(ts.get("updated") or None)
        own = (r.get("flags") or {}).get("is_owner") if isinstance(r.get("flags"), dict) else None
        li["owner_or_agent"] = "owner" if own is True else "agent" if own is False else None
        if li["url"]:
            out.append(li)
    return {"listings": out, "next_url": _next_link(body, base)}


def _ad_travelio(body: str, base: str) -> dict:
    """Travelio (Indonesia, managed villas and apartments): server-rendered cards with map pin, photos, type, bedrooms,
    bathrooms, size and up to three prices (Harian / Bulanan / Tahunan = day / month / year)."""
    out = []
    per_words = {"harian": "day", "daily": "day", "bulanan": "month", "monthly": "month", "tahunan": "year", "yearly": "year",
                 "mingguan": "week", "weekly": "week"}
    for m in re.finditer(r'<div\b[^>]*class="property-outer-box[^"]*"[^>]*>', body):
        tag = m.group(0)
        end = body.find('class="property-outer-box', m.end())
        card = body[m.end(): end if end > 0 else m.end() + 20000]
        a = dict((k.lower(), v.strip("\"'")) for k, v in _event_photos._ATTR.findall(tag))
        href = re.search(r'<a\b[^>]*href="([^"]+/property/[^"]+)"', card)
        if not href:
            continue
        li = _blank_listing("adapter")
        u = _event_sources._abs_https(base, html.unescape(href.group(1)))
        li["url"] = u.split("?")[0] if u else None
        code = re.search(r"_([0-9A-Z]{6,})(?:\?|$)", href.group(1))
        li["id"] = code.group(1) if code else (re.search(r'id="([0-9a-f]{24})"', tag) or [None, None])[1]
        name = re.search(r'class="property-name-label"[^>]*>(.*?)</div>', card, re.S)
        li["title"] = _event_sources._text(name.group(1), 160) if name else None
        _set_geo(li, a.get("data-lat"), a.get("data-lon"))
        with contextlib.suppress(ValueError, TypeError):
            li["photos"] = _photo_list(base, json.loads(html.unescape(a.get("data-images") or "[]")))
        icons = re.findall(r'<span class="property-small-icon"[^>]*>\s*<img[^>]*src="[^"]*/([a-z-]+)\.png[^"]*"[^>]*>\s*([^<]*)', card)
        for icon, val in icons:
            val = val.strip()
            if "bedroom" in icon:
                li["bedrooms"] = _int_or_none(val)
            elif "bathroom" in icon:
                li["bathrooms"] = _int_or_none(val)
            elif "sqm" in icon:
                li["area_m2"] = _area_m2(val)
            elif val and li["property_type"] is None:
                li["property_type"] = _ptype([], val)
        prices = {}
        for dur, val in re.findall(r'class="price-duration-type[^"]*"[^>]*>\s*([^<]+?)\s*</div>\s*'
                                   r'<div class="price"[^>]*>\s*([^<]*?)\s*</div>', card):
            per = per_words.get(dur.strip().lower())
            p = parse_price_text(val)
            if per and p.get("amount"):
                prices[per] = (p["amount"], p.get("currency"), val)
        for per in ("month", "year", "week", "day"):
            if per in prices:
                _set_price(li, prices[per][0], prices[per][1], per, text=prices[per][2])
                break
        if len(prices) > 1:
            li["extras"]["prices"] = {k: v[0] for k, v in prices.items()}
        li["extras"]["operator"] = "managed by the site"
        if li["property_type"] is None:
            li["property_type"] = _ptype([], li["title"])
        out.append(li)
    return {"listings": out, "next_url": _next_link(body, base)}


def _ad_cityexpert(body: str, base: str) -> dict:
    """City Expert (Serbia, agency base): the Angular state of a search page (map pin, street, municipality, size,
    structure = rooms, price in euros, first published, available from), card links and cover photos from the HTML."""
    recs = []
    for kind, v in app_json_values(body):
        if kind == "ng_state":
            _walk_dicts(v, lambda d: "propId" in d and "price" in d and ("street" in d or "municipality" in d), recs)
    hrefs = {}
    for h in re.findall(r'href="(https://cityexpert\.rs/[a-z-]+/[a-z-]+/(\d+)/[^"]+)"', body):
        hrefs.setdefault(h[1], h[0])
    out, seen = [], set()
    for r in recs:
        pid = str(r.get("propId"))
        if pid in seen or pid not in hrefs:
            continue
        seen.add(pid)
        li = _blank_listing("adapter")
        li["id"], li["url"] = pid, hrefs[pid]
        li["title"] = ", ".join(x for x in (_event_sources._text(r.get("street"), 80), _event_sources._text(r.get("municipality"), 80)) if x) or None
        rent = r.get("rentOrSale") == "r"
        # City Expert lists rents in euros per month (its cards show "750 €" with no unit)
        _set_price(li, r.get("price"), "EUR", "month" if rent else None, source="site_convention")
        li["area_m2"] = _area_m2(r.get("size"))
        li["rooms"] = _rooms(r.get("structure"))
        beds = [b for b in (r.get("bedroomsArray") or []) if isinstance(b, str) and re.fullmatch(r"r\d", b)]
        li["bedrooms"] = int(beds[0][1:]) if beds else None
        li["district"], li["city"] = _event_sources._text(r.get("municipality"), 80), None
        li["address"] = li["title"]
        loc = r.get("location")
        if isinstance(loc, str) and "," in loc:
            _set_geo(li, *loc.split(",", 1))
        cover = r.get("coverPhoto")
        if isinstance(cover, str) and cover:
            src = re.search(r'(https://[^"\s,]+/' + re.escape(cover) + r')', body)
            li["photos"] = _photo_list(base, src.group(1) if src else None)
        li["posted"] = _ts_date(r.get("firstPublished"))
        li["owner_or_agent"] = "agent"
        li["property_type"] = {1: "apartment", 2: "house"}.get(r.get("ptId"))
        ex = {"available_from": (_ts_date(r.get("availableFrom")) or "")[:10] or None,
              "furnished": {1: "yes", 2: "semi", 3: "no"}.get(r.get("furnished")),
              "min_lease_months": (r.get("minLeaseArray") or [None])[0]}
        li["extras"] = {k: v for k, v in ex.items() if v not in (None, "")}
        out.append(li)
    return {"listings": out, "next_url": _next_link(body, base)}


_FA_BED = "M32 32c17.7 0 32 14.3 32 32V320H288"
_FA_BATH = "M96 77.3c0-7.3"


def _ad_rentor(body: str, base: str) -> dict:
    """Rentor.ge (Tbilisi, one agency): WordPress cards with name, district, "$ 1,550 /month", bedroom / bathroom /
    size icons and lazy photos. Every ad is the agency's."""
    out = []
    chunks = re.split(r'<a\s+class="myhome-listing-card"', body)
    for c in chunks[1:]:
        c = c[: c.find("</a>")] if "</a>" in c else c[:30000]
        href = re.search(r'href="([^"]+)"', c)
        if not href:
            continue
        li = _blank_listing("adapter")
        li["url"] = _event_sources._abs_https(base, href.group(1))
        num = re.search(r"-(\d+)/?$", href.group(1))
        li["id"] = num.group(1) if num else None
        name = re.search(r'myhome-listing-card__name[^"]*"[^>]*>(.*?)</span>', c, re.S)
        li["title"] = _event_sources._text(name.group(1), 160) if name else None
        addr = re.search(r'attribute--address.*?__value"[^>]*>(.*?)</span>', c, re.S)
        li["district"] = _event_sources._text(addr.group(1), 80) if addr else None
        li["address"] = li["district"]
        val = re.search(r'myhome-listing-card__value[^"]*"[^>]*>(.*?)</div>', c, re.S)
        if val:
            _set_price(li, None, None, text=_event_sources._text(val.group(1), 80))
        for a in re.findall(r'<div class="myhome-attribute"[^>]*>(.*?)</div>', c, re.S):
            v = re.search(r'__value"[^>]*>(.*?)</span>', a, re.S)
            v = _event_sources._text(v.group(1), 40) if v else None
            if not v:
                continue
            if re.search(r"m²|m2|sq", v):
                li["area_m2"] = _area_m2(v)
            elif _FA_BED in a:
                li["bedrooms"] = _int_or_none(v)
            elif _FA_BATH in a:
                li["bathrooms"] = _int_or_none(v)
        li["photos"] = _photo_list(base, re.findall(r'<div class="myhome-swiper-slide">\s*<img[^>]*data-src="([^"]+)"', c))
        slug = urlparse(li["url"] or "").path
        li["property_type"] = ("apartment" if "/apartment-" in slug else "house" if "/house-" in slug else
                               None if "/commercial-" in slug else _ptype([], li["title"]))
        if "/commercial-" in slug:
            li["extras"]["commercial"] = True
        li["owner_or_agent"] = "agent"
        _text_facts(li, li["title"])
        out.append(li)
    return {"listings": out, "next_url": _next_link(body, base)}


def _ad_balihousing(body: str, base: str) -> dict:
    """BaliHousing / Baliarenda (one platform): window.__INITIAL_STATE__ ads with title, place, the site's monthly
    figure (price_month, may be calculated from a yearly or daily price, in the display currency), photos, the date the
    ad was last confirmed and a verified flag. Contacts open only after sign-up: the hunter does that, never the agent."""
    recs = []
    for kind, v in app_json_values(body):
        if kind == "initial_state":
            _walk_dicts(v, lambda d: {"id", "url", "title"} <= set(d) and ("price_month" in d or "price" in d), recs)
    out, seen = [], set()
    for r in recs:
        if r["id"] in seen:
            continue
        seen.add(r["id"])
        li = _blank_listing("adapter")
        li["id"] = str(r["id"])
        rel = str(r.get("url") or "")
        hm = re.search(r'href="([^"]*' + re.escape(rel) + r')"', body) if rel else None
        li["url"] = _event_sources._abs_https(base, hm.group(1) if hm else rel)
        li["title"] = _event_sources._text(r.get("title"), 160)
        loc = _event_sources._text(r.get("location"), 120)
        li["address"] = loc
        if loc:
            bits = [b.strip() for b in loc.split(",") if b.strip()]
            li["district"], li["city"] = bits[-1], (bits[0] if len(bits) > 1 else None)
        disp = r.get("price_month") if isinstance(r.get("price_month"), str) else None
        p = parse_price_text(disp)
        cur = r.get("display_currency") if isinstance(r.get("display_currency"), str) else p.get("currency")
        if p.get("amount"):
            _set_price(li, p["amount"], cur, "month", text=disp)
            notes = []
            calc = isinstance(r.get("price_calculated"), dict) and r["price_calculated"].get("month")
            src = r.get("price_source_period")
            if calc and src in ("day", "year", "week"):
                notes.append(f"the site's monthly figure, calculated from a per-{src} price")
            if not r.get("prices_idr_only") and cur != "IDR":
                notes.append(f"shown in {cur} by the site's converter")
            if notes:
                li["price_note"] = "; ".join(notes) + "; open the ad for the owner's own price"
            if src in ("day", "year", "week", "month"):
                li["extras"]["owner_price_period"] = src
        li["photos"] = _photo_list(base, [ph.get("url") for ph in (r.get("photos") or []) if isinstance(ph, dict)])
        li["updated"] = _ts_date(r.get("date_actual"))
        li["extras"]["verified"] = bool(r.get("verified"))
        li["property_type"] = _ptype([], li["title"])
        _text_facts(li, li["title"])
        if li["url"]:
            out.append(li)
    return {"listings": out, "next_url": _next_link(body, base)}


def _ad_renthub(body: str, base: str) -> dict:
    """RentHub (Thailand, apartment buildings with monthly contracts): __NEXT_DATA__ buildings with monthly and daily
    price ranges in baht, province / district / subdistrict, cover picture, created / refreshed dates."""
    recs = []
    for kind, v in app_json_values(body):
        if kind == "next_data":
            _walk_dicts(v, lambda d: "slug" in d and isinstance(d.get("price"), dict) and "id" in d and
                        ("monthly" in d["price"] or "daily" in d["price"]), recs)
    lang = "/en/" if urlparse(base).path.startswith("/en") else "/"
    out, seen = [], set()
    for r in recs:
        if r["id"] in seen:
            continue
        seen.add(r["id"])
        li = _blank_listing("adapter")
        li["id"] = str(r["id"])
        li["url"] = _event_sources._abs_https(base, lang + str(r["slug"]).lstrip("/"))
        li["title"] = _event_sources._text(r.get("name") or r.get("title"), 160)
        mo = r["price"].get("monthly") if isinstance(r["price"].get("monthly"), dict) else {}
        dy = r["price"].get("daily") if isinstance(r["price"].get("daily"), dict) else {}
        lo, hi = _places._num(mo.get("minPrice")), _places._num(mo.get("maxPrice"))
        if lo:
            _set_price(li, lo, "THB", "month")  # RentHub shows baht
            if hi and hi != lo:
                li["price_note"] = f"{lo:,.0f}–{hi:,.0f} THB per month, by room type"
        elif _places._num(dy.get("minPrice")):
            _set_price(li, dy["minPrice"], "THB", "day")
        if _places._num(dy.get("minPrice")):
            li["extras"]["daily_from"] = _places._num(dy.get("minPrice"))
        bits = [_event_sources._text(r.get(k), 60) for k in ("subdistrict", "district", "province")]
        li["address"] = ", ".join(b for b in bits if b) or None
        li["district"], li["city"] = bits[1], bits[2]
        cover = r.get("coverPicture")
        if isinstance(cover, str) and cover.startswith("/"):
            cover = "https://bcdn.renthub.in.th" + cover  # the picture host the page itself uses
        li["photos"] = _photo_list(base, cover)
        li["posted"] = _ts_date(r.get("createdAt"))
        li["updated"] = _ts_date(r.get("refreshedAt") or r.get("updatedAt"))
        li["property_type"] = "apartment"
        if li["url"]:
            out.append(li)
    return {"listings": out, "next_url": _next_link(body, base)}


# registrable domain → adapter. Portals not listed here go through the generic reader (JSON-LD → app JSON → og: tags);
# dotproperty.co.th / dotproperty.id and prian.ru publish complete JSON-LD and need nothing more.
LISTING_ADAPTERS = {
    "4zida.rs": _ad_4zida,
    "rumah123.com": _ad_rumah123,
    "99.co": _ad_99co,
    "travelio.com": _ad_travelio,
    "cityexpert.rs": _ad_cityexpert,
    "rentor.ge": _ad_rentor,
    "balihousing.com": _ad_balihousing,
    "baliarenda.com": _ad_balihousing,
    "renthub.in.th": _ad_renthub,
}


def extract_page_listings(body: str, ctype: str, base: str) -> dict:
    """Pure part of listing_source_read: {read, adapter?, site_name, listings, next_url?, links} from a fetched page.
    read = adapter | jsonld | app_json | og | list | none. The site's adapter (LISTING_ADAPTERS) goes first and the
    generic JSON-LD fills its gaps (merged by URL); without an adapter: JSON-LD, then embedded app JSON, then og: tags
    for a single listing; `links` = same-site listing pages when nothing structured was found."""
    host = (urlparse(base).hostname or "").lower()
    rd = _reg_domain(host)
    metas = _event_sources._metas(body)
    site_name = _event_sources._text(metas.get("og:site_name") or metas.get("application-name"), 140) or rd or None
    blobs: list[Any] = []
    if ctype in ("application/ld+json", "application/json"):
        with contextlib.suppress(ValueError):
            blobs = [json.loads(body)]
    ld = _ld_listings(blobs or _event_sources._ld_blobs(body), base)
    adapter = LISTING_ADAPTERS.get(rd)
    ad: dict = {}
    if adapter:
        try:
            ad = adapter(body, base) or {}
        except Exception as e:  # a changed page must not break the generic reader
            logging.getLogger("hunt").warning("listing adapter %s failed: %s", rd, e)
            ad = {}
    listings: list[dict] = []
    read = "none"
    if ad.get("listings"):
        by_key = {_url_key(x["url"]): x for x in ld if x.get("url")}
        for li in ad["listings"]:
            k = _url_key(li.get("url"))
            listings.append(_merge_listing(li, by_key.pop(k)) if k in by_key else li)
        listings += [x for x in ld if _url_key(x.get("url")) in by_key]
        read = "adapter"
    elif ld:
        listings, read = ld, "jsonld"
    else:
        app = _app_listings(app_json_values(body), base)
        if app:
            listings, read = app, "app_json"
    for li in listings:
        if li["from"] == "adapter":
            li["from"] = "adapter:" + rd
    links = [] if listings else (_listing_links(body, base) if "<a" in body[:3_000_000].lower() else [])
    if not listings:
        og = _og_listing(metas, base)
        path = urlparse(base).path or "/"
        listingish = bool(og) and (og["price"] is not None or (metas.get("og:type") or "").lower() in ("product", "place")
                                   or (bool(_LISTING_LINK_HINT.search(path)) and len(links) < 3))
        if og and listingish:
            og["single_page_guess"] = og["price"] is None  # og tags of a page that may not be one listing
            listings, read = [og], "og"
        elif links:
            read = "list"
    out = {"read": read, "site_name": site_name, "listings": listings, "links": links}
    if read == "adapter":
        out["adapter"] = rd
    nxt = ad.get("next_url") or _next_link(body, base)
    if nxt and _url_key(nxt) != _url_key(base):
        out["next_url"] = nxt
    return out


def _listing_slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def _listing_suggest(li: dict, site_name: str | None, page: str) -> tuple[dict, list[str]]:
    """listing_upsert fields we can fill from the page, and what you still add yourself."""
    import hashlib
    host = urlparse(li.get("url") or page).hostname or ""
    brand = _listing_slug(_reg_domain(host).split(".")[0]) or "web"
    raw_id = li.get("id")
    if not raw_id and li.get("url"):
        last = re.sub(r"\.html?$", "", urlparse(li["url"]).path.rstrip("/").rsplit("/", 1)[-1])
        m = re.search(r"([0-9a-f]{24}|[a-z]{0,4}\d{4,})$", last, re.I)
        raw_id = (last.rsplit("_", 1)[1] if "_" in last and len(last.rsplit("_", 1)[1]) >= 4 else
                  m.group(1) if m else hashlib.sha1(_url_key(li["url"]).encode()).hexdigest()[:10])
    s: dict[str, Any] = {"listing_id": f"{brand}-{_listing_slug(str(raw_id or 'page'))}"[:80],
                         "source": (site_name or _reg_domain(host))[:80], "source_url": li.get("url") or page}
    missing: list[str] = []
    if li.get("title"):
        s["title"] = li["title"][:140]
    else:
        missing.append("title")
    area = li.get("address") or ", ".join(x for x in (li.get("district"), li.get("city")) if x)
    if area:
        s["area_text"] = area[:200]
    if li.get("lat") is not None:
        s["lat"], s["lng"] = li["lat"], li["lng"]
    if li.get("property_type") in LISTING_PTYPES:
        s["property_type"] = li["property_type"]
    for k in ("bedrooms", "bathrooms"):
        if isinstance(li.get(k), int):
            s[k] = li[k]
    if li.get("area_m2"):
        s["size_m2"] = li["area_m2"]
    pr, cur, per = li.get("price"), li.get("currency"), li.get("period")
    if pr is not None and cur and per == "month":
        s["price"], s["currency"] = int(round(pr)), cur
        notes = []
        if li.get("period_source") == "site_convention":
            notes.append("per month: the site's convention, the ad does not say it")
        elif li.get("period_source") == "text":
            notes.append("per month, read from the ad's text")
        if li.get("price_note"):
            notes.append(li["price_note"])
        if notes:
            s["price_note"] = "; ".join(notes)[:200]
    elif pr is not None:
        amount = f"{pr:,.0f}".replace(",", " ")
        s["price_note"] = (f"{amount} {cur or '(currency not stated)'} " + (f"per {per}" if per else "(period not stated)"))[:200]
        if li.get("price_note"):
            s["price_note"] = (s["price_note"] + "; " + li["price_note"])[:200]
        missing.append("price per month (the page gives " + (f"a per-{per} price" if per else "no period") +
                       ("" if cur else " and no currency") + ": ask, or divide and say so in price_note)")
    else:
        missing.append("price")
    if (li.get("extras") or {}).get("available_from"):
        s["available"] = li["extras"]["available_from"]
    hint = li.get("district") or li.get("city") or li.get("address")
    missing.insert(0, "district (the pack's slug: region_get → districts" + (f"; the page says {hint!r})" if hint else ")"))
    if not li.get("photos"):
        missing.append("photos (open the ad)")
    missing.append("summary (your own 1–3 lines)")
    return s, missing


def _challenge_page(body: str) -> bool:
    head = body[:400_000]
    t = _event_sources._TITLE_TAG.search(head)
    title = html.unescape(t.group(1)) if t else ""
    return bool(_CHALLENGE_TITLE.search(title)) or "/.safeline/" in head or "captcha-delivery.com" in head


@_base.mcp.tool()
async def listing_source_read(url: str, max_listings: int = 30) -> dict:
    """Read ONE rental-portal page READ-ONLY — a search-results list or a single listing — and return normalized
    listings ready for listing_upsert. Use it on a portal's search URL from the region pack's sources.yaml (portals:)
    first, then open only the listings you will add. One page per call; never crawl (follow `next_url` only when you
    really need the next page).

    How it reads: the site's own adapter when there is one (4zida.rs, rumah123.com, 99.co, travelio.com,
    cityexpert.rs, rentor.ge, balihousing.com, baliarenda.com, renthub.in.th: `read` = "adapter"), merged with schema.org
    JSON-LD; otherwise JSON-LD (RealEstateListing, Apartment, House, SingleFamilyResidence, Residence, Accommodation,
    Product / Offer with a price, ItemList of those, @graph and @id references resolved: "jsonld"), then the page's
    embedded app data (__NEXT_DATA__, window.__INITIAL_STATE__, __NUXT__, Next.js flight data: "app_json", fields guessed,
    extras.guessed = true), then og: tags for a single listing ("og"; single_page_guess = true when it may be a search
    page), and `links`: same-site listing pages to open one by one when nothing structured was found ("list").

    POLITE BY DESIGN, same rules as event_source_read: robots.txt honoured (UA "HuntBot/1.0 (+read-only)", wildcards
    included: portals often forbid filtered searches like ?maxPrice=, so use their plain area pages), ≤ 1 request/s per
    host (or its Crawl-delay), page and robots.txt cached 6 h (from_cache = true costs nothing), a noindex page is
    skipped, public https only, ≤ 3 MB, nothing behind a login.

    SKIPPED: {skipped: "robots" | "noindex"} = not a source for this tool. {skipped: "blocked", open_by_hand: true} =
    the portal refuses automated reads (BLOCKED_SITES, answered at once without a request: Halo oglasi, Nekretnine.rs,
    ss.ge, myhome.ge, Korter, sahibinden, Hepsiemlak, Emlakjet, Lamudi, OLX, Krisha.kz, DDproperty, FazWaz, Hipflat,
    Livinginsider), or it answered 401 / 403 / 429 / a bot challenge: open it by hand in the hunter's browser, it's not
    a source for this tool; never retry it with other tricks. Facebook, Instagram, Telegram and Airbnb are refused here:
    the channel tools or by hand.

    PRICES keep the period the page gives: `period` month | year | week | day (Indonesian ads are often per year).
    Nothing is converted silently: `suggested.price` (listing_upsert is per month) is set only for a monthly price; a
    yearly or daily one goes to suggested.price_note and `missing` asks you to settle it. period_source "site_convention"
    = the site lists monthly rents without saying so on the card (said in price_note). Photos are public URLs: link,
    don't store (listing_photos(urls=...) for the ones you keep).

    Each listing: {from, id, url (its own page), title, description, price, currency, period, period_source, price_text,
    price_note, property_type, rooms, bedrooms, bathrooms, area_m2, city, district, address, lat, lng, photos, posted,
    updated, owner_or_agent ("owner" | "agent" | null: only when the page says it), extras, suggested, missing}.
    `suggested` = listing_upsert fields (listing_id "<site>-<id>", title, area_text, lat/lng, property_type, bedrooms,
    bathrooms, size_m2, price + currency when monthly, price_note, available, source, source_url); `missing` = what you
    add: district (the pack's slug), summary, the monthly price when the page has another period. Check the ad itself
    before writing to anyone; list pages are often stale.

    Returns {url, final_url, site_name, read, adapter?, listings, total, next_url?, links, from_cache, warning?} or
    {url, skipped: "robots" | "noindex" | "blocked", why, open_by_hand?, from_cache}."""
    url = (url or "").strip()
    host0 = (urlparse(url if "://" in url else "https://" + url).hostname or "").lower()
    if _listing_other_tool(host0):
        raise ToolError("Facebook / Instagram / Telegram / Airbnb pages are not read here: the channel tools "
                        "(tg_history, fb_*/ig_* history) or open it by hand; this tool reads rental portals.")
    why = blocked_site(host0)
    if why:
        return {"url": url, "skipped": "blocked", "site": _reg_domain(host0), "open_by_hand": True, "from_cache": False,
                "why": why + ": open it by hand in the hunter's browser, it's not a source for this tool."}
    _event_photos._check_public_https(url, "page")
    try:
        n = max(1, min(int(max_listings), 100))
    except (TypeError, ValueError):
        raise ToolError("max_listings must be a number 1..100.")
    u = urlparse(url)
    host = (u.hostname or "").lower()
    origin = f"https://{u.netloc}"
    cache = _event_sources._source_cache()
    ckey = "listing:" + url
    hit = cache.get(ckey)
    if hit:
        res, from_cache = hit["v"], True
    else:
        from_cache = False
        robots = await _event_sources._robots_txt(origin, host, cache)
        allowed, delay = _event_sources.robots_allows(robots, url)
        if delay:
            _event_sources._host_interval[host] = min(max(_event_sources.SOURCE_MIN_INTERVAL, delay), _event_sources.SOURCE_MAX_CRAWL_DELAY)
        if not allowed:
            res = {"url": url, "skipped": "robots",
                   "why": "robots.txt could not be read (server error)" if robots is None else
                   "robots.txt disallows this page for crawlers (filtered searches often are: try the portal's plain area page)"}
        else:
            await _event_sources._host_throttle(host)
            meta: dict[str, Any] = {}
            data, ctype, final = await _event_photos._fetch_public(
                url, _event_photos.PAGE_MAX_BYTES, "text/html,application/xhtml+xml,application/ld+json;q=0.9,*/*;q=0.1",
                ("text/html", "application/xhtml", "application/ld+json", "application/json", "text/plain"),
                "page", ua=_event_sources.HUNTBOT_UA, meta=meta)
            status = int(meta.get("status") or 200)
            body = data.decode("utf-8", "replace")
            if status in (401, 403, 429, 451, 468) or (status < 400 and _challenge_page(body)):
                res = {"url": url, "final_url": final, "skipped": "blocked", "status": status, "open_by_hand": True,
                       "why": f"the portal refused an automated read (HTTP {status}" +
                       (", bot challenge" if status < 400 else "") +
                       "): open it by hand in the hunter's browser, it's not a source for this tool."}
            elif status >= 400:
                raise ToolError(f"The page answered {status}; check the URL (a search or listing page of the portal)"
                                + (" or try later." if status >= 500 else "."))
            elif _event_sources._noindex(body, meta.get("x_robots") or []):
                res = {"url": url, "final_url": final, "skipped": "noindex",
                       "why": "the page asks not to be indexed (meta robots / X-Robots-Tag); do not use it as a source"}
            else:
                ex = extract_page_listings(body, ctype, final)
                for li in ex["listings"]:
                    li["suggested"], li["missing"] = _listing_suggest(li, ex["site_name"], final)
                    bad = _deals.sensitive_findings(li["suggested"])
                    if bad:
                        li["suggested"], li["missing"] = None, ["refused: " + "; ".join(bad)]
                res = {"url": url, "final_url": final, **ex, "total": len(ex["listings"])}
                if _reg_domain(urlparse(final).hostname or "") != _reg_domain(host):
                    res["warning"] = (f"The page redirected to another site ({urlparse(final).hostname}): check it is "
                                      "still the portal's own page before using it.")
        _event_sources._source_cache_put(cache, ckey, res)
    out = dict(res)
    if "listings" in out:
        out["listings"] = out["listings"][:n]
    out["from_cache"] = from_cache
    return out
