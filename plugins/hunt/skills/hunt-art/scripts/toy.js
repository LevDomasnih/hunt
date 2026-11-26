// Vinyl-toy renderer for Hunt animal avatars.
//
// Idea: every SVG leaf element (path / circle / ellipse / rect / polygon, fills
// AND strokes) is rasterised into a mask, turned into a signed distance field and
// "inflated" into a soft pillow heightfield. Big shapes that start a new silhouette
// ("base" layers) get a thick rounded front + back; shapes that sit on top of
// earlier ones ("features") are embossed on the surface below them (eyes become
// glossy beads, noses rounded buttons, markings thin raised plates). Everything
// is shaded as glossy plastic (MeshPhysicalMaterial + clearcoat) in a soft studio
// environment, with a contact shadow on a transparent background.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const VB = 96;          // avatar viewBox size
const MARGIN = 8;       // units of empty border around the viewBox
const CPU = 4;          // grid cells per SVG unit
const W = (VB + 2 * MARGIN) * CPU + 1; // grid vertices per side
const NPIX = W * W;

// ---------- SVG -> leaf elements ----------

function leafElements(svgText) {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const root = doc.documentElement;
  const out = [];
  const walk = (el, chain) => {
    for (const c of el.children) {
      const tag = c.tagName.toLowerCase();
      if (tag === 'g') walk(c, [...chain, c]);
      else if (['path', 'circle', 'ellipse', 'rect', 'polygon', 'polyline', 'line'].includes(tag)) out.push({ el: c, chain });
    }
  };
  walk(root, []);
  return out.map(({ el, chain }) => {
    const attr = (name) => {
      if (el.getAttribute(name) != null) return el.getAttribute(name);
      for (let i = chain.length - 1; i >= 0; i--) if (chain[i].getAttribute(name) != null) return chain[i].getAttribute(name);
      return null;
    };
    let opacity = 1;
    for (const n of [el, ...chain]) if (n.getAttribute('opacity') != null) opacity *= parseFloat(n.getAttribute('opacity'));
    const fill = attr('fill');
    const stroke = attr('stroke');
    const color = fill && fill !== 'none' ? fill : stroke && stroke !== 'none' ? stroke : '#000';
    const open = chain.map((g) => {
      const a = [...g.attributes].map((x) => `${x.name}="${x.value}"`).join(' ');
      return `<g ${a}>`;
    }).join('');
    const close = chain.map(() => '</g>').join('');
    const tag = el.tagName.toLowerCase();
    const info = { tag, cx: +el.getAttribute('cx') || 0, cy: +el.getAttribute('cy') || 0, r: +el.getAttribute('r') || 0, rx: +el.getAttribute('rx') || 0, ry: +el.getAttribute('ry') || 0, transformed: chain.length > 0 || el.hasAttribute('transform') };
    const elXml = new XMLSerializer().serializeToString(el).replace(/\sopacity="[^"]*"/, '');
    return { markup: open + elXml + close, color, opacity, info, isStroke: !(fill && fill !== 'none') };
  });
}

async function rasterize(markup) {
  const size = W;
  const x0 = -MARGIN - 0.5 / CPU;
  const span = size / CPU;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${x0} ${x0} ${span} ${span}">${markup.replace(/xmlns="[^"]*"/g, '')}</svg>`;
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await img.decode();
  const cv = new OffscreenCanvas(size, size);
  const ctx = cv.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, size, size).data;
  const a = new Float32Array(NPIX);
  for (let i = 0; i < NPIX; i++) a[i] = data[i * 4 + 3] / 255;
  return a;
}

// ---------- distance fields ----------

const INF = 1e20;
function edt1d(f, n, d, v, z) {
  let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
}
// squared euclidean distance (in cells) to the nearest cell where target(i) is true
function edt(target) {
  const g = new Float64Array(NPIX);
  for (let i = 0; i < NPIX; i++) g[i] = target(i) ? 0 : INF;
  const f = new Float64Array(W), d = new Float64Array(W), v = new Int32Array(W), z = new Float64Array(W + 1);
  for (let x = 0; x < W; x++) { for (let y = 0; y < W; y++) f[y] = g[y * W + x]; edt1d(f, W, d, v, z); for (let y = 0; y < W; y++) g[y * W + x] = d[y]; }
  for (let y = 0; y < W; y++) { for (let x = 0; x < W; x++) f[x] = g[y * W + x]; edt1d(f, W, d, v, z); for (let x = 0; x < W; x++) g[y * W + x] = d[x]; }
  return g;
}
// signed distance in SVG units: negative inside
function sdfFromAlpha(a) {
  const din = edt((i) => a[i] < 0.5);
  const dout = edt((i) => a[i] >= 0.5);
  const s = new Float32Array(NPIX);
  for (let i = 0; i < NPIX; i++) {
    let v;
    if (a[i] >= 0.5) v = -(Math.sqrt(din[i]) - 0.5); else v = Math.sqrt(dout[i]) - 0.5;
    if (a[i] > 0.02 && a[i] < 0.98) v = 0.5 - a[i]; // sub-cell edge from antialiasing
    s[i] = v / CPU;
  }
  return s;
}
function blur(src, radiusCells, passes = 3) {
  let a = Float32Array.from(src), b = new Float32Array(NPIX);
  const r = Math.max(1, Math.round(radiusCells));
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < W; y++) { let acc = 0; const row = y * W;
      for (let x = -r; x <= r; x++) acc += a[row + Math.min(W - 1, Math.max(0, x))];
      for (let x = 0; x < W; x++) { b[row + x] = acc / (2 * r + 1); acc += a[row + Math.min(W - 1, x + r + 1)] - a[row + Math.max(0, x - r)]; } }
    for (let x = 0; x < W; x++) { let acc = 0;
      for (let y = -r; y <= r; y++) acc += b[Math.min(W - 1, Math.max(0, y)) * W + x];
      for (let y = 0; y < W; y++) { a[y * W + x] = acc / (2 * r + 1); acc += b[Math.min(W - 1, y + r + 1) * W + x] - b[Math.max(0, y - r) * W + x]; } }
  }
  return a;
}

// ---------- layer heights ----------

const smin = (a, b, k) => { const h = Math.max(0, Math.min(1, 0.5 + 0.5 * (b - a) / k)); return b * (1 - h) + a * h - k * h * (1 - h); };
const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

export async function buildLayers(svgText, opt = {}) {
  const leaves = leafElements(svgText);
  const eyeScale = opt.eyeScale ?? 1.2;
  // eyes = small dark circles; a small light circle inside one is its printed highlight.
  // Highlights are dropped (the glossy bead + a catch-light sphere replace them) and
  // eyes get a bit bigger, which is most of what makes a toy read as cute.
  const dark = leaves.filter((l) => l.info.tag === 'circle' && !l.info.transformed && lum(new THREE.Color(l.color)) < 0.03 && l.info.r <= 5);
  for (const l of leaves) {
    if (l.info.tag !== 'circle' || l.info.r > 1.8 || lum(new THREE.Color(l.color)) < 0.6) continue;
    const host = dark.find((d) => Math.hypot(d.info.cx - l.info.cx, d.info.cy - l.info.cy) < d.info.r);
    if (host) { l.skip = true; host.eye = true; host.hl = [l.info.cx - host.info.cx, l.info.cy - host.info.cy, l.info.r]; }
  }
  for (const l of leaves) {
    if (!l.eye) continue;
    const r = l.info.r * eyeScale;
    l.markup = l.markup.replace(/\sr="[^"]*"/, ` r="${r.toFixed(3)}"`);
    l.hl = l.hl.map((v) => v * eyeScale);
  }
  const layers = [];
  for (const lf of leaves) {
    if (lf.skip) continue;
    const alpha = await rasterize(lf.markup);
    let area = 0; for (let i = 0; i < NPIX; i++) if (alpha[i] >= 0.5) area++;
    if (area < 3) continue;
    // consecutive same-colour shapes that overlap (head = two circles + an ellipse,
    // leg + toes) become one piece of plastic instead of separate pillows
    const prev = layers[layers.length - 1];
    if (prev && !prev.eye && !lf.eye && prev.opacity === 1 && lf.opacity === 1 &&
        new THREE.Color(prev.color).getHex() === new THREE.Color(lf.color).getHex()) {
      let inter = 0; for (let i = 0; i < NPIX; i++) if (alpha[i] >= 0.5 && prev.alpha[i] >= 0.5) inter++;
      if (inter > 0.02 * Math.min(area, prev.area)) {
        for (let i = 0; i < NPIX; i++) if (alpha[i] > prev.alpha[i]) prev.alpha[i] = alpha[i];
        prev.area += area - inter;
        prev.info = { ...prev.info, tag: 'merged' };
        continue;
      }
    }
    layers.push({ ...lf, alpha, area });
  }

  const H = new Float32Array(NPIX);          // current top surface
  const union = new Uint8Array(NPIX);        // covered so far
  const topColor = new Array(NPIX).fill(null);
  const out = [];
  let baseIndex = 0;
  for (const l of layers) {
    if (l.skip) continue;
    const sdf = sdfFromAlpha(l.alpha);
    let maxD = 0, covered = 0, cx = 0, cy = 0;
    for (let i = 0; i < NPIX; i++) if (sdf[i] < 0) { maxD = Math.max(maxD, -sdf[i]); if (union[i]) covered++; cx += i % W; cy += (i / W) | 0; }
    const inside = covered + 0.0001;
    let n = 0; for (let i = 0; i < NPIX; i++) if (sdf[i] < 0) n++;
    const coverage = covered / Math.max(1, n);
    cx /= n; cy /= n;
    let color = new THREE.Color(l.color);
    if (l.opacity < 1) {
      const under = topColor[Math.round(cy) * W + Math.round(cx)];
      if (under) color = under.clone().lerp(color, l.opacity);
    }
    const base = coverage < 0.6;
    const S = new Float32Array(NPIX);
    const E = new Float32Array(NPIX);
    const dIn = new Float32Array(NPIX);
    for (let i = 0; i < NPIX; i++) dIn[i] = Math.max(0, -sdf[i]);
    const dSoft = blur(dIn, maxD * CPU * 0.25);
    let softMax = 0; for (let i = 0; i < NPIX; i++) softMax = Math.max(softMax, dSoft[i]);
    let R, A, B, back = 0, zoff = 0, kind;
    if (base) {
      kind = 'base';
      R = Math.min(maxD, 2.6 + 0.36 * maxD);
      A = R;
      B = 0.42 * Math.max(0, maxD - R * 0.5);
      back = 0.75;
      zoff = baseIndex * 0.35;
      baseIndex++;
    } else if (maxD <= 4.2) {
      kind = l.eye ? 'eye' : 'bead';
      R = maxD; A = maxD * (l.eye ? 0.95 : 0.7); B = 0;
    } else {
      kind = 'plate';
      R = 1.3; A = 0.9; B = Math.min(0.12 * maxD, 1.6);
    }
    let Hb = H;
    if (!base && coverage < 0.999) {
      // a feature hanging over the silhouette (an eye on the edge of the head):
      // carry the surface height outward instead of dropping to zero
      const U = new Float32Array(NPIX), HU = new Float32Array(NPIX);
      for (let i = 0; i < NPIX; i++) { U[i] = union[i]; HU[i] = H[i] * union[i]; }
      const r = Math.max(2, maxD * CPU * 0.8);
      const Ub = blur(U, r, 2), HUb = blur(HU, r, 2);
      Hb = Float32Array.from(H);
      for (let i = 0; i < NPIX; i++) if (sdf[i] < 0.5 && !union[i] && Ub[i] > 1e-3) Hb[i] = HUb[i] / Ub[i];
    }
    for (let i = 0; i < NPIX; i++) {
      const d = dIn[i];
      const s = Math.min(1, d / R);
      const edge = Math.sqrt(Math.max(0, 1 - (1 - s) * (1 - s)));
      const t = softMax > 0 ? dSoft[i] / softMax : 0;
      const dome = 1 - (1 - t) * (1 - t);
      const puff = A * edge + B * dome;
      E[i] = A * edge;
      S[i] = base ? zoff + puff : Hb[i] + puff;
    }
    {
      // kill distance-field terracing: soften the height inside the shape (rim stays exact)
      const Sb = blur(S, 1.5, 2);
      for (let i = 0; i < NPIX; i++) if (dIn[i] > 0.6) { const w = Math.min(1, (dIn[i] - 0.6) / 0.8); S[i] = S[i] * (1 - w) + Sb[i] * w; }
    }
    out.push({ kind, coverage, share: n, color, sdf, S, E, A, R, back: base ? { zoff, puff: (i) => (S[i] - zoff) * back } : null, base, eye: !!l.eye, hl: l.hl, maxD, isStroke: l.isStroke, index: out.length });
    for (let i = 0; i < NPIX; i++) if (sdf[i] < 0) { if (S[i] > H[i] || !union[i]) H[i] = base ? Math.max(H[i], S[i]) : S[i]; union[i] = 1; topColor[i] = color; }
  }
  // earlier base layers tuck under later base layers (ears behind the head, legs behind the body)
  for (let j = 0; j < out.length; j++) {
    if (!out[j].base) continue;
    for (let k = j + 1; k < out.length; k++) {
      if (!out[k].base) continue;
      const a = out[j], b = out[k];
      for (let i = 0; i < NPIX; i++) {
        if (a.sdf[i] < 0 && b.sdf[i] < 0.6) {
          const lim = (b.sdf[i] < 0 ? b.S[i] : b.back.zoff) - 0.4;
          a.S[i] = smin(a.S[i], lim, 1.2);
        }
      }
    }
  }
  return out;
}

// ---------- meshes ----------

const dMap = (d, R) => R * (1 - Math.cos(Math.PI / 2 * d / R));

function layerGeometry(L) {
  const { sdf, S } = L;
  const idx = new Int32Array(NPIX).fill(-1);
  const pos = [];
  const activeCell = (x, y) => {
    const i = y * W + x;
    return sdf[i] < 0 || sdf[i + 1] < 0 || sdf[i + W] < 0 || sdf[i + W + 1] < 0;
  };
  const vert = (x, y) => {
    const i = y * W + x;
    if (idx[i] >= 0) return idx[i];
    let px = x, py = y, z;
    if (sdf[i] < 0) {
      z = S[i];
      const d = -sdf[i];
      if (d < L.R) {
        // re-space the rim: pull vertices outward so the steep rounded edge gets
        // evenly sampled (otherwise the grid shows as ribs along diagonal edges)
        const dm = dMap(d, L.R);
        const gx = (sdf[y * W + Math.min(W - 1, x + 1)] - sdf[y * W + Math.max(0, x - 1)]);
        const gy = (sdf[Math.min(W - 1, y + 1) * W + x] - sdf[Math.max(0, y - 1) * W + x]);
        const gl = Math.hypot(gx, gy);
        if (gl > 1e-6) { const sh = (d - dm) * CPU; px = x + gx / gl * sh; py = y + gy / gl * sh; }
        const sN = dm / L.R;
        z = S[i] - L.E[i] + L.A * Math.sqrt(Math.max(0, 1 - (1 - sN) * (1 - sN)));
      }
    }
    else {
      // snap outside vertex onto the contour along the sdf gradient
      const gx = (sdf[y * W + Math.min(W - 1, x + 1)] - sdf[y * W + Math.max(0, x - 1)]) * 0.5;
      const gy = (sdf[Math.min(W - 1, y + 1) * W + x] - sdf[Math.max(0, y - 1) * W + x]) * 0.5;
      const g2 = gx * gx + gy * gy;
      if (g2 > 1e-8) { const k = sdf[i] / g2; px = x - gx * k; py = y - gy * k; }
      // edge height: base layers meet their back at zoff; features follow the neighbour's height
      if (L.base) z = L.back.zoff;
      else {
        let zz = 0, nn = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
          const j = (y + dy) * W + (x + dx);
          if (sdf[j] < 0) { zz += S[j]; nn++; }
        }
        z = nn ? zz / nn : 0;
      }
    }
    idx[i] = pos.length / 3;
    pos.push((px / CPU - MARGIN) - VB / 2, -((py / CPU - MARGIN) - VB / 2), z);
    return idx[i];
  };
  const front = [];
  for (let y = 0; y < W - 1; y++) for (let x = 0; x < W - 1; x++) {
    if (!activeCell(x, y)) continue;
    const a = vert(x, y), b = vert(x + 1, y), c = vert(x, y + 1), d = vert(x + 1, y + 1);
    front.push(a, c, b, b, c, d);
  }
  const indices = [...front];
  let backIdx = null;
  if (L.base) {
    // back: duplicate interior vertices, share the rim
    backIdx = new Map();
    var backOf = [];
    const nFront = pos.length / 3;
    for (let i = 0; i < NPIX; i++) {
      if (idx[i] < 0 || sdf[i] >= 0) continue;
      const v = idx[i];
      backIdx.set(v, pos.length / 3);
      pos.push(pos[v * 3], pos[v * 3 + 1], L.back.zoff - L.back.puff(i));
      backOf.push([v, i]);
    }
    for (let t = 0; t < front.length; t += 3) {
      const m = (v) => (backIdx.has(v) ? backIdx.get(v) : v);
      indices.push(m(front[t]), m(front[t + 2]), m(front[t + 1]));
    }
    void nFront;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(indices);
  // smooth analytic normals: the rounded rim is too steep for a grid, so take the
  // edge-profile slope from its formula and only the gentle rest numerically
  const nrm = new Float32Array(pos.length);
  const { E, A, R } = L;
  const at = (arr, x, y) => arr[Math.min(W - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))];
  const slope = (i) => {
    const x = i % W, y = (i / W) | 0;
    let gx = (at(sdf, x + 1, y) - at(sdf, x - 1, y)) * CPU / 2, gy = (at(sdf, x, y + 1) - at(sdf, x, y - 1)) * CPU / 2;
    const gl = Math.hypot(gx, gy) || 1; gx /= gl; gy /= gl; // outward unit (pixel axes)
    const d0 = Math.max(0, -sdf[i]);
    const d = d0 < R ? dMap(d0, R) : d0;
    const sN = Math.min(1, Math.max(0.03, d / R));
    const dE = sN >= 1 ? 0 : A / R * (1 - sN) / Math.sqrt(Math.max(1e-4, 1 - (1 - sN) * (1 - sN)));
    const rest = (xx, yy) => { const j = Math.min(W - 1, Math.max(0, yy)) * W + Math.min(W - 1, Math.max(0, xx)); return sdf[j] < 0 ? S[j] - E[j] : S[i] - E[i]; };
    const rx = (rest(x + 1, y) - rest(x - 1, y)) * CPU / 2, ry = (rest(x, y + 1) - rest(x, y - 1)) * CPU / 2;
    // dS/dpx = dE/dd * dd/dpx (d grows inward = -outward) + rest
    return [-dE * gx + rx, -dE * gy + ry, gx, gy];
  };
  for (let i = 0; i < NPIX; i++) {
    const v = idx[i]; if (v < 0) continue;
    const [sx, sy, ox, oy] = slope(i);
    let n;
    if (sdf[i] >= 0) n = L.base ? [ox, -oy, 0] : [ox, -oy, 0.6];
    else n = [-sx, sy, 1]; // svg y down -> world y up
    const l = Math.hypot(...n) || 1;
    nrm[v * 3] = n[0] / l; nrm[v * 3 + 1] = n[1] / l; nrm[v * 3 + 2] = n[2] / l;
  }
  if (L.base) for (const [v, i] of backOf) {
    const b = backIdx.get(v);
    const k = 0.75;
    const [sx, sy] = slope(i);
    const n = [-sx * k, sy * k, -1];
    const l = Math.hypot(...n);
    nrm[b * 3] = n[0] / l; nrm[b * 3 + 1] = n[1] / l; nrm[b * 3 + 2] = n[2] / l;
  }
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return geo;
}

function material(L) {
  const c = L.color;
  const l = lum(c);
  const m = new THREE.MeshPhysicalMaterial({
    color: c,
    roughness: L.eye ? 0.12 : l > 0.7 ? 0.42 : 0.34,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: L.eye ? 0.02 : 0.1,
    sheen: 0.25,
    sheenColor: new THREE.Color(1, 1, 1),
    sheenRoughness: 0.6,
    envMapIntensity: 1.0,
    side: L.base ? THREE.FrontSide : THREE.DoubleSide,
    polygonOffset: !L.base,
    polygonOffsetFactor: -1 - L.index * 0.05,
    polygonOffsetUnits: -2 - L.index * 2,
  });
  return m;
}

function shadowTexture() {
  const s = 256;
  const cv = document.createElement('canvas'); cv.width = cv.height = s;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(0.35, 'rgba(0,0,0,0.32)');
  g.addColorStop(0.7, 'rgba(0,0,0,0.08)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------- scene ----------

let renderer, pmrem, envTex;
function getRenderer(size) {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true, premultipliedAlpha: false });
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.setClearColor(0x000000, 0);
    pmrem = new THREE.PMREMGenerator(renderer);
    envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  }
  renderer.setSize(size, size, false);
  return renderer;
}

export async function makeToy(svgText) {
  const layers = await buildLayers(svgText);
  const all = layers.reduce((a, l) => a + (l.base ? l.share : 0), 0) || 1;
  window.lastLayers = layers.map((l) => ({ kind: l.eye ? 'eye' : l.kind, coverage: l.coverage, share: l.share / all, color: '#' + l.color.getHexString().toUpperCase() }));
  const toy = new THREE.Group();
  for (const L of layers) {
    const mesh = new THREE.Mesh(layerGeometry(L), material(L));
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.renderOrder = L.index;
    toy.add(mesh);
    if (L.eye) {
      // tiny painted catch-light, like the dot printed on a vinyl toy's eye
      const r = Math.max(0.5, L.maxD * 0.26);
      const [hx, hy] = L.hl || [L.maxD * 0.35, -L.maxD * 0.38];
      const s = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      // find eye centre & top height from its S field
      let best = -1, bi = 0; for (let i = 0; i < NPIX; i++) if (L.sdf[i] < 0 && L.S[i] > best) { best = L.S[i]; bi = i; }
      const x = (bi % W) / CPU - MARGIN - VB / 2, y = -(((bi / W) | 0) / CPU - MARGIN - VB / 2);
      s.position.set(x + hx * 0.9, y - hy * 0.9, best - r * 0.2);
      s.scale.z = 0.4;
      toy.add(s);
    }
  }
  return toy;
}

export async function renderToy(svgText, { size = 1024, frames = [{ yaw: -24, pitch: 8, roll: 0, bob: 0 }] } = {}) {
  const r = getRenderer(size);
  const toy = await makeToy(svgText);
  const scene = new THREE.Scene();
  scene.environment = envTex;
  scene.environmentIntensity = 0.7;
  const hemi = new THREE.HemisphereLight(0xffffff, 0xb8b0a4, 0.35); scene.add(hemi);
  const key = new THREE.DirectionalLight(0xfff6ec, 2.4);
  key.position.set(-40, 80, 90);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.radius = 6;
  key.shadow.bias = -0.002;
  key.shadow.normalBias = 1.2;
  Object.assign(key.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 300 });
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xffffff, 0.6); rim.position.set(70, 30, -60); scene.add(rim);

  const pivot = new THREE.Group();
  pivot.add(toy);
  scene.add(pivot);
  // centre the toy
  const box = new THREE.Box3().setFromObject(toy);
  const c = box.getCenter(new THREE.Vector3());
  toy.position.sub(c);
  const sz = box.getSize(new THREE.Vector3());
  const radius = Math.max(sz.x, sz.y) * 0.5;

  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false, toneMapped: false }));
  shadow.rotation.x = -Math.PI / 2;
  if (!window.noShadow) scene.add(shadow);

  const cam = new THREE.PerspectiveCamera(24, 1, 1, 1000);
  const urls = [];
  for (const f of frames) {
    pivot.rotation.set(THREE.MathUtils.degToRad(-f.pitch * 0.3), THREE.MathUtils.degToRad(f.yaw), THREE.MathUtils.degToRad(f.roll), 'YXZ');
    pivot.position.set(0, f.bob || 0, 0);
    pivot.updateMatrixWorld(true);
    const wb = new THREE.Box3().setFromObject(toy);
    const gap = radius * 0.16;
    const groundY = new THREE.Box3().setFromObject(toy, true).min.y - gap - (f.bob || 0);
    shadow.position.set(0, groundY, 0);
    const sw = sz.x * 0.9, sd = sz.x * 0.38;
    const lift = (f.bob || 0) / radius;
    shadow.scale.set(sw * (1 - lift * 0.6), sd * (1 - lift * 0.6), 1);
    shadow.material.opacity = 0.85 * (1 - lift * 1.5);
    void wb;
    // camera: slightly above, framing toy + shadow
    const fitR = radius * 1.18;
    const dist = fitR / Math.sin(THREE.MathUtils.degToRad(cam.fov / 2));
    const el = THREE.MathUtils.degToRad(f.pitch);
    const target = new THREE.Vector3(0, -radius * 0.08, 0);
    cam.position.set(0, target.y + Math.sin(el) * dist, Math.cos(el) * dist);
    cam.lookAt(target);
    r.render(scene, cam);
    urls.push(r.domElement.toDataURL('image/png'));
  }
  // cleanup
  toy.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  return urls;
}
