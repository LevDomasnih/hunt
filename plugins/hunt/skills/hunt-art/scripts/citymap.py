# /// script
# requires-python = ">=3.11"
# dependencies = ["playwright==1.60.0", "pillow==11.3.0", "pyyaml==6.0.2", "numpy==2.3.3", "shapely==2.1.2", "h3==4.3.1", "certifi==2025.8.3"]
# ///
"""Hunt city map: the toy land of one city in 3D — the pack's districts minus rivers, cut into blocks by the real streets and raised
by their buildings, parks with trees, a few landmarks. The picture has no words: the app draws the district signs, river names and
prices itself through the affine map in the JSON (lon, lat -> pixel).

    uv run --script citymap.py fetch PACK CITY      OpenStreetMap layers + Kontur population -> ~/.cache/hunt/art/citymap/CITY
    uv run --script citymap.py build PACK CITY      -> PACK/art/island-CITY.webp + .json (v 2)
    uv run --script citymap.py all   PACK CITY      both

PACK/art/citymap.yaml (optional) per city: join (close gaps between areas, degrees), extend (bounding boxes [w, s, e, n] where
populated land joins the city, e.g. a bank of a river), names (short district names), pins (lon, lat of a sign), rivers
(name_ru, name_en, lon, lat, rotation), labels (id, name_ru, name_en, lon, lat: signs for places that are not pack areas),
landmarks (kind, name, lon, lat; kinds in citymap/houses.js), country (Kontur id, e.g. serbia), names_en (short English names),
skip (area ids left off the map, e.g. a town 100 km away), clip (boxes [w, s, e, n]: huge districts are cut to the town part),
trim (people per 400 m cell: the land ends where fewer live, a soft edge instead of the clip box),
trimb (OSM buildings per ~350 m cell: the same edge from the buildings, where Kontur and OSM disagree),
wild (true: land far from buildings is forest with trees, for islands and hills).
Data: © OpenStreetMap contributors (ODbL), Kontur Population (CC BY 4.0). Reads public APIs politely: one request at a time, retries.
"""
from __future__ import annotations

import argparse, asyncio, base64, csv, glob, gzip, io, json, math, mimetypes, os, re, sqlite3, ssl, statistics, sys, time
import urllib.parse, urllib.request
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
CACHE = Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache")) / "hunt" / "art" / "citymap"
HOSTS = ["https://maps.mail.ru/osm/tools/overpass/api/interpreter", "https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"]
DEADLINE = 300   # seconds per request: a mirror that holds the socket open without answering is dropped
UA = {"User-Agent": "HuntCityMap/1.0 (+read-only)"}


def tls():
    import certifi   # the Python build may come without a CA store
    return ssl.create_default_context(cafile=certifi.where())


def cfg_of(pack: Path, city: str) -> dict:
    f = pack / "art" / "citymap.yaml"
    c = ((yaml.safe_load(f.read_text()) or {}).get(city) or {}) if f.exists() else {}
    return {"join": 0, "extend": [], "names": {}, "pins": {}, "rivers": [], "landmarks": [], "country": None, "skip": [], "clip": [], **c}


def areas_of(pack: Path, city: str):
    """The city's areas, minus `skip` (areas too far to share one map) and cut to the `clip` boxes (huge districts: only the town part)."""
    from shapely.geometry import box, shape
    from shapely.ops import unary_union
    c = cfg_of(pack, city)
    gj = json.loads((pack / "districts.geojson").read_text())
    dy = yaml.safe_load((pack / "districts.yaml").read_text())["areas"]
    out = {f["properties"]["id"]: shape(f["geometry"]).buffer(0) for f in gj["features"] if dy.get(f["properties"]["id"], {}).get("city") == city and f["properties"]["id"] not in c["skip"]}
    if c["clip"]:
        cl = unary_union([box(*b) for b in c["clip"]])
        out = {k: a.intersection(cl).buffer(0) for k, a in out.items()}
        out = {k: a for k, a in out.items() if a.area > 1e-6}
    return out, dy


# ---------------------------------------------------------------- fetch
def fetch_by(h: str, body: str, end: float) -> bytes:
    """One Overpass request with a read timeout and a wall-clock deadline, so a silent or trickling mirror fails over."""
    rq = urllib.request.Request(h, data=urllib.parse.urlencode({"data": body}).encode(), headers=UA)
    with urllib.request.urlopen(rq, timeout=200, context=tls()) as f:
        buf = bytearray()
        while chunk := f.read1(1 << 16):   # read1 returns after each packet, so the deadline is checked
            buf += chunk
            if time.time() > end:
                raise TimeoutError("deadline")
        return bytes(buf)


def overpass(body: str, out: Path, ok, rounds: int = 5, hosts: list | None = None, deadline: int = DEADLINE) -> bool:
    if out.exists():
        return True
    for k in range(rounds):
        if k:
            time.sleep(30)
        for h in hosts or HOSTS:
            try:
                r = fetch_by(h, body, time.time() + deadline)
                if ok(r):
                    out.write_bytes(r); print(" ", out.name, f"{len(r) // 1024} KB", flush=True); return True
            except Exception as e:  # busy mirrors answer 429/504 or close the connection
                print(" ", out.name, "retry", h.split("/")[2], str(e)[:50], flush=True)
    print(" ", out.name, "FAILED", flush=True)
    return False


ROADS: dict = {}


def has_roads(D: Path, s0: float, w0: float, s1: float, w1: float) -> bool:
    """Whether any main or minor road runs through the tile: then an empty building answer is a busy mirror, not the sea."""
    if D not in ROADS:
        pts = []
        for f in ("roads.json", "roads2.json"):
            if (D / f).exists():
                pts += [(g["lat"], g["lon"]) for e in json.loads((D / f).read_text())["elements"] for g in e.get("geometry", [])]
        ROADS[D] = pts
    return any(s0 <= la <= s1 and w0 <= lo <= w1 for la, lo in ROADS[D])


def bld(D: Path, name: str, s0: float, w0: float, s1: float, w1: float, depth: int = 0) -> None:
    """Buildings of a tile (centre, levels) as CSV. Busy mirrors refuse heavy tiles, so a tile that fails once on the main
    mirror is fetched as four quarters, down to 1/256 of the tile (about 2 km); only those get every mirror and retries."""
    quarters = [(f"{name}-{q}", s0 + (s1 - s0) * a / 2, w0 + (w1 - w0) * b / 2) for q, (a, b) in enumerate([(0, 0), (0, 1), (1, 0), (1, 1)])]
    split = lambda: [bld(D, n, qa, qb, qa + (s1 - s0) / 2, qb + (w1 - w0) / 2, depth + 1) for n, qa, qb in quarters]
    if (D / f"{name}.csv").exists():
        return
    if glob.glob(str(D / f"{name}-*.csv")):   # quarters started earlier: finish them
        split()
        return
    land = has_roads(D, s0, w0, s1, w1)
    ok = lambda r: r.lstrip(b"-")[:1].isdigit() or (not r.strip() and not land)
    q_ = f'[out:csv(::lat,::lon,"building:levels","building";false)][timeout:250];way["building"]({s0:.4f},{w0:.4f},{s1:.4f},{w1:.4f});out center;'
    if depth < 4:
        if not overpass(q_, D / f"{name}.csv", ok, rounds=1, hosts=HOSTS[:1], deadline=150):
            split()
        return
    # a small tile with roads and no buildings (rice fields, forest) is real after two rounds of empty answers
    overpass(q_, D / f"{name}.csv", ok, rounds=2) or overpass(q_, D / f"{name}.csv", lambda r: r.lstrip(b"-")[:1].isdigit() or not r.strip(), rounds=3)


def fetch(pack: Path, city: str) -> None:
    from shapely.geometry import box
    from shapely.ops import unary_union
    c = cfg_of(pack, city)
    areas, _ = areas_of(pack, city)
    if not areas:
        sys.exit(f"{pack.name}: no areas with city: {city} in districts.yaml")
    u = unary_union(list(areas.values()) + [box(*b) for b in c["extend"]])
    W, S, E, N = u.bounds
    W, S, E, N = W - .012, S - .012, E + .012, N + .012
    D = CACHE / city; D.mkdir(parents=True, exist_ok=True)
    J = lambda r: r[:1] == b"{"
    bb = f"{S:.4f},{W:.4f},{N:.4f},{E:.4f}"
    print(city, bb, flush=True)
    overpass(f'[out:json][timeout:250];(way["natural"="water"]({bb});relation["natural"="water"]({bb});way["waterway"="riverbank"]({bb});way["natural"="coastline"]({bb}););out geom;', D / "water.json", J)
    overpass(f'[out:json][timeout:250];(way["leisure"="park"]({bb});way["landuse"="forest"]({bb});way["natural"="wood"]({bb});relation["leisure"="park"]({bb});relation["landuse"="forest"]({bb}););out geom;', D / "green.json", J)
    overpass(f'[out:json][timeout:250];way["highway"~"^(motorway|trunk|primary|secondary)$"]({bb});out geom;', D / "roads.json", J)
    overpass(f'[out:json][timeout:250];way["highway"~"^(tertiary|unclassified)$"]({bb});out geom;', D / "roads2.json", J)
    n = max(2, min(4, math.ceil(max((E - W) * math.cos(math.radians(S)), N - S) / 0.08)))
    for i in range(n):
        for j in range(n):
            s0, w0, s1, w1 = S + (N - S) * i / n, W + (E - W) * j / n, S + (N - S) * (i + 1) / n, W + (E - W) * (j + 1) / n
            t = f"{s0:.4f},{w0:.4f},{s1:.4f},{w1:.4f}"
            bld(D, f"bld-{i}{j}", s0, w0, s1, w1)
            overpass(f'[out:json][timeout:250];way["highway"~"^(residential|living_street)$"]({t});out geom;', D / f"res-{i}{j}.json", J)
    if c["country"] and not (D / "kontur.gpkg").exists():   # one download per country, shared by its cities
        K = CACHE / f"kontur-{c['country']}.gpkg"
        if not K.exists():
            try:   # HDX sometimes answers an empty 202 (its bot check); the map still builds without people, fetch again later
                meta = json.loads(urllib.request.urlopen(urllib.request.Request(f"https://data.humdata.org/api/3/action/package_show?id=kontur-population-{c['country']}", headers=UA), timeout=60, context=tls()).read())
                url = sorted(r["url"] for r in meta["result"]["resources"] if r["url"].endswith(".gpkg.gz"))[-1]
                K.write_bytes(gzip.decompress(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=600, context=tls()).read()))
                print("  kontur", url.rsplit("/", 1)[1], flush=True)
            except Exception as e:
                print("  kontur NOT FETCHED:", str(e)[:80], f"(id kontur-population-{c['country']} on data.humdata.org)", flush=True)
        if K.exists():
            (D / "kontur.gpkg").symlink_to(K)
    (D / "frame.json").write_text(json.dumps([W, S, E, N]))


# ---------------------------------------------------------------- prepare
def prepare(pack: Path, city: str) -> dict:
    import h3
    import numpy as np
    from PIL import Image, ImageDraw
    from shapely.geometry import LineString, MultiPolygon, Point, Polygon, box
    from shapely.ops import polygonize, unary_union
    from shapely.strtree import STRtree
    c = cfg_of(pack, city)
    D = CACHE / city
    if not (D / "frame.json").exists():
        sys.exit(f"no data for {city}: run fetch first")
    areas, dy = areas_of(pack, city)
    J = lambda f: json.loads((D / f).read_text()) if (D / f).exists() else {"elements": []}
    POP = []
    if (D / "kontur.gpkg").exists():
        FW, FS, FE, FN = json.loads((D / "frame.json").read_text())
        for cid, p in sqlite3.connect(D / "kontur.gpkg").execute("SELECT h3, population FROM population"):
            la, lo = h3.cell_to_latlng(cid)
            if FW < lo < FE and FS < la < FN:
                POP.append((lo, la, p, cid))
    land = unary_union([a.buffer(0.0009) for a in areas.values()]).buffer(-0.0006)
    if c["join"]:
        land = land.buffer(c["join"]).buffer(-c["join"])
    for b in c["extend"]:   # populated land inside the box joins the city (400 m cells with > 1500 people)
        cells = [Polygon([(lo, la) for la, lo in h3.cell_to_boundary(cid)]) for lo, la, p, cid in POP if b[0] < lo < b[2] and b[1] < la < b[3] and p > 1500]
        if cells:
            land = unary_union([land, unary_union(cells).buffer(0.002).buffer(-0.0016)])
    if c.get("trim") or c.get("trimb"):
        # the edge follows where the town is: `trim` = 400 m Kontur cells with more people than that, `trimb` = ~350 m cells
        # with more OSM buildings than that (for places where Kontur and OSM disagree); softened, parks inside stay land
        if c.get("trimb"):
            from collections import Counter
            cnt = Counter()
            for f in glob.glob(str(D / "bld-*.csv")):
                for r in csv.reader(open(f), delimiter="\t"):
                    if len(r) >= 2 and r[0].lstrip("-")[:1].isdigit():
                        cnt[h3.latlng_to_cell(float(r[0]), float(r[1]), 9)] += 1
            spots, lim = [(cid, n) for cid, n in cnt.items()], c["trimb"]
        else:
            spots, lim = [(cid, p) for lo, la, p, cid in POP], c["trim"]
        hexp = lambda cid: Polygon([(lo, la) for la, lo in h3.cell_to_boundary(cid)])
        cells = [hexp(cid) for cid, v in spots if v > lim]
        if cells:
            town = unary_union(cells).buffer(0.0045).buffer(-0.0065).buffer(0.003)
            town = unary_union([Polygon(g.exterior) for g in (town.geoms if hasattr(town, "geoms") else [town])])
            full = land
            land = land.intersection(town).buffer(0)
            if hasattr(land, "geoms"):   # no crumbs cut off by the edge
                big = max(g.area for g in land.geoms)
                land = unary_union([g for g in land.geoms if g.area > big * 0.02])
            for a in areas.values():     # an area is never cut away: a thin one keeps its most lived part
                if a.intersection(land).area < a.area * 0.08:
                    mine = sorted(((v, cid) for cid, v in spots if a.contains(Point(*h3.cell_to_latlng(cid)[::-1]))), reverse=True)
                    top = max(lim / 5, mine[len(mine) // 5][0]) if mine else 0   # its densest fifth
                    if mine:   # around its densest spot, ~1.3 km: a small town piece, not a field
                        c0 = Point(*h3.cell_to_latlng(mine[0][1])[::-1])
                        mine = [(v, cid) for v, cid in mine if Point(*h3.cell_to_latlng(cid)[::-1]).distance(c0) < 0.012]
                    own = [hexp(cid) for v, cid in mine if v >= top]
                    keep = unary_union(own).buffer(0.004).buffer(-0.003) if own else a
                    land = unary_union([land, keep.intersection(a.buffer(0.0009)).intersection(full)]).buffer(0)
    water = []
    for e in J("water.json")["elements"]:
        t = e.get("tags", {})
        if e["type"] == "way" and len(e.get("geometry") or []) > 3 and t.get("natural") != "coastline":
            pg = Polygon([(q["lon"], q["lat"]) for q in e["geometry"]])
            if pg.is_valid and (t.get("water") in ("river", "canal", "oxbow", "lake", "reservoir") or t.get("waterway") == "riverbank" or pg.area > 2e-6):
                water.append(pg)
        elif e["type"] == "relation":
            ws = [LineString([(q["lon"], q["lat"]) for q in m["geometry"]]) for m in e.get("members", []) if m.get("role") == "outer" and m.get("geometry")]
            water += list(polygonize(unary_union(ws)))
    if water:
        wu = unary_union([w.buffer(0) for w in water]).buffer(-0.00035).buffer(0.00055)   # rivers and lakes; channels under ~70 m vanish
        land = land.difference(wu).buffer(0)
    # the sea: OSM coastlines cut the frame into pieces; pieces with no buildings in them are sea (district outlines often run into it)
    coast = [LineString([(q["lon"], q["lat"]) for q in e["geometry"]]) for e in J("water.json")["elements"] if e["type"] == "way" and e.get("tags", {}).get("natural") == "coastline" and len(e.get("geometry") or []) > 1]
    if coast:
        FW, FS, FE, FN = json.loads((D / "frame.json").read_text())
        bpts = []
        for f in sorted(glob.glob(str(D / "bld-*.csv"))):
            for r in csv.reader(open(f), delimiter="\t"):
                if len(r) >= 2 and r[0].lstrip("-")[:1].isdigit():
                    bpts.append(Point(float(r[1]), float(r[0])))
        btree = STRtree(bpts) if bpts else None
        sea = [pg for pg in polygonize(unary_union(coast + [box(FW, FS, FE, FN).boundary])) if btree is not None and len(btree.query(pg, predicate="contains")) < max(3, pg.area * 2e4)]
        if sea:
            land = land.difference(unary_union(sea).buffer(0.0002)).buffer(0)
    if isinstance(land, MultiPolygon):
        land = unary_union([g for g in land.geoms if g.area > 1.5e-6])
    W0, S0, E0, N0 = (lambda b: (b[0] - .006, b[1] - .006, b[2] + .006, b[3] + .006))(land.bounds)
    KX = math.cos(math.radians((S0 + N0) / 2))
    GW = 1200
    GH = round(GW * (N0 - S0) / ((E0 - W0) * KX))
    P = lambda lon, lat: ((lon - W0) / (E0 - W0) * GW, (N0 - lat) / (N0 - S0) * GH)
    rnd1 = lambda v: round(v, 1)
    mask = Image.new("L", (GW, GH), 0); d = ImageDraw.Draw(mask)
    for g in (land.geoms if hasattr(land, "geoms") else [land]):
        d.polygon([P(*q) for q in g.exterior.coords], fill=255)
        for r in g.interiors:
            d.polygon([P(*q) for q in r.coords], fill=0)
    # labels: short names at a point inside each area
    short = lambda s: re.split(r",| и ", s)[0].strip()
    labels = []
    for k, a in areas.items():
        part = a.intersection(land)
        if part.is_empty:
            continue
        big = max(part.geoms, key=lambda g: g.area) if hasattr(part, "geoms") else part
        pt = Point(*c["pins"][k]) if k in c["pins"] else (big.centroid if big.contains(big.centroid) else big.representative_point())
        x, y = P(pt.x, pt.y)
        en = (c.get("names_en") or {}).get(k) or re.split(r",| and |\(", dy[k]["name"]["en"])[0].strip()
        labels.append({"id": k, "text": c["names"].get(k) or short(dy[k]["name"]["ru"]), "en": en, "x": round(x), "y": round(y), "size": 1})
    for lid, ru, en, lo, la in c.get("labels", []):   # places that are not pack areas, e.g. a bank joined by `extend`
        if land.buffer(0.002).contains(Point(lo, la)):
            x, y = P(lo, la); labels.append({"id": lid, "text": ru, "en": en, "x": round(x), "y": round(y), "size": 1})
    for r in c["rivers"]:
        x, y = P(r[2], r[3]); labels.append({"id": r[0], "text": r[0], "en": r[1], "x": round(x), "y": round(y), "river": True, "rot": r[4] if len(r) > 4 else 0})
    polys = [[[[rnd1(v) for v in P(*q)] for q in g.simplify(0.00012).exterior.coords]] + [[[rnd1(v) for v in P(*q)] for q in r.coords] for r in g.simplify(0.00012).interiors if Polygon(r).area > 2e-7]
             for g in (land.geoms if hasattr(land, "geoms") else [land])]
    # parks
    gs = []
    for e in J("green.json")["elements"]:
        if e["type"] == "way" and len(e.get("geometry") or []) > 3:
            gs.append(Polygon([(q["lon"], q["lat"]) for q in e["geometry"]]).buffer(0))
        elif e["type"] == "relation":
            ws = [LineString([(q["lon"], q["lat"]) for q in m["geometry"]]) for m in e.get("members", []) if m.get("role") == "outer" and m.get("geometry")]
            gs += list(polygonize(unary_union(ws)))
    gu = unary_union([g for g in gs if g.area > 4e-6]).intersection(land.buffer(-0.0004)) if gs else Polygon()
    if c.get("wild"):   # islands and hills: land ~300 m away from any building is jungle / forest (OSM rarely maps it)
        pts = []
        for f in glob.glob(str(D / "bld-*.csv")):
            for r in csv.reader(open(f), delimiter="\t"):
                if len(r) >= 2 and r[0].lstrip("-")[:1].isdigit():
                    pts.append(Point(float(r[1]), float(r[0])))
        built = unary_union([q.buffer(0.0028, 4) for q in pts]) if pts else Polygon()
        gu = unary_union([gu, land.buffer(-0.0006).difference(built).buffer(-0.0005).buffer(0.0005)])
    green = [[[[rnd1(v) for v in P(*q)] for q in g.simplify(0.0001).exterior.coords]] for g in (gu.geoms if hasattr(gu, "geoms") else [gu]) if not g.is_empty and g.geom_type == "Polygon" and g.area > 6e-6]
    # district borders
    from shapely.ops import linemerge
    borders, inner = [], land.buffer(-0.0004)
    g = unary_union([a.boundary for a in areas.values()]).intersection(inner)   # shared borders once
    g = linemerge(g) if g.geom_type in ("MultiLineString", "LineString") else g
    for ln in (g.geoms if hasattr(g, "geoms") else [g]):
        if not ln.is_empty and ln.geom_type == "LineString" and ln.length > 0.002:
            borders.append([[rnd1(v) for v in P(*q)] for q in ln.simplify(0.00008).coords])
    # buildings
    RAW = []
    for f in sorted(glob.glob(str(D / "bld-*.csv"))):
        for r in csv.reader(open(f), delimiter="\t"):
            if len(r) >= 2 and r[0].lstrip("-")[:1].isdigit():
                lo, la = float(r[1]), float(r[0])
                if W0 < lo < E0 and S0 < la < N0:
                    RAW.append((lo, la, r[2] if len(r) > 2 else ""))
    LM = c["landmarks"]
    landmarks = [{"kind": k, "name": n, "x": rnd1(P(lo, la)[0]), "y": rnd1(P(lo, la)[1])} for k, n, lo, la in LM if land.buffer(0.002).contains(Point(lo, la))]
    # blocks: the land cut by streets, raised by the buildings in them (people per km² where OSM has few buildings)
    lines = []
    for f in ["roads.json", "roads2.json"] + [Path(x).name for x in sorted(glob.glob(str(D / "res-*.json")))]:
        for e in J(f)["elements"]:
            if e["type"] == "way" and len(e.get("geometry") or []) > 1:
                lines.append(LineString([(q["lon"], q["lat"]) for q in e["geometry"]]))
    blocks = []
    if lines:
        holes = unary_union([gu.buffer(0.0002)] + [Point(lo, la).buffer(0.0016 if k in ("fortress", "arena", "wat", "palace", "mosque", "chedi", "pura", "khanshatyr", "buddha", "statue") else 0.0011) for k, n, lo, la in LM])
        pts = [Point(q[0], q[1]) for q in RAW]; tree = STRtree(pts) if pts else None
        ppts = [Point(q[0], q[1]) for q in POP]; ptree = STRtree(ppts) if ppts else None
        def lvl(v):
            try: return float(v)
            except ValueError: return None
        for pg in polygonize(unary_union(lines + [land.boundary])):
            pg = pg.intersection(land)
            for part in (pg.geoms if hasattr(pg, "geoms") else [pg]):
                if part.geom_type != "Polygon" or part.area < 2.5e-7:
                    continue
                inner_ = part.buffer(-0.0002).buffer(0.00008).difference(holes)
                if inner_.is_empty:
                    continue
                idx = tree.query(part, predicate="contains") if tree is not None else []
                lvs = [v for v in (lvl(RAW[i][2]) for i in idx) if v]
                lv = statistics.median(lvs) if lvs else (2 if len(idx) else 0)
                dens = len(idx) / max(part.area / 1e-6, 0.05)
                if c.get("lvd") and len(lvs) < 2 and len(idx) >= 6:   # OSM has no levels here: dense blocks are the taller core
                    lv = 7 if dens > c["lvd"] * 2.5 else 4 if dens > c["lvd"] else 2
                if len(lvs) >= 2 and lv >= 5:   # a few big towers on a superblock (new centres) are still city, not a field
                    dens = max(dens, 8)
                near = ptree.query(part.buffer(0.002)) if ptree is not None else []
                popd = (sum(POP[i][2] for i in near) / len(near)) / 0.74 if len(near) else 0
                if len(idx) < 6 and popd > 3000:
                    dens = max(dens, popd / 2500)
                    lv = 8 if popd > 16000 else 5 if popd > 9000 else 2
                for q_ in (inner_.geoms if hasattr(inner_, "geoms") else [inner_]):
                    if q_.geom_type == "Polygon" and q_.area > 1.2e-7:
                        blocks.append({"lv": round(lv, 1), "d": round(dens, 1), "p": [[[rnd1(v) for v in P(*q)] for q in q_.simplify(0.00005).exterior.coords]]})
    b64 = lambda im: (lambda b: (im.save(b, "PNG"), "data:image/png;base64," + base64.b64encode(b.getvalue()).decode())[1])(io.BytesIO())
    blank = Image.new("L", (GW, GH), 0)
    screen = yaml.safe_load((pack / "art" / "theme.yaml").read_text())["screen"]
    print(f"  land {GW}x{GH}, blocks {len(blocks)}, parks {len(green)}, landmarks {len(landmarks)}, buildings {len(RAW)}, people cells {len(POP)}", flush=True)
    return {"frame": {"west": W0, "east": E0, "south": S0, "north": N0}, "blocks": blocks, "roads": [], "landmarks": landmarks, "bld": [], "green": green, "borders": borders,
            "hexes": [], "tiers": [], "towers": [], "land": polys, "w": GW, "h": GH, "mask": b64(mask), "water": b64(blank), "height": b64(blank), "heat": b64(blank),
            "labels": labels, "screen": screen}


# ---------------------------------------------------------------- render
async def render(scene: dict, opts: dict) -> dict:
    sys.path.insert(0, str(HERE))
    from art import chromium, three  # the same cached three.js and Chromium as the toys
    from playwright.async_api import async_playwright
    lib = three()
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=chromium(), args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        page = await b.new_page(viewport={"width": 400, "height": 300})
        page.on("pageerror", lambda e: print("  [page]", e, file=sys.stderr))

        async def serve(route):
            path = route.request.url.split("citymap.local", 1)[1].split("?")[0].lstrip("/") or "scene.html"
            f = lib / path.removeprefix("node_modules/three/") if path.startswith("node_modules/three/") else HERE / "citymap" / path
            if not f.is_file():
                return await route.fulfill(status=404, body="")
            await route.fulfill(status=200, body=f.read_bytes(), headers={"content-type": "text/javascript" if f.suffix == ".js" else mimetypes.guess_type(str(f))[0] or "text/html"})

        await page.route("http://citymap.local/**", serve)
        await page.goto("http://citymap.local/scene.html")
        await page.wait_for_function("window.ready === true")
        r = await page.evaluate("([s, o]) => window.render(s, o)", [scene, opts])
        await b.close()
    return r


def build(pack: Path, city: str) -> None:
    from PIL import Image
    scene = prepare(pack, city)
    opts = {"tilt": 52, "ortho": True, "export": True, "width": int(os.environ.get("CITYMAP_WIDTH", 2000)), "blocks": True, "minD": 1.2, "bigD": 6,
            "real": True, "diorama": True, "dioK": 0, "lmScale": 1, "trees": True, "green": True, "borders": False, "dist": 3000}   # borders: live walls in the app
    r = asyncio.run(render(scene, opts))
    im = Image.open(io.BytesIO(base64.b64decode(r["png"].split(",")[1]))).convert("RGBA")
    art = pack / "art"
    im.save(art / f"island-{city}.webp", "WEBP", quality=86, method=6)
    meta = r["meta"]
    meta["areas"] = dict(sorted(meta["areas"].items()))
    meta["names"] = {l["id"]: {"ru": l["text"], "en": l["en"]} for l in sorted(scene["labels"], key=lambda l: l["id"]) if not l.get("river")}
    (art / f"island-{city}.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1) + "\n")
    print(art / f"island-{city}.webp", im.size, f"{(art / f'island-{city}.webp').stat().st_size // 1024} KB", flush=True)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("cmd", choices=["fetch", "build", "all"])
    ap.add_argument("pack")
    ap.add_argument("city")
    a = ap.parse_args()
    pack = Path(a.pack).resolve()
    if a.cmd in ("fetch", "all"):
        fetch(pack, a.city)
    if a.cmd in ("build", "all"):
        build(pack, a.city)


if __name__ == "__main__":
    main()
