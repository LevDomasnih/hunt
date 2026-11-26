#!/usr/bin/env node
// Copies region art (avatars, motifs) from the region packs into public/art/ and generates:
//   public/toys/<country>/    glossy animal toys of the packs (art/toys)
//   public/art/regions.css  screen colour + map accent per country (light + dark)
//   public/art/regions.json names, timezones, sub-regions (+ price_ref), districts, travel speed, power, visa, emergency, areas, seasons,
//                           location rings, events (Афиша effects + sources + party rules; for the Mini App and the Worker)
//   public/art/<country>/districts.geojson  area outlines for the map "Districts" mode
//   src/animals.ts          avatar lists + timezones for the Worker (committed)
// Run before `wrangler dev` / `wrangler deploy` (npm predev / predeploy do it).
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, copyFileSync, rmSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const crm = join(here, '..');
// Countries: HUNT_REGIONS (a hunt-data checkout's regions folder), else hunt-data cloned next to this repository, else the packs in the plugin.
const sibling = join(crm, '..', '..', 'hunt-data', 'regions');
const regionsDir = process.env.HUNT_REGIONS ? resolve(process.env.HUNT_REGIONS) : existsSync(sibling) ? sibling : join(crm, '..', 'plugins', 'hunt', 'regions');
// The generic pack (fallback animals, events, party rules) ships with the plugin, not with hunt-data.
const packDir = (c) => (c === '_generic' && !existsSync(join(regionsDir, c)) ? join(crm, '..', 'plugins', 'hunt', 'regions', c) : join(regionsDir, c));
const out = join(crm, 'public', 'art');
const toysOut = join(crm, 'public', 'toys');

const read = (p) => readFileSync(p, 'utf8');
const unq = (s) => String(s ?? '').trim().replace(/^["']|["']$/g, '');
// "{en: Gecko, ru: Геккон}" -> {en, ru}
function nameMap(s) {
  const o = {};
  for (const m of String(s).matchAll(/(\w+):\s*("[^"]*"|[^,}]+)/g)) o[m[1]] = unq(m[2]);
  return o;
}
// "{light: "#0E8C88", dark: "#2CC4BC"}"
const pair = (s) => nameMap(s);

// A tiny YAML subset reader for the wave 3 pack files (districts.yaml, emergency.yaml, one-line pack keys):
// 2-space block mappings, block lists of one-line items, one-line flow maps/lists, quoted or plain scalars, own-line comments.
function flowValue(src) {
  let i = 0;
  const ws = () => { while (i < src.length && /\s/.test(src[i])) i++; };
  function scalar(stop) {
    ws();
    if (src[i] === '"' || src[i] === "'") {
      const q = src[i++];
      let out = '';
      while (i < src.length && src[i] !== q) { if (src[i] === '\\' && q === '"') { i++; out += src[i] === 'n' ? '\n' : src[i]; i++; continue; } out += src[i++]; }
      i++;
      return out;
    }
    let out = '';
    while (i < src.length && !stop.includes(src[i]) && !(src[i] === ':' && /\s/.test(src[i + 1] ?? ' ') && stop.includes(':'))) out += src[i++];
    out = out.trim();
    if (out === 'null' || out === '~' || out === '') return null;
    if (out === 'true') return true;
    if (out === 'false') return false;
    if (/^-?\d+(\.\d+)?$/.test(out)) return Number(out);
    return out;
  }
  function value(stop) {
    ws();
    if (src[i] === '{') {
      i++;
      const o = {};
      for (;;) {
        ws();
        if (src[i] === '}') { i++; break; }
        const k = scalar([':', ',', '}']);
        ws();
        if (src[i] === ':') i++;
        o[k] = value([',', '}']);
        ws();
        if (src[i] === ',') i++;
        else if (src[i] === '}') { i++; break; }
        else break;
      }
      return o;
    }
    if (src[i] === '[') {
      i++;
      const a = [];
      for (;;) {
        ws();
        if (src[i] === ']') { i++; break; }
        a.push(value([',', ']']));
        ws();
        if (src[i] === ',') i++;
        else if (src[i] === ']') { i++; break; }
        else break;
      }
      return a;
    }
    return scalar(stop);
  }
  return value(['\n']);
}
function stripComment(line) {
  let q = null;
  for (let k = 0; k < line.length; k++) {
    const c = line[k];
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === "'") q = c;
    else if (c === '#' && (k === 0 || /\s/.test(line[k - 1]))) return line.slice(0, k);
  }
  return line;
}
function yamlSubset(text) {
  const lines = text.split('\n').map(stripComment).filter((l) => l.trim()).map((l) => ({ ind: l.match(/^ */)[0].length, s: l.trim() }));
  function block(i, ind) {
    if (lines[i]?.s.startsWith('- ')) {
      const a = [];
      while (i < lines.length && lines[i].ind === ind && lines[i].s.startsWith('- ')) { a.push(flowValue(lines[i].s.slice(2))); i++; }
      return [a, i];
    }
    const o = {};
    while (i < lines.length && lines[i].ind === ind) {
      const m = lines[i].s.match(/^("[^"]*"|'[^']*'|[^:]+):(?:\s+(.*))?$/);
      if (!m) { i++; continue; }
      const k = unq(m[1]);
      if (m[2] != null && m[2] !== '') { o[k] = flowValue(m[2]); i++; }
      else if (lines[i + 1] && lines[i + 1].ind > ind) { const [v, j] = block(i + 1, lines[i + 1].ind); o[k] = v; i = j; }
      else { o[k] = null; i++; }
    }
    return [o, i];
  }
  return lines.length ? block(0, lines[0].ind)[0] : {};
}
const topLine = (txt, k) => { const l = txt.split('\n').find((x) => x.startsWith(`${k}:`)); return l ? flowValue(stripComment(l.slice(k.length + 1))) : null; };

function parseAvatars(file) {
  const list = [];
  let cur = null;
  for (const line of read(file).split('\n')) {
    let m;
    // One line per animal: - {slug: wolf, name: {en: Wolf, ru: Волк}, bg_light: "#…", bg_dark: "#…"}
    if ((m = line.match(/^\s*-\s*\{\s*slug:\s*([a-z0-9_-]+)/))) {
      const bg = (k) => line.match(new RegExp(`${k}:\\s*["']?(#[0-9A-Fa-f]{6})`))?.[1];
      list.push((cur = { slug: m[1], name: nameMap(line.match(/name:\s*(\{[^}]*\})/)?.[1] ?? '{}'), bg_light: bg('bg_light'), bg_dark: bg('bg_dark') }));
    } else if ((m = line.match(/^\s*-\s*slug:\s*(\S+)/))) list.push((cur = { slug: unq(m[1]) }));
    else if (cur && (m = line.match(/^\s+name:\s*(\{.*\})/))) cur.name = nameMap(m[1]);
    else if (cur && (m = line.match(/^\s+(bg_light|bg_dark):\s*(\S+)/))) cur[m[1]] = unq(m[2]);
  }
  return list.map((a) => ({ slug: a.slug, name: { en: a.name?.en ?? a.slug, ru: a.name?.ru ?? a.name?.en ?? a.slug }, bg_light: a.bg_light, bg_dark: a.bg_dark }));
}

function parseTheme(file) {
  const th = {};
  for (const line of read(file).split('\n')) {
    const m = line.match(/^(accent|detail):\s*(\{[^}]*\})/);
    if (m) th[m[1]] = pair(m[2]);
    // wave 8 (Block vibe): one solid screen colour per region, light theme only (dark = the shared night colour).
    const sc = line.match(/^screen:\s*["']?(#[0-9A-Fa-f]{6})["']?/);
    if (sc) th.screen = sc[1];
  }
  return th;
}

function parsePack(file) {
  const txt = read(file);
  const lines = txt.split('\n');
  const top = (k) => lines.find((l) => l.startsWith(`${k}:`))?.slice(k.length + 1).replace(/#.*$/, '').trim();
  const pack = {};
  if (top('name')) pack.name = nameMap(top('name'));
  if (top('timezone')) pack.tz = unq(top('timezone'));
  if (top('currency')) pack.currency = unq(top('currency'));
  const center = top('center')?.match(/\[([-\d.]+),\s*([-\d.]+)\]/);
  if (center) pack.center = [Number(center[1]), Number(center[2])];
  for (const k of ['drive', 'rooms', 'homes']) if (top(k)) pack[k] = unq(top(k)).split('#')[0].trim();
  const travel = top('travel');
  if (travel) {
    const mode = travel.match(/mode:\s*([\w_]+)/)?.[1];
    const kmh = travel.match(/avg_kmh:\s*([\d.]+)/)?.[1];
    const rush = travel.match(/rush_factor:\s*([\d.]+)/)?.[1];
    pack.travel = { mode, kmh: kmh ? Number(kmh) : undefined, rush: rush ? Number(rush) : undefined };
  }
  // districts: inline "  slug: {name: {...}" or block "  slug:\n    name: {...}"
  const di = lines.findIndex((l) => /^districts:/.test(l));
  if (di >= 0) {
    pack.districts = {};
    let slug = null;
    for (let i = di + 1; i < lines.length; i++) {
      const l = lines[i];
      if (/^\S/.test(l)) break;
      let m;
      if ((m = l.match(/^ {2}([a-z0-9_]+):\s*\{\s*name:\s*(\{[^}]*\})/))) pack.districts[m[1]] = nameMap(m[2]);
      else if ((m = l.match(/^ {2}([a-z0-9_]+):\s*$/))) slug = m[1];
      else if (slug && (m = l.match(/^ {4}name:\s*(\{[^}]*\})/))) { pack.districts[slug] = nameMap(m[1]); slug = null; }
    }
  }
  return pack;
}

// regions/<country>/places.yaml (wave 4): "types:" block of one-line maps, "places:" list of 4-space block items.
const AREA_ALIAS = { kuta: 'kuta_legian', nusadua: 'nusa_dua' };
function parsePlaces(file) {
  const types = {};
  const places = [];
  let sec = null, cur = null;
  for (const raw of read(file).split('\n')) {
    const line = stripComment(raw);
    if (!line.trim()) continue;
    let m;
    if ((m = line.match(/^(types|places):/))) { sec = m[1]; continue; }
    if (/^\S/.test(line)) { sec = null; continue; }
    if (sec === 'types' && (m = line.match(/^ {2}([a-z_]+):\s*(\{.*\})\s*$/))) types[m[1]] = flowValue(m[2]);
    else if (sec === 'places' && (m = line.match(/^ {2}- id:\s*(.+)$/))) places.push((cur = { id: unq(m[1]) }));
    else if (sec === 'places' && cur && (m = line.match(/^ {4}([a-z_]+):\s*(.*)$/))) cur[m[1]] = flowValue(m[2]);
  }
  return {
    types,
    places: places.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon)).map((p) => ({
      id: p.id, name: String(p.name), type: p.type, tier: Number(p.tier) || 2, area: AREA_ALIAS[p.area] ?? p.area,
      lat: p.lat, lng: p.lon, note: { ru: p.note_ru ?? null, en: p.note_en ?? null }, tags: Array.isArray(p.tags) ? p.tags : [],
      // Wave 5: surf only, compass degrees the beach faces (offshore wind blows from faces+180).
      ...(Number.isFinite(p.faces) ? { faces: p.faces } : {}),
    })),
  };
}

// One top-level key with its indented block, as text ("" if absent), for yamlSubset.
function topBlock(txt, k) {
  const lines = txt.split('\n');
  const i = lines.findIndex((l) => l.startsWith(`${k}:`));
  if (i < 0) return '';
  let j = i + 1;
  while (j < lines.length && (!lines[j].trim() || /^\s/.test(lines[j]) || lines[j].startsWith('#'))) j++;
  return lines.slice(i, j).join('\n');
}
// Wave 5: pack.yaml `season_months: {high: [..], low: [..], wet: [..]}` -> same shape, months 1-12; missing keys -> [].
function seasonMonths(v) {
  if (!v || typeof v !== 'object') return null;
  const months = (a) => (Array.isArray(a) ? a.filter((n) => Number.isInteger(n) && n >= 1 && n <= 12) : []);
  return { high: months(v.high), low: months(v.low), wet: months(v.wet) };
}

// Wave 5: pack.yaml `location: {rings: [10, 20, 40], weights: [1.0, 0.7, 0.3]}` -> {rings, weights}; rings are
// ascending whole minutes, one weight per ring. Invalid or missing -> fallback (the default for a country, null for a sub pack).
const DEFAULT_LOCATION = { rings: [10, 20, 40], weights: [1, 0.7, 0.3] };
function locationRings(v, fallback) {
  const rings = v?.rings, weights = v?.weights;
  const ok = Array.isArray(rings) && rings.length >= 1 && rings.every((n, k) => Number.isInteger(n) && n > 0 && (k === 0 || n > rings[k - 1]))
    && Array.isArray(weights) && weights.length === rings.length && weights.every((w) => typeof w === 'number' && w >= 0 && w <= 1);
  if (!ok) {
    if (v != null) console.warn(`copy-art: ignoring invalid location ${JSON.stringify(v)}`);
    return fallback;
  }
  return { rings, weights };
}

// Wave 5: sub-region price_ref -> {currency, basis, beds: {"1": [lo, hi]}, median: {"2": n}} in main currency units.
// Keys: 1br/2br/3br (bedrooms), 1k/2k/3k (Kazakh room count, same keys as districts.yaml price), studio -> "0",
// <word>_2br style keys (koh_phangan) when no plain key exists. Value: the first "lo-hi" range ("10M-18M", "190k–300k (...)").
// Medians come from the note text: "2BR median 22M".
const money = (n, suf) => { const v = Number(String(n).replace(/,/g, '')); const k = { k: 1e3, m: 1e6 }[String(suf).toLowerCase()] ?? 1; return Number.isFinite(v) ? Math.round(v * k) : null; };
function priceRange(s) {
  const m = String(s ?? '').match(/(\d[\d.,]*)\s*([kKmM]?)\s*[-–—]\s*(\d[\d.,]*)\s*([kKmM]?)/);
  if (!m) return null;
  const lo = money(m[1], m[2] || m[4]), hi = money(m[3], m[4]);
  return lo != null && hi != null && lo <= hi ? [lo, hi] : null;
}
function priceRef(ref, currency) {
  if (!ref || typeof ref !== 'object') return null;
  const beds = {}, loose = {};
  let basis = 'bedrooms';
  for (const [k, v] of Object.entries(ref)) {
    const r = priceRange(v);
    if (!r) continue;
    let m;
    if (k === 'studio') beds['0'] = r;
    else if ((m = k.match(/^(\d)br$/))) beds[m[1]] = r;
    else if ((m = k.match(/^(\d)k$/))) { beds[m[1]] = r; basis = 'rooms'; }
    else if ((m = k.match(/^(?:[a-z]+_)+(\d)br$/))) loose[m[1]] ??= r;
  }
  for (const [n, r] of Object.entries(loose)) beds[n] ??= r;
  if (!Object.keys(beds).length) return null;
  const median = {};
  for (const m of String(ref.note ?? '').matchAll(/(\d)\s*BR\s+median\s+(\d[\d.,]*)\s*([kKmM]?)/gi)) median[m[1]] = money(m[2], m[3]);
  return { currency: currency ?? null, basis, beds, ...(Object.keys(median).length ? { median } : {}) };
}

// regions/<country>/checklist.yaml: "  - id: x" / "    icon: y" / "    label: {en: .., ru: ..}" / "    hint: {..}"
function parseChecklist(file) {
  const items = [];
  let cur = null;
  for (const line of read(file).split('\n')) {
    let m;
    if ((m = line.match(/^\s*-\s*id:\s*([a-z0-9_]+)/))) items.push((cur = { id: m[1] }));
    else if (cur && (m = line.match(/^\s+icon:\s*([a-z0-9-]+)/))) cur.icon = m[1];
    else if (cur && (m = line.match(/^\s+(label|hint):\s*(\{.*\})/))) cur[m[1]] = nameMap(m[2]);
  }
  return items;
}

// Wave 6: regions/<country>/useful.yaml (+ <city>/useful.yaml) -> {verified, items: [{id, city, name, url, kind, category,
// about: {ru, en}, lang, last_checked, activity, events, attribution, icon}]}; a city item with the same id replaces the country one
// for that city. Links must be https:// (t.me, stores, sites) or hunt:<screen> for kind hunt; anything else is dropped.
const USEFUL_KINDS = ['telegram', 'app', 'web', 'hunt'];
const USEFUL_CATS = ['chats_rent', 'flea', 'bikes', 'news', 'visas', 'medicine', 'food', 'apps', 'guides', 'maps', 'other'];
function usefulItems(file, city) {
  const y = yamlSubset(read(file));
  const items = [];
  for (const it of Array.isArray(y.items) ? y.items : []) {
    const id = String(it?.id ?? '');
    const url = String(it?.url ?? '');
    const kind = USEFUL_KINDS.includes(it?.kind) ? it.kind : 'web';
    const okUrl = kind === 'hunt' ? /^hunt:[a-z]+$/.test(url) : /^https:\/\/[^\s]+$/.test(url);
    if (!/^[a-z0-9-]+$/.test(id) || !it.name || !okUrl) { console.warn(`copy-art: ${file}: skipping useful item ${JSON.stringify(it?.id)}`); continue; }
    const day = (v) => (v != null && /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : null);
    items.push({
      id, city, name: String(it.name), url, kind, category: USEFUL_CATS.includes(it.category) ? it.category : 'other',
      about: { ru: it.about?.ru ?? null, en: it.about?.en ?? it.about?.ru ?? null }, lang: it.lang ?? null, last_checked: day(it.last_checked),
      activity: it.activity && typeof it.activity === 'object' ? it.activity : null, events: it.events === true, attribution: it.attribution ?? null,
      icon: typeof it.icon === 'string' && /^[a-z0-9-]+$/.test(it.icon) ? it.icon : null,
    });
  }
  return { verified: day0(y.verified), items };
}
const day0 = (v) => (v != null ? String(v) : null);
function usefulOf(cdir) {
  const files = [[join(cdir, 'useful.yaml'), null]];
  for (const s of readdirSync(cdir).sort()) if (existsSync(join(cdir, s, 'useful.yaml'))) files.push([join(cdir, s, 'useful.yaml'), s]);
  const got = files.filter(([f]) => existsSync(f)).map(([f, c]) => usefulItems(f, c));
  if (!got.length) return null;
  return { verified: got.map((g) => g.verified).filter(Boolean).sort().pop() ?? null, items: got.flatMap((g) => g.items) };
}

// Wave 7: Афиша effects + event sources. regions/_generic/events.yaml (core defaults) <- <country>/events.yaml <- <city>/events.yaml
// (later files override earlier keys) -> {effects: {key: {shader, mix}}, sources: [...]}; key = topic or category, mix 0..1
// (default 1), shader "none" -> null (explicitly no effect: overrides a default and stops the topic -> category fallback). Bad entries are skipped with a warning.
const SHADERS = ['embers', 'caustics', 'bokeh', 'foam', 'mist', 'rays', 'droplets', 'steam', 'smoke', 'grain', 'confetti', 'stars',
  'fireflies', 'neon', 'floodlight'];
const EVENT_SOURCE_KINDS = ['venue', 'instagram', 'facebook', 'web', 'place', 'ticket'];
const EVENT_SOURCE_READ = ['jsonld', 'og', 'list', 'ics'];
function eventEffects(raw, file) {
  const effects = {};
  if (raw == null) return effects;
  if (typeof raw !== 'object' || Array.isArray(raw)) { console.warn(`copy-art: ${file}: effects must be a map`); return effects; }
  for (const [key, v] of Object.entries(raw)) {
    const shader = v && typeof v === 'object' ? v.shader : v;
    const mix = v && typeof v === 'object' && v.mix != null ? v.mix : 1;
    if (!/^[a-z_]{2,30}$/.test(key)) { console.warn(`copy-art: ${file}: skipping effect key ${JSON.stringify(key)}`); continue; }
    if (shader === 'none') { effects[key] = null; continue; }
    if (!SHADERS.includes(shader) || typeof mix !== 'number' || mix < 0 || mix > 1) {
      console.warn(`copy-art: ${file}: skipping effect ${key}: ${JSON.stringify(v)}`);
      continue;
    }
    effects[key] = { shader, mix };
  }
  return effects;
}
function eventSources(raw, file, city) {
  const out = [];
  for (const s of Array.isArray(raw) ? raw : []) {
    const id = String(s?.id ?? '');
    if (!/^[a-z0-9-]+$/.test(id) || !s.name || !/^https:\/\/[^\s]+$/.test(String(s.url ?? '')) || !EVENT_SOURCE_KINDS.includes(s.kind)) {
      console.warn(`copy-art: ${file}: skipping event source ${JSON.stringify(s?.id)}`);
      continue;
    }
    const topics = Array.isArray(s.topics) ? s.topics.filter((t) => /^[a-z_]{2,30}$/.test(String(t))) : [];
    out.push({
      id, name: String(s.name), url: String(s.url), kind: s.kind, city: s.city ?? city ?? null, area: s.area ?? null, topics,
      recurring: s.recurring != null ? String(s.recurring) : null, lang: s.lang ?? null, note: s.note != null ? String(s.note) : null,
      // wave 8.1: a verified recurring source fills an empty Афиша (Russian title + schedule line, usual start)
      name_ru: s.name_ru != null ? String(s.name_ru) : null, recurring_ru: s.recurring_ru != null ? String(s.recurring_ru) : null,
      starts: /^\d{1,2}:\d{2}$/.test(String(s.starts ?? '')) ? String(s.starts) : null,
      // wave 9: the page that lists the events (if not url) and how the agent reads it (event_source_read)
      events_url: /^https:\/\/[^\s]+$/.test(String(s.events_url ?? '')) ? String(s.events_url) : null,
      read: EVENT_SOURCE_READ.includes(s.read) ? s.read : null,
    });
    if (s.events_url != null && out.at(-1).events_url == null) console.warn(`copy-art: ${file}: ${id}: events_url must be https, dropped`);
    if (s.read != null && out.at(-1).read == null) console.warn(`copy-art: ${file}: ${id}: unknown read ${JSON.stringify(s.read)}, dropped`);
  }
  return out;
}
// Wave 9: party rules ("Своя тусовка"): {quiet_after "HH:MM", hint_ru, hint_en, notice_owner, notice_neighbours, fines_ru?,
// fines_en?}; generic -> country -> city, key by key. Bad keys/values are skipped with a warning.
const PARTY_TEXT = ['hint_ru', 'hint_en', 'fines_ru', 'fines_en'];
const PARTY_BOOL = ['notice_owner', 'notice_neighbours'];
function partyRules(raw, file) {
  const out = {};
  if (raw == null) return out;
  if (typeof raw !== 'object' || Array.isArray(raw)) { console.warn(`copy-art: ${file}: party must be a map`); return out; }
  for (const [k, v] of Object.entries(raw)) {
    if (k === 'quiet_after' && /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v ?? ''))) out[k] = String(v);
    else if (PARTY_TEXT.includes(k) && typeof v === 'string' && v.trim()) out[k] = v.trim();
    else if (PARTY_BOOL.includes(k) && typeof v === 'boolean') out[k] = v;
    else console.warn(`copy-art: ${file}: skipping party.${k}: ${JSON.stringify(v)}`);
  }
  return out;
}
function eventsOf(cdir) {
  const files = [[join(packDir('_generic'), 'events.yaml'), null]];
  if (cdir) {
    files.push([join(cdir, 'events.yaml'), null]);
    for (const s of readdirSync(cdir).sort()) if (existsSync(join(cdir, s, 'events.yaml'))) files.push([join(cdir, s, 'events.yaml'), s]);
  }
  let effects = {};
  let party = {};
  const sources = new Map();
  for (const [f, city] of files) {
    if (!existsSync(f)) continue;
    const y = yamlSubset(read(f));
    effects = { ...effects, ...eventEffects(y.effects, f) };
    // a city file's party keys would apply to the whole country export: only generic + country files set them
    if (!city) party = { ...party, ...partyRules(y.party, f) };
    else if (y.party != null) console.warn(`copy-art: ${f}: party rules are per country, ignored in a city file`);
    for (const s of eventSources(y.sources, f, city)) sources.set(s.id, s);
  }
  return { effects, sources: [...sources.values()], party: Object.keys(party).length ? party : null };
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// The site's demo (public/demo-home, invented data) works without any region pack: its two animals come along.
const demoAn = join(crm, 'public', 'demo-home', 'animals');
if (existsSync(demoAn)) {
  mkdirSync(join(toysOut, 'demo'), { recursive: true });
  mkdirSync(join(out, 'demo', 'avatars'), { recursive: true });
  for (const f of readdirSync(demoAn)) copyFileSync(join(demoAn, f), f.endsWith('.svg') ? join(out, 'demo', 'avatars', f) : join(toysOut, 'demo', f));
}

const animals = {};
const tz = {};
const regionsJson = {};
const themes = {};

for (const country of [...new Set([...readdirSync(regionsDir), '_generic'])].sort()) {
  const cdir = packDir(country);
  if (!statSync(cdir).isDirectory()) continue;
  const art = join(cdir, 'art');
  if (existsSync(art)) {
    const dst = join(out, country);
    mkdirSync(join(dst, 'avatars'), { recursive: true });
    for (const f of readdirSync(art)) if (f.endsWith('.svg')) copyFileSync(join(art, f), join(dst, f));
    const av = join(art, 'avatars');
    if (existsSync(av)) {
      for (const f of readdirSync(av)) if (f.endsWith('.svg')) copyFileSync(join(av, f), join(dst, 'avatars', f));
      if (existsSync(join(av, 'index.yaml'))) animals[country] = parseAvatars(join(av, 'index.yaml'));
    }
    // Glossy toys rendered from the avatars (skills/hunt-art) -> /toys/<country>/<slug>[-full]-192|384.webp; toy land -> /art/<country>/island.*
    const ty = join(art, 'toys');
    if (existsSync(ty)) {
      mkdirSync(join(toysOut, country), { recursive: true });
      for (const f of readdirSync(ty)) if (/^[a-z0-9_-]+\.webp$/.test(f)) copyFileSync(join(ty, f), join(toysOut, country, f));
    }
    for (const f of readdirSync(art)) if (/^island(-[a-z0-9_]+)?\.(webp|json)$/.test(f)) copyFileSync(join(art, f), join(dst, f));
    if (existsSync(join(art, 'theme.yaml'))) themes[country] = parseTheme(join(art, 'theme.yaml'));
  }
  if (country === '_generic') continue;
  const packFile = join(cdir, 'pack.yaml');
  const pack = existsSync(packFile) ? parsePack(packFile) : {};
  if (pack.tz) tz[country] = pack.tz;
  const sub = {};
  for (const s of readdirSync(cdir).sort()) {
    const sp = join(cdir, s, 'pack.yaml');
    if (!existsSync(sp)) continue;
    sub[s] = parsePack(sp);
    // Wave 5: market fallback for the CRM negotiation helper.
    const ref = priceRef(yamlSubset(topBlock(read(sp), 'price_ref')).price_ref, sub[s].currency ?? pack.currency);
    if (ref) sub[s].price_ref = ref;
    const subLoc = locationRings(topLine(read(sp), 'location'), null);
    if (subLoc) sub[s].location = subLoc;
  }
  const ck = join(cdir, 'checklist.yaml');
  const ownerDocs = existsSync(packFile) ? read(packFile).split('\n').find((l) => l.startsWith('owner_docs:')) : null;
  // Wave 3: power tokens, visa lead time, emergency numbers/places, districts (areas) + outlines.
  const packTxt = existsSync(packFile) ? read(packFile) : '';
  const em = join(cdir, 'emergency.yaml');
  const di = join(cdir, 'districts.yaml');
  let areas = null;
  if (existsSync(di)) {
    areas = yamlSubset(read(di)).areas ?? null;
    for (const a of Object.values(areas ?? {})) delete a.osm;
  }
  if (existsSync(join(cdir, 'districts.geojson'))) {
    mkdirSync(join(out, country), { recursive: true });
    copyFileSync(join(cdir, 'districts.geojson'), join(out, country, 'districts.geojson'));
  }
  // Wave 4: base places (separate file, the Worker and the Mini App load it on demand) and the local calendar.
  const pl = join(cdir, 'places.yaml');
  if (existsSync(pl)) {
    mkdirSync(join(out, country), { recursive: true });
    const data = parsePlaces(pl);
    writeFileSync(join(out, country, 'places.json'), JSON.stringify(data));
    console.log(`copy-art: ${country} places ${data.places.length}`);
  }
  // Wave 6: "Полезное" (useful.yaml, country + optional city sub-packs) -> /art/<country>/useful.json, read by the Worker
  // (merged with the approved D1 suggestions in /app/api/useful), never by the client directly.
  const useful = usefulOf(cdir);
  if (useful) {
    mkdirSync(join(out, country), { recursive: true });
    writeFileSync(join(out, country, 'useful.json'), JSON.stringify(useful));
    console.log(`copy-art: ${country} useful ${useful.items.length}`);
  }
  const cal = join(cdir, 'calendar.yaml');
  regionsJson[country] = {
    calendar: existsSync(cal) ? yamlSubset(read(cal)) : null,
    places: existsSync(pl),
    power: topLine(packTxt, 'power'),
    visa: topLine(packTxt, 'visa'),
    housing_ads: topLine(packTxt, 'housing_ads'),
    emergency: existsSync(em) ? yamlSubset(read(em)) : null,
    areas,
    name: pack.name,
    checklist: existsSync(ck) ? parseChecklist(ck) : [],
    owner_docs: ownerDocs ? nameMap(ownerDocs.slice('owner_docs:'.length)) : null,
    tz: pack.tz,
    currency: pack.currency,
    scene: existsSync(join(art, 'motif-scene.svg')),
    // The toy land for the big map (skills/hunt-art `island`): '' = the whole country, else the city folder.
    islands: existsSync(art) ? readdirSync(art).map((f) => f.match(/^island(?:-([a-z0-9_]+))?\.json$/)).filter((m) => m && existsSync(join(art, m[0].replace('.json', '.webp')))).map((m) => m[1] ?? '') : [],
    // Wave 5: month numbers from pack.yaml `season_months` (null if the pack has none).
    seasons: seasonMonths(topLine(packTxt, 'season_months')),
    // Wave 5: location score rings (minutes) and their weights; default when the pack has none.
    location: locationRings(topLine(packTxt, 'location'), DEFAULT_LOCATION),
    // Wave 7: Афиша effect table + event sources (generic defaults when the country has no events.yaml).
    events: eventsOf(cdir),
    sub,
  };
}

// ---- regions.css
// Wave 8 (Block vibe, DESIGN.md "Update 21.11.2026"): a region gives its screen colour (--screen; the dark theme and the
// evening screens use the shared night tokens in app.css instead), the old accent for maps and motifs (--region-accent,
// light / dark) and the small detail colour. Buttons, figures and focus are ink now (app.css), not the region accent.
const block = (sel, mode) =>
  Object.entries(themes)
    .map(([c, th]) => {
      if (!th.accent && !th.screen) return '';
      const v = (k, d) => th[k]?.[mode] ?? d;
      const vars = [mode === 'light' && th.screen ? `--screen:${th.screen}` : null, th.accent ? `--region-accent:${v('accent')}` : null, `--detail:${v('detail', v('accent', '#151413'))}`];
      return `${sel(c)}{${vars.filter(Boolean).join(';')}}`;
    })
    .filter(Boolean)
    .join('\n');
const css = [
  '/* Generated by scripts/copy-art.mjs from the region packs (art/theme.yaml). Do not edit. */',
  block((c) => `[data-region="${c}"]`, 'light'),
  '@media (prefers-color-scheme: dark){',
  block((c) => `:root:not([data-theme="light"])[data-region="${c}"],:root:not([data-theme="light"]) [data-region="${c}"]`, 'dark'),
  '}',
  block((c) => `:root[data-theme="dark"][data-region="${c}"],:root[data-theme="dark"] [data-region="${c}"]`, 'dark'),
  '',
].join('\n');
writeFileSync(join(out, 'regions.css'), css);
writeFileSync(join(out, 'regions.json'), JSON.stringify(regionsJson));

// ---- src/animals.ts
const ts = `// Generated by scripts/copy-art.mjs from plugins/hunt/regions/*/art/avatars/index.yaml. Do not edit.
export interface Animal {
  slug: string;
  name: { en: string; ru: string };
  bg_light: string;
  bg_dark: string;
}

export const ANIMALS: Record<string, Animal[]> = ${JSON.stringify(animals, null, 2)};

/** Default timezone per country region (from pack.yaml). */
export const REGION_TZ: Record<string, string> = ${JSON.stringify(tz, null, 2)};
`;
writeFileSync(join(crm, 'src', 'animals.ts'), ts);

// Demo photos from scripts/seed-demo.mjs are for local runs only: `--no-demo` (npm predeploy) drops them.
if (process.argv.includes('--no-demo') && existsSync(join(crm, 'public', 'demo'))) {
  rmSync(join(crm, 'public', 'demo'), { recursive: true, force: true });
  console.log('copy-art: removed public/demo (local demo photos)');
}

const n = Object.values(animals).reduce((a, l) => a + l.length, 0);
console.log(`copy-art: ${Object.keys(animals).length} packs, ${n} avatars, themes: ${Object.keys(themes).join(', ')}`);
