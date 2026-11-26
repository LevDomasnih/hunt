# /// script
# requires-python = ">=3.11"
# dependencies = ["playwright==1.60.0", "pillow==11.3.0", "pyyaml==6.0.2"]
# ///
"""Hunt region art: check, render, look. Run with uv, PACK is a country folder of a region pack (the one with pack.yaml).

    uv run --script art.py check  PACK [PACK ...]          rules of the house style (exit 1 on errors)
    uv run --script art.py toys   PACK [slug ...]          avatars/*.svg -> PACK/art/toys/*.webp, prints what became a body, a plate, a bead, an eye
    uv run --script art.py zoom   PACK [slug ...] -o zoom.png   the toys big on the screen colour: dents, seams, eyes
    uv run --script art.py island PACK [--areas a,b,c] [--name city]   districts.geojson -> art/island[-city].webp + .json (toy land)
    uv run --script art.py sheet  PACK -o sheet.png [--no-names]        everything on one page: look at it before you say it is done
    uv run --script art.py toy    FILE.svg ... -o DIR      any other object (goods, stickers)

The renderer is three.js in headless Chromium. three@0.186.1 is fetched once from registry.npmjs.org (pinned by sha512) into
~/.cache/hunt/art. Chromium: TOYS_CHROMIUM=/path, else Playwright's own (`uvx playwright@1.60.0 install chromium-headless-shell`).
"""
from __future__ import annotations

import argparse, asyncio, base64, glob, hashlib, io, json, math, mimetypes, os, re, sys, tarfile, urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
CACHE = Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache")) / "hunt" / "art"
THREE_URL = "https://registry.npmjs.org/three/-/three-0.186.1.tgz"
THREE_SHA512 = "blFeqb49wRCSGUGj7gtpfnSGHy2lwDk94RhUmS1c/hTby70kvChbWpkJ4Pm1390LqzzvTmzgXKHPEafJwCb8jA=="
THREE_FILES = ["build/three.module.js", "build/three.core.js", "examples/jsm/environments/RoomEnvironment.js"]
STILL = {"yaw": -30, "pitch": 12, "roll": 0, "bob": 0}
SIZES = (192, 384)
INK, INK2, NIGHT, PAPER = "#151413", "#46433D", "#151413", "#F2F0EA"
TAKEN = {"Деньги mint": "#8EE3C8", "Афиша coral": "#FF8A5B", "Афиша pink": "#FF8FB1", "Заказы lilac": "#A98CFF", "calm grey": "#E6E4DF"}
REGIONS = {"bali": "#E8E35C", "kz": "#9ED0F2", "th": "#FFB65C"}  # known even when the packs are not next to yours
SHAPES = {"path", "circle", "ellipse", "rect", "polygon", "polyline", "line"}
SLUG = re.compile(r"^[a-z][a-z0-9_]{1,30}$")

# ---------------------------------------------------------------- colour


def rgb(h: str) -> tuple[float, float, float]:
    return tuple(int(h[i : i + 2], 16) / 255 for i in (1, 3, 5))


def lin(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def lum(h: str) -> float:
    r, g, b = (lin(c) for c in rgb(h))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a: str, b: str) -> float:
    x, y = sorted((lum(a), lum(b)), reverse=True)
    return (x + 0.05) / (y + 0.05)


def oklab(h: str) -> tuple[float, float, float]:
    r, g, b = (lin(c) for c in rgb(h))
    l = (0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b) ** (1 / 3)
    m = (0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b) ** (1 / 3)
    s = (0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b) ** (1 / 3)
    return (0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
            0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s)


def dist(a: str, b: str) -> float:
    return math.dist(oklab(a), oklab(b))


def is_hex(v) -> bool:
    return isinstance(v, str) and re.fullmatch(r"#[0-9A-Fa-f]{6}", v) is not None


# ---------------------------------------------------------------- check


class Report:
    def __init__(self) -> None:
        self.err: list[str] = []
        self.warn: list[str] = []


def svg_root(path: Path, rep: Report, tag: str):
    raw = path.read_text(encoding="utf-8")
    if "<!DOCTYPE" in raw or "<!ENTITY" in raw:
        rep.err.append(f"{tag}: no DOCTYPE or entities")
        return None, raw
    try:
        return ET.fromstring(raw), raw
    except ET.ParseError as e:
        rep.err.append(f"{tag}: not valid XML ({e})")
        return None, raw


def local(el) -> str:
    return el.tag.rsplit("}", 1)[-1]


def check_safe(root, rep: Report, tag: str, allowed: set[str]) -> None:
    for el in root.iter():
        n = local(el)
        if el is not root and n not in allowed:
            rep.err.append(f"{tag}: <{n}> is not allowed")
        for k, v in el.attrib.items():
            k = k.rsplit("}", 1)[-1]
            if k.startswith("on") or k == "style" or (k == "href" and not v.startswith("#")) or "url(http" in v or "data:" in v:
                rep.err.append(f"{tag}: attribute {k}={v[:40]!r} is not allowed")


def check_avatar(path: Path, rep: Report) -> None:
    tag = f"avatars/{path.name}"
    root, raw = svg_root(path, rep, tag)
    if root is None:
        return
    if root.get("viewBox") != "0 0 96 96":
        rep.err.append(f"{tag}: viewBox must be 0 0 96 96")
    check_safe(root, rep, tag, SHAPES | {"g"})
    shapes = [e for e in root.iter() if local(e) in SHAPES]
    if not 6 <= len(shapes) <= 32:
        rep.err.append(f"{tag}: {len(shapes)} shapes (eyes included), allowed 6-32, the usual is 8-20")
    cols = set()
    for e in root.iter():
        for k in ("fill", "stroke"):
            v = e.get(k)
            if v in (None, "none"):
                continue
            if not re.fullmatch(r"#[0-9A-Fa-f]{3}|#[0-9A-Fa-f]{6}", v):
                rep.err.append(f"{tag}: {k}={v!r}: plain hex colours only (no gradients, no currentColor)")
            else:
                cols.add(("#" + "".join(c * 2 for c in v[1:]) if len(v) == 4 else v).upper())
    if len(cols) > 10:
        rep.err.append(f"{tag}: {len(cols)} colours, 10 at most")
    elif len(cols) > 8:
        rep.warn.append(f"{tag}: {len(cols)} colours, the usual is 4-8 with the eyes")
    # an eye = a small dark circle with a small light circle on it: the renderer turns it into a glossy bead
    circ = [(float(e.get("cx", 0)), float(e.get("cy", 0)), float(e.get("r", 0)), (e.get("fill") or "").upper()) for e in shapes if local(e) == "circle"]
    full = lambda c: "#" + "".join(x * 2 for x in c[1:]) if len(c) == 4 else c
    dark = [c for c in circ if c[3].startswith("#") and lum(full(c[3])) < 0.05 and 2 <= c[2] <= 5]
    eyes = [d for d in dark if any(c[3].startswith("#") and lum(full(c[3])) > 0.7 and 0 < c[2] <= 1.8 and math.dist(c[:2], d[:2]) < d[2] for c in circ)]
    if not eyes:
        rep.warn.append(f"{tag}: no bead eye (a dark circle r 2.8-4.5, 5 at most, not transformed, with a white circle r <= 1.8 on it); fine only for shaped eyes")
    for d in eyes:
        if math.dist(d[:2], (48, 48)) > 40:
            rep.warn.append(f"{tag}: an eye at {d[:2]} is near the rim of the disc")
    if len(raw) > 4096:
        rep.err.append(f"{tag}: {len(raw)} bytes, simplify (4 KB at most)")


def check_motif(path: Path, vb: str, rep: Report) -> None:
    tag = path.name
    if not path.exists():
        rep.err.append(f"{tag}: missing")
        return
    root, raw = svg_root(path, rep, tag)
    if root is None:
        return
    if root.get("viewBox") != vb:
        rep.err.append(f"{tag}: viewBox must be {vb}")
    if root.get("fill") != "currentColor":
        rep.err.append(f'{tag}: the root needs fill="currentColor"')
    check_safe(root, rep, tag, SHAPES | {"g", "defs", "mask", "use", "clipPath", "pattern"})
    inmask = {id(d) for m in root.iter() if local(m) in ("mask", "clipPath") for d in m.iter()}
    for e in root.iter():
        if id(e) in inmask:
            continue
        for k in ("fill", "stroke"):
            if e.get(k) not in (None, "none", "currentColor"):
                rep.err.append(f"{tag}: {k}={e.get(k)!r}: one colour, currentColor only (tone by opacity; hex only inside a mask)")
    if "id=" in raw and not re.search(r'id="[a-z]+-', raw):
        rep.warn.append(f"{tag}: prefix ids with the region (several motifs share a page)")
    if len(raw) > 8192:
        rep.err.append(f"{tag}: {len(raw)} bytes (8 KB at most)")


def check_theme(art: Path, rep: Report, others: dict[str, str]) -> None:
    p = art / "theme.yaml"
    if not p.exists():
        rep.err.append("theme.yaml: missing")
        return
    th = yaml.safe_load(p.read_text()) or {}
    for k in th:
        if k not in ("screen", "accent", "detail"):
            rep.err.append(f"theme.yaml: unknown key {k} (screen, accent, detail)")
    sc = th.get("screen")
    if not is_hex(sc):
        rep.err.append('theme.yaml: screen: "#RRGGBB" is required')
    else:
        if contrast(INK, sc) < 9:
            rep.err.append(f"theme.yaml: ink on screen {contrast(INK, sc):.1f}:1, needs 9:1 (a light, saturated colour)")
        if contrast(INK2, sc) < 4.5:
            rep.err.append(f"theme.yaml: secondary text #46433D on screen {contrast(INK2, sc):.1f}:1, needs 4.5:1")
        _, a, b = oklab(sc)
        if math.hypot(a, b) < 0.06:
            rep.err.append("theme.yaml: screen is almost grey; a region is one bright solid colour")
        for n, c in TAKEN.items():
            if dist(sc, c) < 0.06:
                rep.err.append(f"theme.yaml: screen is too close to {n} {c} (a section of the app)")
        for n, c in others.items():
            if dist(sc, c) < 0.05:
                rep.err.append(f"theme.yaml: screen is too close to region {n} {c}")
    ac = th.get("accent") or {}
    for mode, ground in (("light", "#F5F4F0"), ("dark", NIGHT)):
        v = ac.get(mode) if isinstance(ac, dict) else None
        if not is_hex(v):
            rep.err.append(f"theme.yaml: accent.{mode} is required (maps and motifs)")
        elif contrast(v, ground) < 4.5:
            rep.err.append(f"theme.yaml: accent.{mode} on {ground} {contrast(v, ground):.1f}:1, needs 4.5:1")


def avatars(pack: Path) -> list[dict]:
    p = pack / "art/avatars/index.yaml"
    return (yaml.safe_load(p.read_text()) or {}).get("avatars") or [] if p.exists() else []


def check(pack: Path) -> Report:
    rep = Report()
    art = pack / "art"
    items = avatars(pack)
    if len(items) < 8:
        rep.err.append(f"avatars/index.yaml: {len(items)} animals, a region has 8")
    seen: set[str] = set()
    for it in items:
        slug = str(it.get("slug", ""))
        if not SLUG.match(slug) or slug in seen:
            rep.err.append(f"index.yaml: bad or repeated slug {slug!r}")
            continue
        seen.add(slug)
        nm = it.get("name") or {}
        if not nm.get("en") or not nm.get("ru"):
            rep.err.append(f"index.yaml: {slug}: name needs en and ru")
        bl, bd = it.get("bg_light"), it.get("bg_dark")
        if not is_hex(bl) or lum(bl) < 0.55:
            rep.err.append(f"index.yaml: {slug}: bg_light is a pale tint of the animal's colour")
        if not is_hex(bd) or lum(bd) > 0.08:
            rep.err.append(f"index.yaml: {slug}: bg_dark is a deep shade of the same hue")
        f = art / "avatars" / f"{slug}.svg"
        if not f.exists():
            rep.err.append(f"avatars/{slug}.svg: missing")
        else:
            check_avatar(f, rep)
            toy = art / "toys" / f"{slug}-192.webp"
            if toy.exists() and toy.stat().st_mtime + 1 < f.stat().st_mtime:
                rep.warn.append(f"avatars/{slug}.svg is newer than its toy, run toys {slug}")
        for kind in ("", "-full"):
            for sz in SIZES:
                if (art / "toys").exists() and not (art / "toys" / f"{slug}{kind}-{sz}.webp").exists():
                    rep.err.append(f"toys/{slug}{kind}-{sz}.webp: missing, run toys")
    if pack.name == "_generic":
        return rep
    others = dict(REGIONS)
    others.pop(pack.name, None)
    for d in pack.parent.iterdir():
        t = d / "art/theme.yaml"
        if d != pack and t.exists():
            c = (yaml.safe_load(t.read_text()) or {}).get("screen")
            if is_hex(c):
                others[d.name] = c
    check_theme(art, rep, others)
    check_motif(art / "motif-mark.svg", "0 0 64 64", rep)
    check_motif(art / "motif-scene.svg", "0 0 360 160", rep)
    if not (art / "toys").exists():
        rep.warn.append("art/toys: not rendered yet, run toys (the app shows the flat SVG until then)")
    return rep


# ---------------------------------------------------------------- browser


def three() -> Path:
    d = CACHE / "three-0.186.1"
    if all((d / f).exists() for f in THREE_FILES):
        return d
    print("fetching three@0.186.1 (once)", file=sys.stderr)
    with urllib.request.urlopen(THREE_URL, timeout=120) as r:
        blob = r.read()
    if base64.b64encode(hashlib.sha512(blob).digest()).decode() != THREE_SHA512:
        sys.exit("three-0.186.1.tgz: the checksum does not match, stopped")
    with tarfile.open(fileobj=io.BytesIO(blob), mode="r:gz") as t:
        for f in THREE_FILES:
            data = t.extractfile(f"package/{f}").read()
            (d / f).parent.mkdir(parents=True, exist_ok=True)
            (d / f).write_bytes(data)
    return d


def chromium() -> str | None:
    if os.environ.get("TOYS_CHROMIUM"):
        return os.environ["TOYS_CHROMIUM"]
    for base in ("~/Library/Caches/ms-playwright", "~/.cache/ms-playwright", "~/AppData/Local/ms-playwright"):
        hits = sorted(glob.glob(os.path.expanduser(f"{base}/chromium_headless_shell-*/*/*headless[-_]shell*")))
        hits = [h for h in hits if os.path.isfile(h) and (os.access(h, os.X_OK) or h.endswith(".exe"))]
        if hits:
            return hits[-1]
    return None


class Browser:
    async def __aenter__(self):
        from playwright.async_api import async_playwright

        self.p = await async_playwright().start()
        try:
            self.b = await self.p.chromium.launch(executable_path=chromium(), args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        except Exception as e:
            await self.p.stop()
            sys.exit(f"No headless Chromium ({str(e).splitlines()[0]}). Ask the user, then: uvx playwright@1.60.0 install chromium-headless-shell")
        return self

    async def __aexit__(self, *a):
        await self.b.close()
        await self.p.stop()

    async def toy_page(self):
        lib = three()
        page = await self.b.new_page(viewport={"width": 600, "height": 600})
        page.on("pageerror", lambda e: print("  [page]", e, file=sys.stderr))

        async def serve(route):
            path = route.request.url.split("toys.local", 1)[1].split("?")[0].lstrip("/") or "render.html"
            f = lib / path.removeprefix("node_modules/three/") if path.startswith("node_modules/three/") else HERE / path
            if not f.is_file():
                return await route.fulfill(status=404, body="")
            ct = "text/javascript" if f.suffix == ".js" else mimetypes.guess_type(str(f))[0] or "application/octet-stream"
            await route.fulfill(status=200, body=f.read_bytes(), headers={"content-type": ct})

        await page.route("http://toys.local/**", serve)
        await page.goto("http://toys.local/render.html")
        await page.wait_for_function("window.ready === true")
        return page


async def render(page, svg: str, out: int = 512, shadow: bool = True) -> bytes:
    await page.evaluate("v => { window.noShadow = v }", not shadow)
    r = await page.evaluate("([s, o]) => window.render(s, o)", [svg, {"out": out, "frames": [STILL]}])
    return base64.b64decode(r["still"].split(",")[1])


# ---------------------------------------------------------------- toys
# Geometry of the "disc pop-out" (crm/public/app.css .av.toy): the toy frame is K x the disc, nudged left by NUDGE of the frame and
# up by DY x the disc; the white ring is RING x the disc. Inside the inner disc everything stays; outside it the toy is kept above
# its neck (per side), so the head pops out over the ring with no step.
K, NUDGE, DY, RING = 1.32, 0.535, -0.10, 0.07


def pop_mask(im):
    from PIL import Image, ImageFilter

    F = im.width
    s = F / K
    cx, cy, r = NUDGE * F, F / 2 - DY * s, s / 2 - RING * s
    px = im.getchannel("A").load()
    solid = [[px[x, y] > 128 for x in range(F)] for y in range(F)]

    def out(y, left):
        h = r * r - (y + 0.5 - cy) ** 2
        rim = math.sqrt(h) if h > 0 else 0.0
        xs = [x for x in range(F) if solid[y][x]]
        return -F if not xs else (cx - rim) - xs[0] if left else xs[-1] - (cx + rim)

    cuts = {}
    for left in (True, False):
        ps = [(out(y, left), y) for y in range(int(cy - 0.06 * s), int(cy + 0.40 * s))]
        inside = [y for p, y in ps if p <= 0.5]
        cuts[left] = inside[0] if inside else min(ps)[1]
    m = Image.new("L", (F, F), 0)
    mp = m.load()
    for y in range(F):
        for x in range(F):
            if y < cuts[x < cx] or (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r:
                mp[x, y] = 255
    return m.filter(ImageFilter.GaussianBlur(0.7))


def square(im):
    from PIL import Image

    im = im.crop(im.getbbox())
    side = max(im.size)
    sq = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    sq.alpha_composite(im, ((side - im.width) // 2, side - im.height))
    return sq


def webp(im, dst: Path, sz: int) -> None:
    from PIL import Image

    dst.parent.mkdir(parents=True, exist_ok=True)
    im.resize((sz, sz), Image.LANCZOS).save(dst, "WEBP", quality=82, method=6, alpha_quality=90)


async def toys(pack: Path, slugs: list[str]) -> None:
    from PIL import Image

    out = pack / "art/toys"
    unknown = set(slugs) - {it["slug"] for it in avatars(pack)}
    if unknown:
        sys.exit(f"not in avatars/index.yaml: {', '.join(sorted(unknown))}")
    async with Browser() as b:
        page = await b.toy_page()
        for it in avatars(pack):
            slug = it["slug"]
            if slugs and slug not in slugs:
                continue
            im = Image.open(io.BytesIO(await render(page, (pack / "art/avatars" / f"{slug}.svg").read_text()))).convert("RGBA")
            full = square(im)
            a = im.getchannel("A")
            im.putalpha(Image.composite(a, Image.new("L", a.size, 0), pop_mask(im)))
            for sz in SIZES:
                webp(full, out / f"{slug}-full-{sz}.webp", sz)
                webp(im, out / f"{slug}-{sz}.webp", sz)
            layers = await page.evaluate("window.lastLayers")
            print(slug, "->", out, " ".join(f"{l['kind']}{l['color']}" for l in layers), flush=True)
            main = max((l for l in layers if l["kind"] == "base"), key=lambda l: l["share"], default=None)
            if main and is_hex(it.get("bg_light")) and dist(main["color"], it["bg_light"]) < 0.10:
                print(f"  look: bg_light {it['bg_light']} nearly equals the main colour {main['color']}: take the hue of the face or horns, a step darker", flush=True)
            col = (yaml.safe_load((pack / "art/theme.yaml").read_text()) or {}).get("screen") if (pack / "art/theme.yaml").exists() else None
            if main and is_hex(col) and dist(main["color"], col) < 0.10:
                print(f"  look: the main colour {main['color']} drowns on the screen {col}", flush=True)
            for l in layers:
                if l["kind"] == "plate" and l["share"] > 0.12 and l["coverage"] < 0.98:
                    print(f"  look: {l['color']} is {l['coverage']:.0%} on earlier shapes, so it is a flat plate with a torn edge: move it out (under 60 %) to be a body, or fully in", flush=True)
                if l["kind"] == "eye" and l["coverage"] < 0.995:
                    print("  look: an eye hangs over the edge of the head", flush=True)


async def zoom(pack: Path, slugs: list[str], out: Path) -> None:
    from PIL import Image

    names = [it["slug"] for it in avatars(pack) if not slugs or it["slug"] in slugs]
    th = pack / "art/theme.yaml"
    col = (yaml.safe_load(th.read_text()) or {}).get("screen", "#E6E4DF") if th.exists() else "#E6E4DF"
    rows = (len(names) + 3) // 4
    im = Image.new("RGB", (4 * 400, rows * 800), NIGHT)
    im.paste(col, (0, 0, 1600, rows * 400))
    for i, s in enumerate(names):
        t = Image.open(pack / "art/toys" / f"{s}-full-384.webp").convert("RGBA")
        for dy in (0, rows * 400):
            im.paste(t, (i % 4 * 400 + 8, i // 4 * 400 + 8 + dy), t)
    out.parent.mkdir(parents=True, exist_ok=True)
    im.save(out)
    print(out)


async def loose(files: list[Path], out: Path) -> None:
    from PIL import Image

    async with Browser() as b:
        page = await b.toy_page()
        for f in files:
            im = square(Image.open(io.BytesIO(await render(page, f.read_text(), 1024, shadow=False))).convert("RGBA"))
            for sz in (*SIZES, 768):
                webp(im, out / f"{f.stem}-{sz}.webp", sz)
            print(f.stem, flush=True)


# ---------------------------------------------------------------- island


def island(pack: Path, areas: list[str], name: str = "") -> None:
    """The land as one thick toy piece in the region colour, areas separated by soft grooves, on a transparent sea."""
    from PIL import Image, ImageChops, ImageDraw, ImageFilter

    gj = json.loads((pack / "districts.geojson").read_text())
    feats = [f for f in gj["features"] if not areas or f["properties"]["id"] in areas]
    miss = set(areas) - {f["properties"]["id"] for f in feats}
    if not feats or miss:
        sys.exit(f"districts.geojson has no {', '.join(sorted(miss)) or 'areas'}")
    screen = (yaml.safe_load((pack / "art/theme.yaml").read_text()) or {})["screen"]
    polys = []
    for f in feats:
        g = f["geometry"]
        for p in g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]:
            polys.append((f["properties"]["id"], p[0]))
    xs = [c[0] for _, r in polys for c in r]
    ys = [c[1] for _, r in polys for c in r]
    kx = math.cos(math.radians((min(ys) + max(ys)) / 2))
    w, h = (max(xs) - min(xs)) * kx, max(ys) - min(ys)
    OUT, PAD = 1200, 90
    s = (OUT - 2 * PAD) / max(w, h)
    W, H = int(w * s + 2 * PAD), int(h * s + 2 * PAD)
    SS = 2
    P = lambda lon, lat: ((PAD + (lon - min(xs)) * kx * s) * SS, (PAD + (max(ys) - lat) * s) * SS)
    size = (W * SS, H * SS)
    m = Image.new("L", size, 0)
    d = ImageDraw.Draw(m)
    for _, r in polys:
        d.polygon([P(*c[:2]) for c in r], fill=255)
    px = lambda v: max(1, int(v * OUT / 1200 * SS)) | 1
    m = m.filter(ImageFilter.MaxFilter(px(11))).filter(ImageFilter.MinFilter(px(11)))  # close the gaps between areas
    m = m.filter(ImageFilter.GaussianBlur(px(6))).point(lambda v: 255 if v > 122 else 0).filter(ImageFilter.GaussianBlur(px(2)))
    mix = lambda c, k, to=0: "#" + "".join(f"{round((v * k + to * (1 - k)) * 255):02X}" for v in rgb(c))
    th = px(22)
    side = m.copy()
    for i in range(1, th, 2):
        side = ImageChops.lighter(side, ImageChops.offset(m, 0, i))
    out = Image.new("RGBA", size, (0, 0, 0, 0))

    def put(col, mask):
        l = Image.new("RGBA", size, col)
        l.putalpha(mask)
        out.alpha_composite(l)

    put(INK, ImageChops.offset(side, 0, px(18)).filter(ImageFilter.GaussianBlur(px(18))).point(lambda v: int(v * 0.28)))
    put(mix(screen, 0.70), side)
    put(mix(screen, 0.60), ImageChops.subtract(side, ImageChops.offset(side, 0, -px(4))))
    put(screen, m)
    put(mix(screen, 0.55, 1), ImageChops.subtract(m, ImageChops.offset(m, 0, px(3))))
    grooves = Image.new("L", size, 0)
    d = ImageDraw.Draw(grooves)
    for _, r in polys:
        d.line([P(*c[:2]) for c in [*r, r[0]]], fill=255, width=px(4), joint="curve")
    inner = m.point(lambda v: 255 if v > 200 else 0).filter(ImageFilter.MinFilter(px(19)))
    put(mix(screen, 0.86), ImageChops.multiply(grooves, inner))
    art = pack / "art"
    stem = f"island-{name}" if name else "island"
    out.resize((W, H), Image.LANCZOS).save(art / f"{stem}.webp", "WEBP", quality=88, method=6)
    pts = {}
    for i in {i for i, _ in polys}:
        r = max((r for j, r in polys if j == i), key=len)
        cx, cy = sum(c[0] for c in r) / len(r), sum(c[1] for c in r) / len(r)
        x, y = P(cx, cy)
        pts[i] = [round(x / SS), round(y / SS)]
    meta = {"width": W, "height": H, "west": min(xs), "north": max(ys), "px_per_lng": round(kx * s, 3), "px_per_lat": round(s, 3), "pad": PAD, "areas": dict(sorted(pts.items()))}
    (art / f"{stem}.json").write_text(json.dumps(meta, indent=1) + "\n")
    print(art / f"{stem}.webp", W, H, "areas", len(pts))


# ---------------------------------------------------------------- sheet


def uri(p: Path) -> str:
    return f"data:{'image/webp' if p.suffix == '.webp' else 'image/svg+xml'};base64,{base64.b64encode(p.read_bytes()).decode()}"


async def sheet(pack: Path, out: Path, names: bool = True) -> None:
    art = pack / "art"
    th = yaml.safe_load((art / "theme.yaml").read_text()) if (art / "theme.yaml").exists() else {"screen": "#E6E4DF"}
    py = pack / "pack.yaml"
    name = ((yaml.safe_load(py.read_text()) or {}).get("name") or {}).get("ru", pack.name) if py.exists() else pack.name
    n = 0

    def inline(p: Path) -> str:
        nonlocal n
        n += 1
        s = re.sub(r'\bid="([^"]+)"', rf'id="u{n}-\1"', p.read_text())
        s = re.sub(r"url\(#([^)]+)\)", rf"url(#u{n}-\1)", s)
        return re.sub(r'href="#([^"]+)"', rf'href="#u{n}-\1"', s)

    def side(mode: str) -> str:
        night = mode == "dark"
        cells = ""
        for it in avatars(pack):
            bg = it["bg_dark" if night else "bg_light"]
            f = art / "avatars" / f"{it['slug']}.svg"
            t, tf = art / "toys" / f"{it['slug']}-384.webp", art / "toys" / f"{it['slug']}-full-384.webp"
            flat = "".join(f'<i class="d" style="width:{z}px;height:{z}px;background:{bg}">{inline(f)}</i>' for z in (64, 30, 24))
            toy = f'<div class="free"><img src="{uri(tf)}"></div><div class="disc" style="background:{bg}"><img src="{uri(t)}"></div>' if t.exists() else '<div class="free"></div>'
            cells += f'<div class="c"><div class="t">{toy}</div><div class="f">{flat}</div><p>{it["slug"] if names else "&nbsp;"}</p></div>'
        mot = ""
        mk, sc = (art / f"motif-{k}.svg" for k in ("mark", "scene"))
        if mk.exists() and sc.exists():
            mot = f'<div class="m" style="color:{PAPER if night else INK}"><div class="mk">{inline(mk)}</div><div class="mk s">{inline(mk)}</div><div class="sc">{inline(sc)}</div></div>'
        wide = not (art / "island.webp").exists()
        isl = f'<div class="isl"><img src="{uri(art / "island.webp")}"></div>' if (art / "island.webp").exists() else ""
        return f'<section class="{mode}"><b class="w">{name.split()[0]}</b><h1>{name}</h1>{isl}<div class="g{" w2" if wide else ""}">{cells}</div>{mot}</section>'

    html = f"""<!doctype html><meta charset=utf-8><style>*{{box-sizing:border-box;margin:0}}body{{width:1400px;font:500 14px 'Inter Tight',Inter,Arial,sans-serif}}
section{{position:relative;overflow:hidden;padding:40px}}.light{{background:{th.get('screen')};color:{INK}}}.dark{{background:{NIGHT};color:{PAPER}}}
h1{{font-size:56px;letter-spacing:-.055em;font-weight:800;position:relative}}.w{{position:absolute;left:300px;top:-40px;font-size:230px;font-weight:800;letter-spacing:-.05em;filter:blur(20px);opacity:.22;white-space:nowrap}}
.isl{{position:absolute;right:40px;top:40px;width:380px;height:520px;border-radius:40px;background:#9ED0F2;display:grid;place-items:center}}.isl img{{max-width:350px;max-height:490px}}.t{{display:flex;gap:14px;align-items:flex-end}}.g{{position:relative;display:grid;grid-template-columns:repeat(4,1fr);gap:28px;margin-top:30px;max-width:880px}}
.w2{{max-width:none}}.w2 .free,.w2 .free img{{height:200px}}.c p{{margin-top:6px}}.free{{height:130px}}.free img{{height:130px}}
.disc{{position:relative;flex:none;width:64px;height:64px;border-radius:50%;box-shadow:inset 0 0 0 5px #fff}}.disc img{{position:absolute;width:132%;left:-19.6%;top:-26%}}
.f{{display:flex;gap:8px;align-items:center;margin-top:8px}}.d{{border-radius:50%;overflow:hidden;display:inline-block}}.d svg,.m svg{{width:100%;height:100%;display:block}}
.m{{display:flex;gap:24px;align-items:center;margin-top:36px;position:relative}}.mk{{width:120px;height:120px}}.mk.s{{width:32px;height:32px}}.sc{{width:540px;height:240px}}</style>{side('light')}{side('dark')}"""
    async with Browser() as b:
        page = await b.b.new_page(viewport={"width": 1400, "height": 900})
        await page.set_content(html)
        await page.evaluate("Promise.all([...document.images].map(i => i.decode().catch(() => 0)))")
        out.parent.mkdir(parents=True, exist_ok=True)
        await page.screenshot(path=str(out), full_page=True)
    print(out)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    for c in ("check", "toys", "zoom", "island", "sheet", "toy"):
        p = sub.add_parser(c)
        p.add_argument("paths", nargs="+")
        p.add_argument("-o", "--out", default=f"{c}.png" if c in ("sheet", "zoom") else ".")
        p.add_argument("--areas", default="")
        p.add_argument("--name", default="", help="island: the city folder, for one city's land")
        p.add_argument("--no-names", action="store_true")
    a = ap.parse_args()
    if a.cmd == "check":
        bad = 0
        for p in a.paths:
            rep = check(Path(p).resolve())
            bad += len(rep.err)
            for e in rep.err:
                print(f"{Path(p).name}: ERROR {e}")
            for w in rep.warn:
                print(f"{Path(p).name}: look  {w}")
            print(f"{Path(p).name}: {'ok' if not rep.err else f'{len(rep.err)} errors'}")
        sys.exit(1 if bad else 0)
    if a.cmd == "toy":
        return asyncio.run(loose([Path(p) for p in a.paths], Path(a.out)))
    pack = Path(a.paths[0]).resolve()
    if a.cmd == "toys":
        asyncio.run(toys(pack, a.paths[1:]))
    elif a.cmd == "zoom":
        asyncio.run(zoom(pack, a.paths[1:], Path(a.out).resolve()))
    elif a.cmd == "island":
        if a.name and not SLUG.match(a.name):
            sys.exit("--name is a city folder")
        island(pack, [x for x in a.areas.split(",") if x], a.name)
    else:
        asyncio.run(sheet(pack, Path(a.out).resolve(), not a.no_names))


if __name__ == "__main__":
    main()
