"""Hunt core: event_photos (split from hunt_core.py)."""
from __future__ import annotations
import html
import io
import re
from pathlib import Path
from urllib.parse import urlparse
import httpx
from huntcore.base import ToolError
from huntcore import base as _base, deals as _deals, events as _events
# ---- photo quality gate (local, Pillow only)

PHOTO_MAX_BYTES = 20 * 1024 * 1024
PHOTO_MIN_SHORT = 900        # real photos
POSTER_MIN_SHORT = 700       # designed posters/flyers (only the organizer's own)
POSTER_TEXT_MAX = 0.45       # a poster may carry text on < 45% of the image
POSTER_FACTOR = 0.85         # posters score lower: a passing real photo wins when there are several candidates
PHOTO_SHARP_MIN = 150.0      # variance of the Laplacian on the 512-px grey copy
PHOTO_MEAN_MIN, PHOTO_MEAN_MAX = 0.12, 0.85
PHOTO_DARK_MAX, PHOTO_BLOWN_MAX = 0.60, 0.25
PHOTO_TEXT_MAX = 0.20
_PRIVATE_HOST = re.compile(r"^(localhost|.*\.local|.*\.internal|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[)", re.I)


def _pil():
    try:
        from PIL import Image, ImageFilter, ImageOps, ImageStat  # noqa: F401
    except ImportError:
        raise ToolError("Pillow is missing: start the server with `uv run --script hunt_core.py` (it installs pillow>=10).")
    return Image, ImageFilter, ImageOps, ImageStat


def _fit_crop(w: int, h: int, cx: float, cy: float, aspect: float) -> dict:
    """The largest w:h = aspect crop inside the image, centred on (cx, cy) as far as the borders allow."""
    if w / h >= aspect:
        ch, cw = h, int(round(h * aspect))
    else:
        cw, ch = w, int(round(w / aspect))
    x = int(round(min(max(cx - cw / 2, 0), w - cw)))
    y = int(round(min(max(cy - ch / 2, 0), h - ch)))
    return {"x": x, "y": y, "w": cw, "h": ch}


def _text_area(grey, edges) -> float:
    """Share of 16-px blocks that look like text: many strong edges, high contrast, and a flat background (the larger
    tone class is nearly uniform: glyphs on a plain or smooth fill). Natural detail (leaves, crowds, water, skin) has
    edges and contrast too, but its tones vary inside each class."""
    w, h = grey.size
    gp, ep = grey.load(), edges.load()
    bs = 16
    total = text = 0
    for by in range(0, h - bs + 1, bs):
        for bx in range(0, w - bs + 1, bs):
            total += 1
            vals, strong = [], 0
            for y in range(by, by + bs):
                for x in range(bx, bx + bs):
                    vals.append(gp[x, y])
                    if ep[x, y] > 60:
                        strong += 1
            n = len(vals)
            if strong / n < 0.12:
                continue
            mean = sum(vals) / n
            if sum((v - mean) ** 2 for v in vals) / n < 40 ** 2:
                continue
            lo = [v for v in vals if v <= mean]
            hi = [v for v in vals if v > mean]
            big = sorted(lo if len(lo) >= len(hi) else hi)
            med = big[len(big) // 2]
            mad = sorted(abs(v - med) for v in big)[len(big) // 2]
            if mad <= 3:
                text += 1
    return text / total if total else 0.0


def photo_quality(img, organizer_own: bool = False, kind: str = "auto") -> dict:
    """Quality metrics for a PIL image (see event_photo_check). kind: auto (text_area < 0.20 → photo, else poster) |
    photo | poster. A poster passes only when organizer_own (the organizer's/venue's own design for this event)."""
    if kind not in ("auto", "photo", "poster"):
        raise ToolError("kind must be auto, photo or poster.")
    Image, ImageFilter, ImageOps, ImageStat = _pil()
    img = ImageOps.exif_transpose(img)
    w, h = img.size
    small = img.convert("RGB")
    scale = 512 / max(w, h)
    if scale < 1:
        small = small.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)
    grey = small.convert("L")
    lap = grey.filter(ImageFilter.Kernel((3, 3), [0, 1, 0, 1, -4, 1, 0, 1, 0], scale=1, offset=128))
    sharpness = ImageStat.Stat(lap).var[0]
    hist = grey.histogram()
    npx = sum(hist) or 1
    mean = sum(i * c for i, c in enumerate(hist)) / npx / 255
    dark = sum(hist[:20]) / npx
    blown = sum(hist[246:]) / npx
    edges = grey.filter(ImageFilter.FIND_EDGES)
    text_area = _text_area(grey, edges)
    # Saliency: edge-energy centroid (ignoring the 1-px border FIND_EDGES leaves), pulled 25% towards the centre.
    sw, sh = grey.size
    ep = edges.load()
    tot = sx = sy = 0.0
    for y in range(1, sh - 1):
        for x in range(1, sw - 1):
            e = ep[x, y]
            if e > 20:
                tot += e
                sx += e * x
                sy += e * y
    cx, cy = (sx / tot, sy / tot) if tot else (sw / 2, sh / 2)
    cx, cy = 0.75 * cx + 0.25 * sw / 2, 0.75 * cy + 0.25 * sh / 2
    fx, fy = cx * w / sw, cy * h / sh
    reasons = []
    short = min(w, h)
    is_poster = kind == "poster" or (kind == "auto" and text_area >= PHOTO_TEXT_MAX)
    min_short = POSTER_MIN_SHORT if is_poster else PHOTO_MIN_SHORT
    text_max = POSTER_TEXT_MAX if is_poster else PHOTO_TEXT_MAX
    if is_poster and not organizer_own:
        reasons.append(f"text-heavy (flyer?): ~{text_area:.0%} of the image looks like text; a poster is only used when it "
                       "is the organizer's own (organizer_own=true)")
    if short < min_short:
        reasons.append(f"too small: short side {short} px < {min_short}")
    if sharpness < PHOTO_SHARP_MIN:
        reasons.append(f"blurry: sharpness {sharpness:.0f} < {PHOTO_SHARP_MIN:.0f}")
    if mean < PHOTO_MEAN_MIN or dark > PHOTO_DARK_MAX:
        reasons.append(f"too dark: mean {mean:.2f}, {dark:.0%} near black")
    if mean > PHOTO_MEAN_MAX or blown > PHOTO_BLOWN_MAX:
        reasons.append(f"blown out: mean {mean:.2f}, {blown:.0%} near white")
    if text_area >= text_max and (organizer_own or not is_poster):
        reasons.append(f"text-heavy: ~{text_area:.0%} of the image looks like text (max {text_max:.0%}"
                       f"{' for a poster' if is_poster else ''})")
    ok = not reasons
    if h / w > 1.6:  # a note only: the landscape crop keeps little of a tall portrait
        reasons.append("note: tall portrait, the landscape crop keeps little; prefer a landscape photo")
    exp_ok = 1.0 - min(1.0, abs(mean - 0.48) / 0.4)
    score = (0.3 * min(1.0, short / max(PHOTO_MIN_SHORT, 1000)) + 0.3 * min(1.0, sharpness / (2 * PHOTO_SHARP_MIN))
             + 0.2 * exp_ok + 0.2 * (1.0 - min(1.0, text_area / (2 * PHOTO_TEXT_MAX if not is_poster else POSTER_TEXT_MAX))))
    if is_poster:
        score *= POSTER_FACTOR
    if h / w > 1.6:  # a story-format frame loses most of itself in the ticket crop: a 4:5 or landscape copy wins
        score -= 0.05
    if not ok:
        score = min(score, 0.49)
    elif score < 0.5:
        score = 0.5
    crop = _fit_crop(w, h, fx, fy, 16 / 9)
    return {
        "ok": ok, "score": round(score, 3), "kind": "poster" if is_poster else "photo", "width": w, "height": h, "short_side": short,
        "sharpness": round(sharpness, 1),
        "exposure": {"mean": round(mean, 3), "dark_frac": round(dark, 3), "blown_frac": round(blown, 3)},
        "text_area": round(text_area, 3),
        "crop": crop, "crops": {"16:9": crop, "3:2": _fit_crop(w, h, fx, fy, 3 / 2)},
        "reasons": reasons,
    }


def _public_host(host: str) -> bool:
    """True when every address the host resolves to is public (no loopback, private, link-local, CGNAT, multicast...).
    With a mocked transport (tests) only the name pattern is checked: nothing goes to the network."""
    import ipaddress
    import socket
    if not host or _PRIVATE_HOST.match(host):
        return False
    try:
        ip = ipaddress.ip_address(host.strip("[]"))
        return ip.is_global
    except ValueError:
        pass
    if _base._TRANSPORT is not None:
        return True
    try:
        infos = socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)
    except OSError:
        return False
    addrs = {i[4][0] for i in infos}
    return bool(addrs) and all(ipaddress.ip_address(a.split("%")[0]).is_global for a in addrs)


def _check_public_https(url: str, what: str = "URL") -> None:
    u = urlparse(url)
    if u.scheme.lower() != "https" or not u.hostname or (u.port not in (None, 443)) or not _public_host(u.hostname):
        raise ToolError(f"Only public https:// links are fetched ({what}: {url[:120]}).")


async def _fetch_public(url: str, max_bytes: int, accept: str, kinds: tuple[str, ...], what: str, *,
                        ua: str | None = None, meta: dict | None = None) -> tuple[bytes, str, str]:
    """GET a public https URL with redirects checked hop by hop (≤ 5), a byte cap and a content-type whitelist.
    Returns (bytes, content type, final URL). ua overrides the User-Agent. With meta (a dict) the response status and
    headers are written into it, and an HTTP error (≥ 400) returns (b"", "", final URL) instead of raising."""
    cur = url
    try:
        async with httpx.AsyncClient(transport=_base._TRANSPORT, timeout=30, follow_redirects=False) as c:
            for _ in range(6):
                _check_public_https(cur, what)
                async with c.stream("GET", cur, headers={"User-Agent": ua or _base.USER_AGENT, "Accept": accept}) as r:
                    if r.status_code in (301, 302, 303, 307, 308) and r.headers.get("location"):
                        from urllib.parse import urljoin
                        cur = urljoin(cur, r.headers["location"])
                        continue
                    if meta is not None:
                        meta["status"] = r.status_code
                        meta["headers"] = {k.lower(): v for k, v in r.headers.multi_items()}
                        meta["x_robots"] = r.headers.get_list("x-robots-tag")
                        if r.status_code >= 400:
                            return b"", "", cur
                    if r.status_code >= 400:
                        raise ToolError(f"The {what} answered {r.status_code}.")
                    ctype = r.headers.get("content-type", "").split(";")[0].strip().lower()
                    if ctype and not ctype.startswith(kinds):
                        raise ToolError(f"Not an image ({ctype}). Pass the direct image link, not the post page."
                                        if kinds == ("image/",) else f"The {what} is {ctype}, not {'/'.join(kinds)}.")
                    if int(r.headers.get("content-length") or 0) > max_bytes:
                        raise ToolError(f"The {what} is larger than {max_bytes // 2**20} MB.")
                    buf = bytearray()
                    async for chunk in r.aiter_bytes():
                        buf += chunk
                        if len(buf) > max_bytes:
                            raise ToolError(f"The {what} is larger than {max_bytes // 2**20} MB.")
                    return bytes(buf), ctype, cur
    except httpx.HTTPError as e:
        raise ToolError(f"Cannot download the {what} ({type(e).__name__}).")
    raise ToolError(f"Too many redirects for the {what}.")


async def _photo_bytes(path_or_url: str) -> tuple[bytes, str]:
    s = (path_or_url or "").strip()
    if re.match(r"^[a-z][a-z0-9+.-]*://", s, re.I):
        u = urlparse(s)
        if u.scheme.lower() != "https" or not u.hostname or not _public_host(u.hostname):
            raise ToolError("Only public https:// photo URLs (or a local file path) are checked.")
        data, _, _ = await _fetch_public(s, PHOTO_MAX_BYTES, "image/*", ("image/",), "photo")
        return data, s
    p = Path(s).expanduser()
    if not p.is_file():
        raise ToolError(f"No such file: {p}")
    if p.stat().st_size > PHOTO_MAX_BYTES:
        raise ToolError(f"The photo is larger than {PHOTO_MAX_BYTES // 2**20} MB.")
    return p.read_bytes(), str(p)


def _open_image(data: bytes):
    Image = _pil()[0]
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except Exception as e:  # UnidentifiedImageError, DecompressionBombError, truncated files
        raise ToolError(f"Cannot read the image ({type(e).__name__}).")
    return img


@_base.mcp.tool()
async def event_photo_check(path_or_url: str, organizer_own: bool = False, kind: str = "auto") -> dict:
    """Local quality gate for an event photo before you link it (photo_url in events_upsert / event_set: the usual way
    for a public https image — link, don't store) or store it (event_photo_upload: Telegram-only photos, refused
    hotlinks). Nothing is uploaded anywhere. path_or_url: a local file (e.g. from tg_post_media / event_photo_fetch) or a public
    https:// image link (≤ 20 MB; the direct image, not the post page).

    Returns {ok, score 0..1 (send it as photo_score; failing photos score ≤ 0.49, passing ≥ 0.5), kind (photo | poster),
    width, height, short_side, sharpness (variance of the Laplacian on a 512-px grey copy; ≥ 150 passes), exposure
    {mean 0..1, dark_frac, blown_frac}, text_area (estimated share of the image covered by text-like blocks), crop
    {x, y, w, h} (16:9, in original pixels, centred on an edge-energy saliency centroid), crops {"16:9", "3:2"},
    reasons: [...]}.
    Real photo (text_area < 0.20): short side ≥ 900 px, sharp, mean luminance 0.12..0.85 without large black/white areas.
    Poster/flyer (text_area ≥ 0.20, or kind="poster"): only when organizer_own=true (the organizer's/venue's own design
    for THIS event, e.g. the club's party poster; normal for parties), text on < 45% of the image, short side ≥ 700 px,
    same sharpness/exposure gates; posters score ×0.85, so a passing real atmosphere photo wins when several candidates
    exist (event_photo_pick ranks them that way).

    text_area is a HEURISTIC, not OCR: it counts 16-px blocks of the 512-px copy with dense, high-contrast thin strokes on
    a flat background (glyphs on a plain or smooth fill). Big bold display fonts, fine patterns or a striped shirt can fool it either way, so look at the
    photo yourself too. It does not detect stock photos, watermarks or faces: prefer the organizer's/venue's own recent
    photos with real people, and if nothing passes use the place photo or no photo (the app shows a styled category
    card) — never a bad photo."""
    data, src = await _photo_bytes(path_or_url)
    out = photo_quality(_open_image(data), organizer_own=organizer_own, kind=kind)
    out["source"] = src
    out["bytes"] = len(data)
    return out


# ---- event photo: fetch candidates, pick, prepare, upload

_META_IMG = re.compile(r"<meta\b[^>]*>", re.I)
_ATTR = re.compile(r"""([a-zA-Z:_-]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)""")
PAGE_MAX_BYTES = 3 * 1024 * 1024
EVENT_UPLOAD_MAX = 2 * 1024 * 1024
EVENT_UPLOAD_SIDE = 1600


def page_images(html_text: str, base: str) -> dict:
    """og:image / og:image:secure_url / twitter:image (+ og:title, og:site_name) from a page's <meta> tags, absolute, https only."""
    from urllib.parse import urljoin
    imgs: list[str] = []
    meta: dict[str, str] = {}
    for tag in _META_IMG.findall(html_text[:600_000]):
        a = {k.lower(): v.strip("\"'") for k, v in _ATTR.findall(tag)}
        key = (a.get("property") or a.get("name") or "").lower()
        val = html.unescape(a.get("content") or "").strip()
        if not val:
            continue
        if key in ("og:image", "og:image:secure_url", "og:image:url", "twitter:image", "twitter:image:src"):
            u = urljoin(base, val)
            if u.startswith("https://") and u not in imgs:
                imgs.append(u)
        elif key in ("og:title", "og:site_name") and key not in meta:
            meta[key] = val[:200]
    return {"images": imgs, "title": meta.get("og:title"), "site_name": meta.get("og:site_name")}


@_base.mcp.tool()
async def event_photo_fetch(url: str, out_dir: str, max_images: int = 4, organizer_own: bool = False) -> dict:
    """Download event photo candidates from an event or venue PAGE (its og:image / twitter:image) or a direct https image
    link into out_dir, and run the quality gate on each. Public https hosts only (every DNS address must be public,
    redirects re-checked, ≤ 3 MB page, ≤ 20 MB image, image/* only). One page per call, no crawling.
    Telegram posts are not pages: use tg_post_media(link, out_dir) on the hunt-telegram server (read only).

    Use only images the organizer or venue published to promote that event or place (its own site/page), never a
    third-party catalog, random users' photos or stock; keep the page as the credit link. Link, don't store: a passing
    image_url goes to events_upsert as photo_url (+ photo_credit, photo_source_url = page); the downloaded file is only
    for the check (and for event_photo_upload when the host refuses hotlinking of the organizer's own promo image).
    Returns {page, title, site_name, files: [{path, image_url, bytes, check: <event_photo_check result>}], errors,
    warning? (the page redirected to another site: a dead venue domain may now be anything; do not use it)}."""
    if re.match(r"^(?:https?://)?(?:t\.me|telegram\.me)/", (url or "").strip(), re.I):
        raise ToolError("Telegram post: use tg_post_media(link, out_dir) (hunt-telegram, read only), then event_photo_pick.")
    if not out_dir:
        raise ToolError("out_dir is required.")
    _check_public_https((url or "").strip(), "page")
    data, ctype, final = await _fetch_public(url.strip(), PAGE_MAX_BYTES, "text/html,application/xhtml+xml,image/*",
                                             ("text/html", "application/xhtml", "image/"), "page")
    od = Path(out_dir).expanduser()
    od.mkdir(parents=True, exist_ok=True)
    if ctype.startswith("image/"):
        info, blobs = {"images": [final], "title": None, "site_name": None}, {final: data}
    else:
        info, blobs = page_images(data.decode("utf-8", "replace"), final), {}
    import hashlib
    files, errs = [], []
    for img_url in info["images"][: max(1, min(int(max_images), 8))]:
        try:
            b = blobs.get(img_url) or (await _fetch_public(img_url, PHOTO_MAX_BYTES, "image/*", ("image/",), "photo"))[0]
            img = _open_image(b)
            ext = {"JPEG": ".jpg", "PNG": ".png", "WEBP": ".webp", "GIF": ".gif"}.get(img.format or "", ".img")
            p = od / (hashlib.sha1(img_url.encode()).hexdigest()[:12] + ext)
            p.write_bytes(b)
            q = photo_quality(img, organizer_own=organizer_own)
            files.append({"path": str(p), "image_url": img_url, "bytes": len(b), "check": q})
        except ToolError as e:
            errs.append({"image_url": img_url, "error": str(e)})
    def _site(u: str) -> str:
        return ".".join((urlparse(u).hostname or "").lower().split(".")[-2:])
    out = {"page": final, "title": info["title"], "site_name": info["site_name"], "files": files, "errors": errs,
           "found": len(info["images"])}
    if _site(final) != _site(url.strip()):
        out["warning"] = f"The page redirected to another site ({urlparse(final).hostname}): check it is still the organizer's own page."
    return out


@_base.mcp.tool()
async def event_photo_pick(paths: list[str], organizer_own: bool = False) -> dict:
    """Rank several candidate images for one event (local files): passing ones first, real photos before posters, then by
    score. organizer_own = the files are the organizer's/venue's own material (needed for posters to pass).
    Returns {best: {path, score, kind} | null, ranked: [{path, ok, kind, score, short_side, text_area, reasons}]}.
    best = null → no image passes: leave the event without a photo (the app shows the category card)."""
    if not isinstance(paths, list) or not paths:
        raise ToolError("paths must be a non-empty list of local files.")
    ranked = []
    for pth in paths[:40]:
        try:
            data, src = await _photo_bytes(str(pth))
            q = photo_quality(_open_image(data), organizer_own=organizer_own)
            ranked.append({"path": src, "ok": q["ok"], "kind": q["kind"], "score": q["score"], "short_side": q["short_side"],
                           "text_area": q["text_area"], "sharpness": q["sharpness"], "reasons": q["reasons"]})
        except ToolError as e:
            ranked.append({"path": str(pth), "ok": False, "kind": None, "score": 0.0, "reasons": [str(e)]})
    ranked.sort(key=lambda r: (not r["ok"], r["kind"] != "photo", -r["score"]))
    best = ranked[0] if ranked[0]["ok"] else None
    return {"best": {k: best[k] for k in ("path", "score", "kind")} if best else None, "ranked": ranked}


def prepare_event_photo(img) -> bytes:
    """≤ 1600 px on the long side, RGB JPEG q≈82 without metadata, ≤ 2 MB (quality steps down if needed)."""
    Image, _, ImageOps, _ = _pil()
    img = ImageOps.exif_transpose(img)
    if img.mode not in ("RGB", "L"):
        bg = Image.new("RGB", img.size, (255, 255, 255))
        rgba = img.convert("RGBA")
        bg.paste(rgba, mask=rgba.split()[-1])
        img = bg
    img = img.convert("RGB")
    w, h = img.size
    k = EVENT_UPLOAD_SIDE / max(w, h)
    if k < 1:
        img = img.resize((max(1, round(w * k)), max(1, round(h * k))), Image.LANCZOS)
    for q in (82, 76, 70, 64, 58):
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=q, optimize=True, progressive=True)
        if buf.tell() <= EVENT_UPLOAD_MAX:
            return buf.getvalue()
    raise ToolError("Cannot fit the photo into 2 MB.")


@_base.mcp.tool()
async def event_photo_upload(event_id: str, path: str, credit: str, source_url: str, organizer_own: bool = False,
                             kind: str = "auto", dry_run: bool = False, out_path: str | None = None) -> dict:
    """Store an event photo file in the CRM (POST /api/events/:id/photo, KV) ONLY for photos without a public https URL
    (Telegram-only posts) or when the organizer's host refuses hotlinking (events_get: photo.stale with fail "refused")
    and the image is the organizer's own promo for this event. A public https image is LINKED, not stored: send it as
    photo_url via events_upsert / event_set (link, don't store). Runs the quality gate first (event_photo_check rules; a failing photo is refused, never
    upload a bad image), resizes to ≤ 1600 px long side, JPEG q≈82 (≤ 2 MB, metadata stripped), sends the score.
    credit = whose photo it is ("Savaya Bali"), source_url = the post or page it comes from (https, shown as the credit
    link). Only the organizer's/venue's own promo images for that event or place, never random users' photos or stock.
    dry_run=true: nothing is sent; the prepared JPEG is written to out_path (default <file>_upload.jpg).
    Returns {event, key} from the CRM, or {dry_run: true, out_path, bytes, check} with dry_run."""
    if not isinstance(event_id, str) or not re.fullmatch(r"ev_[A-Za-z0-9_]{2,60}", event_id):
        raise ToolError("event_id must be an Афиша event id (ev_…).")
    credit = (credit or "").strip()
    if not credit or len(credit) > 140:
        raise ToolError("credit is required (≤ 140 chars): whose photo it is.")
    source_url = (source_url or "").strip()
    if not _events._HTTPS.match(source_url):
        raise ToolError("source_url must be the https:// post or page the photo comes from.")
    bad = _deals.sensitive_findings({"credit": credit})
    if bad:
        raise ToolError("Refused: " + "; ".join(bad))
    data, src = await _photo_bytes(path)
    img = _open_image(data)
    q = photo_quality(img, organizer_own=organizer_own, kind=kind)
    if not q["ok"]:
        raise ToolError("The photo does not pass the quality gate: " + "; ".join(q["reasons"]) + ". Leave the event without a photo.")
    jpg = prepare_event_photo(img)
    if dry_run:
        op = Path(out_path).expanduser() if out_path else Path(src).with_name(Path(src).stem + "_upload.jpg")
        op.parent.mkdir(parents=True, exist_ok=True)
        op.write_bytes(jpg)
        return {"dry_run": True, "event_id": event_id, "out_path": str(op), "bytes": len(jpg), "credit": credit,
                "source_url": source_url, "check": {k: q[k] for k in ("ok", "score", "kind", "width", "height", "text_area", "sharpness")}}
    files = [("photo", ("event.jpg", jpg, "image/jpeg")), ("credit", (None, credit)), ("source_url", (None, source_url)),
             ("score", (None, str(q["score"])))]
    return await _base.api("POST", f"/api/events/{_base._q(event_id)}/photo", files=files, timeout=60)
