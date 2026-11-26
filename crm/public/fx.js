// The one WebGL effect system of the Mini App: photo effects for event cards (wave 7) and,
// since wave 8, the opaque "living water" circles and pills (surf, sea, own pool: shader name "water" = caustics.glsl with the
// water colours from CSS). One shared offscreen WebGL1 context renders each mounted overlay at its own size and blits it into
// the overlay's 2D canvas. Shaders are /fx/<name>.glsl, exact copies of design/shaders (premultiplied alpha, u_resolution/u_time/u_phase
// plus doc-comment @default uniforms), compiled lazily, one program per name. At most MAX_ANIM overlays animate (the most
// visible, nearest the viewport centre); every other visible overlay gets one still frame. Paused off-screen and on a hidden
// page, ~30 fps, DPR ≤ 2; reduced motion or a low-power device → still frames only; no WebGL / compile error / context loss →
// no canvas at all (the photo stays). Nothing here throws into the caller.

const NAMES = new Set(['water', 'embers', 'caustics', 'bokeh', 'foam', 'mist', 'rays', 'droplets', 'steam', 'smoke', 'grain', 'confetti', 'stars', 'fireflies', 'neon', 'floodlight']);
const MAX_ANIM = 2;
const FRAME_MS = 33;
const BRIGHT = 0.6; // average photo luminance above which the effect is dimmed
const BRIGHT_DIM = 0.7;
const VS = 'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}';

// Per-shader adaptation for the photo overlay. caustics.glsl is the opaque water used by the water cards; over a photo we
// want caustic light only: deep = black, so the shader's colour is light × brightness (+ its 0.06 vertical lift, removed
// here), and that brightness becomes the alpha of a pale aqua tint at ~35% — a screen-like additive glint, premultiplied.
// "water" (wave 8): the opaque caustics fill of the living-water shapes; colours from --water-deep / --water-light at compile.
const ADAPT = {
  water: { src: 'caustics', uniforms: () => ({ u_deep: cssRGB('--water-deep', '#4FD4C4'), u_light: cssRGB('--water-light', '#EAFFFA') }) },
  caustics: {
    uniforms: { u_deep: [0, 0, 0], u_light: [0.86, 1, 0.97] },
    post: 'vec3 k=max(c.rgb-0.06*(1.0-gl_FragCoord.y/u_resolution.y),0.0); float ka=max(k.r,max(k.g,k.b));'
      + ' ka=smoothstep(0.08,0.9,ka)*0.35; c=vec4(u_light*ka,ka);',
  },
};

const S = {
  gl: null, cv: null, failed: false, src: new Map(), progs: new Map(), cards: new Set(), anim: new Set(),
  raf: 0, last: 0, io: null, ro: null, frames: 0, ready: 0, queue: Promise.resolve(), gen: 0,
};
const STALE = 'stale'; // a compile that raced a context loss; the restore recompiles

const cssRGB = (name, fb) => { try { return hexRGB(getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fb); } catch { return hexRGB(fb); } };
const hexRGB = (h) => (h.replace('#', '').match(/../g) ?? ['00', '00', '00']).slice(0, 3).map((x) => parseInt(x, 16) / 255);
const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
const lowPower = () => (navigator.hardwareConcurrency || 8) <= 4;
const canAnimate = () => !reduced() && !lowPower();

function initGL() {
  if (S.gl || S.failed) return S.gl;
  try {
    const cv = document.createElement('canvas');
    const gl = cv.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'low-power' });
    if (!gl) throw new Error('no webgl');
    setup(gl);
    cv.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost(); });
    cv.addEventListener('webglcontextrestored', () => restored(gl));
    S.cv = cv;
    S.gl = gl;
  } catch {
    S.failed = true;
  }
  return S.gl;
}

function setup(gl) {
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW); // one full-screen triangle
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.disable(gl.BLEND);
  gl.clearColor(0, 0, 0, 0);
}

/** Context lost: hide every overlay (the photos stay as they are) and forget the programs. */
function lost() {
  S.gl = null;
  S.gen++;
  S.progs.clear();
  S.ready = 0;
  S.queue = Promise.resolve();
  S.anim.clear();
  for (const c of S.cards) { c.prog = null; c.loading = false; c.dirty = true; c.cv.classList.remove('on'); }
}

/** The browser gave the context back (e.g. after a GPU process restart): recompile what is visible and redraw. */
function restored(gl) {
  try {
    setup(gl);
    S.gl = gl;
    S.gen++;
    S.progs.clear();
    for (const c of S.cards) { c.loading = false; if (c.visible) load(c); }
  } catch {
    // stays hidden
  }
}

/** Uniform defaults from the doc comments: `@default #RRGGBB` → vec3, a number → float. */
function defaults(src) {
  const out = {};
  const re = /\/\*\*([\s\S]*?)\*\/\s*uniform\s+(float|vec3)\s+(\w+)\s*;/g;
  for (let m; (m = re.exec(src));) {
    const d = /@default\s+(\S+)/.exec(m[1]);
    if (!d) continue;
    if (m[2] === 'vec3' && d[1].startsWith('#')) out[m[3]] = hexRGB(d[1]);
    else if (m[2] === 'float' && Number.isFinite(+d[1])) out[m[3]] = +d[1];
  }
  return out;
}

/** Wrap the design shader: its main() writes fx_c; ours adapts it, keeps it valid premultiplied and multiplies by u_fx_mix. */
function wrap(name, src) {
  const body = src.replace(/\bgl_FragColor\b/g, 'fx_c').replace(/\bvoid\s+main\s*\(/, 'void fx_main(');
  const head = 'vec4 fx_c;\nuniform float u_fx_mix;\n';
  const withHead = /precision\s+\w+\s+float\s*;/.test(body) ? body.replace(/precision\s+\w+\s+float\s*;/, (p) => p + '\n' + head) : 'precision highp float;\n' + head + body;
  return withHead + `\nvoid main(){ fx_main(); vec4 c=fx_c; ${ADAPT[name]?.post ?? ''}
  c=clamp(c,0.0,1.0); c.rgb=min(c.rgb,vec3(c.a)); gl_FragColor=c*u_fx_mix; }\n`;
}

/** One compiled program per shader name; resolves to null when the source or compile fails. */
function program(name) {
  if (S.progs.has(name)) return S.progs.get(name);
  if (!S.src.has(name)) {
    const file = ADAPT[name]?.src ?? name;
    S.src.set(name, fetch(new URL(`./fx/${file}.glsl`, import.meta.url)).then((r) => (r.ok ? r.text() : null)).catch(() => null));
  }
  const gen = S.gen;
  // compile one program per animation frame: a burst of compiles stalls weak GPUs (and can get the context dropped)
  const p = S.queue = Promise.all([S.src.get(name), S.queue]).then(([src]) => new Promise((ok) => requestAnimationFrame(() => ok(src)))).then((src) => {
    const gl = S.gl;
    if (!src) return null;
    if (!gl || gen !== S.gen) return STALE;
    try {
      const sh = (type, s) => { const o = gl.createShader(type); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o) || 'compile'); return o; };
      const pr = gl.createProgram();
      gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS));
      gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, wrap(name, src)));
      gl.bindAttribLocation(pr, 0, 'a');
      gl.linkProgram(pr);
      if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error('link');
      gl.useProgram(pr);
      const au = ADAPT[name]?.uniforms;
      const def = { ...defaults(src), ...(typeof au === 'function' ? au() : au) };
      for (const [k, v] of Object.entries(def)) {
        const loc = gl.getUniformLocation(pr, k);
        if (loc) Array.isArray(v) ? gl.uniform3fv(loc, v) : gl.uniform1f(loc, v);
      }
      const u = (n) => gl.getUniformLocation(pr, n);
      S.ready++;
      return { pr, phase: def.u_phase ?? 0, res: u('u_resolution'), time: u('u_time'), ph: u('u_phase'), mix: u('u_fx_mix'), scale: u('u_scale'), scale0: def.u_scale ?? 5 };
    } catch (e) {
      if (gl.isContextLost()) return STALE;
      console.warn('fx: shader failed', name, e?.message ?? e);
      return null;
    }
  });
  S.progs.set(name, p);
  return p;
}

/** Render one frame of a card at its current size and blit it into the card's canvas (transparency kept). */
function draw(c) {
  const gl = S.gl, p = c.prog;
  if (!gl || !p || c.dead) return;
  const r = c.el.getBoundingClientRect();
  if (r.width < 4 || r.height < 4) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
  if (c.cv.width !== w || c.cv.height !== h) { c.cv.width = w; c.cv.height = h; }
  const g = S.cv;
  if (g.width < w || g.height < h) { g.width = Math.max(g.width, w); g.height = Math.max(g.height, h); }
  gl.viewport(0, 0, w, h);
  gl.useProgram(p.pr);
  gl.uniform2f(p.res, w, h);
  gl.uniform1f(p.time, c.t);
  gl.uniform1f(p.ph, c.phase ?? p.phase);
  gl.uniform1f(p.mix, Math.max(0, Math.min(1, c.mix * c.dim)));
  // cell (wave 8 water): one caustic cell ≈ `cell` css px whatever the shape size; otherwise the shader's own scale
  if (p.scale) gl.uniform1f(p.scale, c.cell ? Math.max(1, r.height / c.cell) : p.scale0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  c.ctx.clearRect(0, 0, w, h);
  c.ctx.drawImage(g, 0, g.height - h, w, h, 0, 0, w, h);
  c.dirty = false;
  if (!c.cv.classList.contains('on')) c.cv.classList.add('on');
  S.frames++;
}

/** The overlays allowed to animate now: visible, most visible first, then nearest the viewport centre. */
function pick() {
  S.anim.clear();
  if (!S.gl || document.hidden || !canAnimate()) return S.anim;
  const mid = window.innerHeight / 2;
  const live = [...S.cards].filter((c) => c.visible && c.prog && !c.dead).map((c) => {
    const r = c.el.getBoundingClientRect();
    return { c, q: Math.round(c.ratio * 4), d: Math.abs(r.top + r.height / 2 - mid) };
  });
  live.sort((a, b) => b.q - a.q || a.d - b.d);
  for (const x of live.slice(0, MAX_ANIM)) S.anim.add(x.c);
  return S.anim;
}

function tick(now) {
  S.raf = 0;
  try {
    const anim = pick();
    if (!anim.size) return;
    if (now - S.last >= FRAME_MS) {
      const dt = Math.min(now - S.last, 100) / 1000; // per-card clock: an overlay starts moving from its still frame
      S.last = now;
      for (const c of anim) { c.t += dt; draw(c); }
    }
    S.raf = requestAnimationFrame(tick);
  } catch {
    // never let a frame error escape; the overlays keep their last frame
  }
}

/** Re-evaluate: still frames for visible overlays that need one, start the loop when something may animate. */
function kick() {
  try {
    if (!S.gl) return;
    const anim = pick();
    for (const c of S.cards) if (c.visible && c.dirty && !anim.has(c)) draw(c);
    if (anim.size && !S.raf) { S.last = performance.now() - FRAME_MS; S.raf = requestAnimationFrame(tick); }
  } catch {
    // ignore
  }
}

/** Average luminance (0..1) of a loaded same-origin image, or null when unknown (cross-origin, tainted, not decoded). */
function luminance(img) {
  try {
    const u = new URL(img.currentSrc || img.src, location.href);
    if (u.origin !== location.origin && u.protocol !== 'data:' && u.protocol !== 'blob:') return null;
    const cv = document.createElement('canvas');
    cv.width = cv.height = 16;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, 16, 16);
    const d = ctx.getImageData(0, 0, 16, 16).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 4) s += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
    return s / (d.length / 4);
  } catch {
    return null; // SecurityError on a tainted canvas and the like → unknown
  }
}

/** Compile the card's program on its first visibility (not at mount). A failed compile removes its canvas for good. */
function load(c) {
  if (c.loading || c.prog || c.dead) return;
  c.loading = true;
  program(c.shader).then((p) => {
    if (!S.cards.has(c) || c.dead || p === STALE) return;
    c.loading = false;
    if (!p) { c.dead = true; c.cv.remove(); return; }
    c.prog = p;
    kick();
  });
}

const cardOf = (el) => { for (const c of S.cards) if (c.el === el) return c; return null; };

/**
 * Mount an effect overlay into `el` (an absolutely positioned, pointer-events:none box over the photo).
 * Returns a cleanup function, or undefined when nothing was mounted (unknown shader, no WebGL).
 */
export function fxMount(el, { shader, mix = 1, img = null, phase, cell = null } = {}) {
  try {
    if (!el || !NAMES.has(shader) || !initGL()) return undefined;
    const cv = document.createElement('canvas');
    const ctx = cv.getContext('2d');
    if (!ctx) return undefined;
    cv.setAttribute('aria-hidden', 'true');
    el.appendChild(cv);
    const c = { el, cv, ctx, shader, cell: Number.isFinite(cell) ? cell : null, mix: Number.isFinite(+mix) ? +mix : 1, dim: 1, phase: Number.isFinite(phase) ? phase : null, t: 0, ratio: 0, visible: false, dirty: true, prog: null, dead: false, loading: false };
    S.cards.add(c);
    let onLoad = null;
    if (img) {
      const sample = () => { const l = luminance(img); if (l != null && l > BRIGHT) { c.dim = BRIGHT_DIM; c.dirty = true; kick(); } };
      if (img.complete && img.naturalWidth) sample();
      else { onLoad = sample; img.addEventListener('load', onLoad, { once: true }); }
    }
    S.io ??= new IntersectionObserver((es) => {
      for (const e of es) { const x = cardOf(e.target); if (x) { x.visible = e.isIntersecting; x.ratio = e.intersectionRatio; if (x.visible) load(x); } }
      kick();
    }, { threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] });
    S.ro ??= new ResizeObserver((es) => { for (const e of es) { const x = cardOf(e.target); if (x) x.dirty = true; } kick(); });
    S.io.observe(el);
    S.ro.observe(el);
    return () => {
      try {
        S.io?.unobserve(el);
        S.ro?.unobserve(el);
        if (onLoad) img.removeEventListener('load', onLoad);
        S.cards.delete(c);
        S.anim.delete(c);
        cv.remove();
      } catch {
        // ignore
      }
    };
  } catch {
    return undefined;
  }
}

/** Counters for tests: WebGL up, compiled programs, mounted overlays, currently animating, frames drawn. */
export function fxStats() {
  return { gl: !!S.gl, programs: S.ready, mounted: S.cards.size, animated: S.anim.size, frames: S.frames };
}

if (typeof document !== 'undefined') document.addEventListener('visibilitychange', kick);
