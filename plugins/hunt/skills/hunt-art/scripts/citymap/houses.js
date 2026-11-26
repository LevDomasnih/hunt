// Toy house kit for the Hunt maps: four classes (low, mid, high, sky), a few variants each, wall colours from a small palette.
import * as THREE from 'three';
export const WALLS = ['#FFFFFF', '#FFF3E0', '#F7DFA0', '#F6C9A8', '#EFA98C', '#DCD8D0', '#CFE6D2', '#D9E8F5'];
export const ROOFS = ['#C8643B', '#8A4B2E', '#5F5C56', '#B5503B'];
const texCache = new Map(), matCache = new Map(), geoCache = new Map();
function winTex(cols, rows, glass = false) {
  const k = `${cols}|${rows}|${glass}`;
  if (texCache.has(k)) return texCache.get(k);
  const c = document.createElement('canvas'), cw = 32, ch = 32; c.width = cols * cw; c.height = rows * ch;
  const x = c.getContext('2d');
  x.fillStyle = glass ? '#BFDDF0' : '#FFFFFF'; x.fillRect(0, 0, c.width, c.height);
  for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
    if (glass) { x.fillStyle = (r + q) % 3 ? '#9CC6E4' : '#D7ECF8'; x.fillRect(q * cw + 2, r * ch + 3, cw - 4, ch - 6); }
    else { x.fillStyle = '#48607A'; x.fillRect(q * cw + 9, r * ch + 8, cw - 18, ch - 13); x.fillStyle = 'rgba(255,255,255,.35)'; x.fillRect(q * cw + 9, r * ch + 8, cw - 18, 3); }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; texCache.set(k, t); return t;
}
function mat(color, opts = {}) {
  const k = color + JSON.stringify(opts);
  if (!matCache.has(k)) matCache.set(k, opts.glass ? new THREE.MeshPhysicalMaterial({ color, roughness: 0.15, metalness: 0.1, clearcoat: 1, map: opts.map }) : new THREE.MeshStandardMaterial({ color, roughness: 0.7, map: opts.map ?? null }));
  return matCache.get(k);
}
const plain = (c) => mat(c);
function body(w, h, d, wall, cols, rows, glass = false) {
  const side = mat(wall, { map: winTex(cols, rows, glass), glass });
  const top = plain(glass ? '#E6F2FA' : wall);
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [side, side, top, top, side, side]); m.position.y = h / 2; return m;
}
function gable(w, d, h, c) {
  const k = `g${w}|${d}|${h}`;
  if (!geoCache.has(k)) { const s = new THREE.Shape([new THREE.Vector2(-w / 2 - 0.9, 0), new THREE.Vector2(w / 2 + 0.9, 0), new THREE.Vector2(0, h)]); const g = new THREE.ExtrudeGeometry(s, { depth: d + 1.2, bevelEnabled: false }); g.translate(0, 0, -(d + 1.2) / 2); geoCache.set(k, g); }
  return new THREE.Mesh(geoCache.get(k), plain(c));
}
function hip(w, d, h, c) { const m = new THREE.Mesh(new THREE.ConeGeometry(Math.hypot(w, d) / 2 + 0.8, h, 4, 1), plain(c)); m.rotation.y = Math.PI / 4; m.scale.set(w / Math.hypot(w, d) * 1.414, 1, d / Math.hypot(w, d) * 1.414); m.position.y = h / 2; return m; }
const add = (g, m, y = 0) => { m.position.y += y; g.add(m); return m; };
/** cls: low | mid | high | sky; v: variant; rnd: 0..1 generator; s: scale */
export function house(cls, v, rnd, s = 1, pal = WALLS, roofs = ROOFS) {
  const g = new THREE.Group(), wall = pal[Math.floor(rnd() * pal.length)], roof = roofs[Math.floor(rnd() * roofs.length)];
  if (cls === 'low') {
    const w = 10 + rnd() * 2, d = 8, h = 6.5;
    add(g, body(w, h, d, wall, 2, 1));
    if (v === 1) add(g, hip(w, d, 5, roof), h);
    else { add(g, gable(w, d, 5.2, roof), h); if (v === 2) { const ch = new THREE.Mesh(new THREE.BoxGeometry(1.6, 4, 1.6), plain('#8C8578')); ch.position.set(w * 0.25, h + 4, 0); g.add(ch); } }
  } else if (cls === 'mid') {
    const w = 13 + rnd() * 2, d = 10, h = 14 + rnd() * 3;
    add(g, body(w, h, d, wall, 4, 4));
    if (v === 0) { const c = new THREE.Mesh(new THREE.BoxGeometry(w + 1.2, 1.4, d + 1.2), plain('#FFFFFF')); add(g, c, h + 0.7); }
    if (v === 1) { const m = new THREE.Mesh(new THREE.CylinderGeometry(Math.hypot(w, d) / 2 * 0.7, Math.hypot(w, d) / 2 * 0.98, 5, 4, 1), plain(roof === '#C8643B' ? '#5F5C56' : roof)); m.rotation.y = Math.PI / 4; m.scale.set(w / Math.hypot(w, d) * 1.414, 1, d / Math.hypot(w, d) * 1.414); add(g, m, h + 2.5); }
    if (v === 2) { const c = new THREE.Mesh(new THREE.BoxGeometry(w + 1, 1.2, d + 1), plain('#FFFFFF')); add(g, c, h + 0.6); const t = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, h + 3, 12), mat(wall)); t.position.set(w / 2 - 1.5, (h + 3) / 2, d / 2 - 1.5); g.add(t); const cap = new THREE.Mesh(new THREE.ConeGeometry(3, 4, 12), plain(roof)); cap.position.set(w / 2 - 1.5, h + 5, d / 2 - 1.5); g.add(cap); }
  } else if (cls === 'high') {
    if (v === 0) {        // a long panel slab with coloured balcony stripes
      const w = 24, d = 9, h = 26 + rnd() * 4, fl = 9; add(g, body(w, h, d, wall === '#FFFFFF' ? '#EDEAE4' : wall, 7, fl));
      const stripe = plain(['#F08A6B', '#7FB6D8', '#F2C94C', '#8FC76B'][Math.floor(rnd() * 4)]);
      for (let i = 1; i < fl; i += 2) { const b = new THREE.Mesh(new THREE.BoxGeometry(w - 2, 0.9, 1.2), stripe); b.position.set(0, (h / fl) * i, d / 2 + 0.6); g.add(b); }
      const c = new THREE.Mesh(new THREE.BoxGeometry(w + 0.6, 1.2, d + 0.6), plain('#B5B0A6')); add(g, c, h + 0.6);
    } else {              // a point tower
      const w = 11, d = 11, h = 34 + rnd() * 6; add(g, body(w, h, d, wall === '#FFFFFF' ? '#F2F0EA' : wall, 3, 12));
      const c = new THREE.Mesh(new THREE.BoxGeometry(w * 0.6, 3, d * 0.6), plain('#B5B0A6')); add(g, c, h + 1.5);
    }
  } else {                // sky: glass
    const glassC = ['#FFFFFF', '#E3F1FA', '#DDE6F2'][Math.floor(rnd() * 3)];
    if (v === 0) { const w = 11, h = 52 + rnd() * 8; add(g, body(w, h, w, glassC, 3, 16, true)); const cr = new THREE.Mesh(new THREE.BoxGeometry(w * 0.55, 6, w * 0.55), plain('#FFFFFF')); add(g, cr, h + 3); const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 8, 6), plain('#5F5C56')); add(g, sp, h + 10); }
    else if (v === 1) { let w = 14, y = 0; for (const [hh, k] of [[24, 1], [18, 0.75], [14, 0.5]]) { const b = body(w * k, hh, w * k, glassC, Math.max(2, Math.round(4 * k)), Math.round(hh / 3.2), true); b.position.y = y + hh / 2; g.add(b); y += hh; } }
    else { const h = 50 + rnd() * 6, m = new THREE.Mesh(new THREE.CylinderGeometry(6, 6.5, h, 24), mat(glassC, { map: winTex(8, 15, true), glass: true })); m.position.y = h / 2; g.add(m); const cap = new THREE.Mesh(new THREE.CylinderGeometry(6.4, 6.4, 1.5, 24), plain('#FFFFFF')); add(g, cap, h + 0.75); }
  }
  g.scale.setScalar(s);
  g.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  return g;
}
export const VARIANTS = { low: 3, mid: 3, high: 2, sky: 3 };

/** Landmarks: simple, recognisable shapes. */
export function landmark(kind, s = 1) {
  const g = new THREE.Group(), W = (c) => mat(c);
  if (kind === 'church') {          // a big white cross-plan church with a green dome
    const b = new THREE.Mesh(new THREE.BoxGeometry(22, 14, 22), W('#F7F5F0')); b.position.y = 7; g.add(b);
    for (const [x, z] of [[0, 13], [0, -13], [13, 0], [-13, 0]]) { const a = new THREE.Mesh(new THREE.BoxGeometry(x ? 6 : 12, 11, x ? 12 : 6), W('#F7F5F0')); a.position.set(x, 5.5, z); g.add(a); const sd = new THREE.Mesh(new THREE.SphereGeometry(3.4, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), W('#6FB58A')); sd.position.set(x, 11, z); g.add(sd); }
    const dr = new THREE.Mesh(new THREE.CylinderGeometry(8, 8, 6, 28), W('#F7F5F0')); dr.position.y = 17; g.add(dr);
    const dm = new THREE.Mesh(new THREE.SphereGeometry(8.4, 28, 16, 0, Math.PI * 2, 0, Math.PI / 2), W('#6FB58A')); dm.position.y = 20; g.add(dm);
    const cr = new THREE.Mesh(new THREE.BoxGeometry(0.8, 6, 0.8), W('#E8B83A')); cr.position.y = 31; g.add(cr); const cr2 = new THREE.Mesh(new THREE.BoxGeometry(3, 0.8, 0.8), W('#E8B83A')); cr2.position.y = 32; g.add(cr2);
  } else if (kind === 'fortress') { // a low stone wall with round towers and a column
    const stone = W('#D8CCB4');
    const wall = new THREE.Mesh(new THREE.TorusGeometry(16, 2.2, 6, 6), stone); wall.rotation.x = Math.PI / 2; wall.rotation.z = Math.PI / 6; wall.scale.set(1.25, 0.85, 2.4); wall.position.y = 2.6; g.add(wall);
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + Math.PI / 6, t = new THREE.Mesh(new THREE.CylinderGeometry(3, 3.4, 8, 12), stone); t.position.set(Math.cos(a) * 20, 4, Math.sin(a) * 13.6); g.add(t); }
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 16, 10), W('#F2F0EA')); col.position.set(4, 8, 2); g.add(col); const st = new THREE.Mesh(new THREE.SphereGeometry(1.6, 10, 8), W('#5E7E6E')); st.position.set(4, 17, 2); g.add(st);
  } else if (kind === 'genex') {    // two towers joined by a bridge, a round restaurant on top
    const c = W('#B9B4AA'); const a = new THREE.Mesh(new THREE.BoxGeometry(8, 44, 9), c); a.position.set(-7, 22, 0); g.add(a); const b = new THREE.Mesh(new THREE.BoxGeometry(8, 36, 9), c); b.position.set(7, 18, 0); g.add(b);
    const br = new THREE.Mesh(new THREE.BoxGeometry(14, 4, 6), c); br.position.y = 33; g.add(br); const rr = new THREE.Mesh(new THREE.CylinderGeometry(5, 4, 4, 18), W('#F2F0EA')); rr.position.set(-7, 47, 0); g.add(rr);
  } else if (kind === 'bw') {       // the tall waterfront tower, glass
    const m = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 7, 66, 20), mat('#E3F1FA', { map: winTex(10, 20, true), glass: true })); m.position.y = 33; g.add(m);
  } else if (kind === 'usce') {
    const m = new THREE.Mesh(new THREE.BoxGeometry(11, 52, 11), mat('#DDE6F2', { map: winTex(3, 16, true), glass: true })); m.position.y = 26; g.add(m); const t = new THREE.Mesh(new THREE.BoxGeometry(6, 5, 6), W('#FFFFFF')); t.position.y = 54.5; g.add(t);
  } else if (kind === 'arena') {    // a low oval arena
    const m = new THREE.Mesh(new THREE.CylinderGeometry(12, 13, 8, 32), W('#F2F0EA')); m.scale.set(1.3, 1, 1); m.position.y = 4; g.add(m); const r = new THREE.Mesh(new THREE.SphereGeometry(12, 32, 10, 0, Math.PI * 2, 0, Math.PI / 5), W('#C9D0FF')); r.scale.set(1.3, 0.6, 1); r.position.y = 4; g.add(r);
  }
  else if (kind === 'mahanakhon') {   // tall glass with a stepped "pixel" cut spiralling up
    const glass = mat('#E3F1FA', { map: winTex(3, 22, true), glass: true });
    const m = new THREE.Mesh(new THREE.BoxGeometry(10, 74, 10), glass); m.position.y = 37; g.add(m);
    for (let i = 0; i < 9; i++) { const c = new THREE.Mesh(new THREE.BoxGeometry(3, 5, 3), W('#5F6B7A')); const a = i * 0.9; c.position.set(Math.cos(a) * 4.2, 8 + i * 7.5, Math.sin(a) * 4.2); g.add(c); }
  } else if (kind === 'statetower') { // a white tower with a golden dome
    const m = new THREE.Mesh(new THREE.BoxGeometry(13, 50, 13), mat('#F7F5F0', { map: winTex(4, 16) })); m.position.y = 25; g.add(m);
    const dr = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.5, 4, 20), W('#F7F5F0')); dr.position.y = 52; g.add(dr);
    const dm = new THREE.Mesh(new THREE.SphereGeometry(4.6, 22, 14, 0, Math.PI * 2, 0, Math.PI / 2), W('#E8B83A')); dm.position.y = 54; g.add(dm);
  } else if (kind === 'iconsiam') {   // a wide glass mall and two towers
    const base = new THREE.Mesh(new THREE.BoxGeometry(30, 7, 16), mat('#E3F1FA', { map: winTex(8, 2, true), glass: true })); base.position.y = 3.5; g.add(base);
    for (const [x, h] of [[-8, 46], [7, 38]]) { const t = new THREE.Mesh(new THREE.BoxGeometry(7, h, 7), mat('#DDE6F2', { map: winTex(2, 14, true), glass: true })); t.position.set(x, h / 2, -2); g.add(t); }
  } else if (kind === 'baiyoke') {    // a slim tall tower with a crown and a spire
    const m = new THREE.Mesh(new THREE.BoxGeometry(9, 70, 9), mat('#C9D6E6', { map: winTex(3, 22, true), glass: true })); m.position.y = 35; g.add(m);
    const cr = new THREE.Mesh(new THREE.CylinderGeometry(6, 5, 4, 16), W('#F2F0EA')); cr.position.y = 72; g.add(cr); const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 12, 6), W('#5F5C56')); sp.position.y = 80; g.add(sp);
  } else if (kind === 'palace') {     // the Grand Palace: a white hall under stacked green and orange roofs with three gold spires
    const hall = new THREE.Mesh(new THREE.BoxGeometry(26, 7, 12), W('#F7F5F0')); hall.position.y = 3.5; g.add(hall);
    [['#4E9A6A', 28, 14, 9], ['#E8823A', 21, 10, 12.5]].forEach(([c, w, d, y]) => { const r = new THREE.Mesh(new THREE.ConeGeometry(Math.hypot(w, d) / 2, 4, 4), W(c)); r.rotation.y = Math.PI / 4; r.scale.set(w / Math.hypot(w, d) * 1.414, 1, d / Math.hypot(w, d) * 1.414); r.position.y = y; g.add(r); });
    for (const x of [-8, 0, 8]) { const sp = new THREE.Mesh(new THREE.ConeGeometry(1.4, x ? 10 : 15, 10), W('#E8B83A')); sp.position.set(x, x ? 18 : 20.5, 0); g.add(sp); }
  } else if (kind === 'prang') {      // Wat Arun: a tall stepped tower by the river
    let y = 0; for (const [r, h] of [[9, 5], [7, 6], [5.4, 7], [4, 8], [2.6, 7]]) { const t = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.85, r, h, 12), W('#EFE7D6')); t.position.y = y + h / 2; g.add(t); y += h; }
    const sp = new THREE.Mesh(new THREE.ConeGeometry(1.6, 9, 12), W('#E8B83A')); sp.position.y = y + 4.5; g.add(sp);
  } else if (kind === 'tower') {      // any tall glass tower (cities without their own kinds)
    const m = new THREE.Mesh(new THREE.BoxGeometry(10, 56, 10), mat('#DDE6F2', { map: winTex(3, 18, true), glass: true })); m.position.y = 28; g.add(m);
  } else if (kind === 'monument') {   // a tall white column with a gold flame on top
    const base = new THREE.Mesh(new THREE.BoxGeometry(16, 4, 16), W('#F2F0EA')); base.position.y = 2; g.add(base);
    const col = new THREE.Mesh(new THREE.BoxGeometry(4, 44, 4), W('#F7F5F0')); col.position.y = 26; g.add(col);
    const fl = new THREE.Mesh(new THREE.ConeGeometry(2.4, 7, 12), W('#E8B83A')); fl.position.y = 51.5; g.add(fl);
  } else if (kind === 'wat') {        // a Thai temple: white hall, stacked orange and green roofs, a gold spire
    const hall = new THREE.Mesh(new THREE.BoxGeometry(18, 6, 11), W('#F7F5F0')); hall.position.y = 3; g.add(hall);
    [['#E8823A', 20, 13, 6], ['#4E9A6A', 15, 10, 9.5], ['#E8823A', 10, 7, 12.5]].forEach(([c, w, d, y]) => { const r = new THREE.Mesh(new THREE.ConeGeometry(Math.hypot(w, d) / 2, 4, 4), W(c)); r.rotation.y = Math.PI / 4; r.scale.set(w / Math.hypot(w, d) * 1.414, 1, d / Math.hypot(w, d) * 1.414); r.position.y = y; g.add(r); });
    const sp = new THREE.Mesh(new THREE.ConeGeometry(1.2, 9, 10), W('#E8B83A')); sp.position.y = 18; g.add(sp);
  }
  g.scale.setScalar(s); g.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } }); return g;
}
