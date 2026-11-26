import { Env, parseJson } from './util';
import { ANIMALS, REGION_TZ, Animal } from './animals';

/** 'bali/bukit' -> 'bali' */
export const countryOf = (region: string | null | undefined): string => String(region ?? '').split('/')[0] || '_generic';

export const regionTz = (region: string | null | undefined): string => REGION_TZ[countryOf(region)] ?? 'UTC';

export interface AnimalInfo extends Animal {
  pack: string; // folder under /art/
}

/** Avatar data for a stored slug: the country pack first, then the generic pack. */
export function animalInfo(region: string | null | undefined, slug: string | null | undefined): AnimalInfo | null {
  if (!slug) return null;
  for (const pack of [countryOf(region), '_generic']) {
    const a = ANIMALS[pack]?.find((x) => x.slug === slug);
    if (a) return { ...a, pack };
  }
  return null;
}

async function pickAnimal(env: Env, searchId: string, region: string, exclude: string | null): Promise<string | null> {
  const used = new Set(
    (await env.DB.prepare('SELECT animal FROM members WHERE search_id=? AND animal IS NOT NULL').bind(searchId).all<{ animal: string }>()).results.map((r) => r.animal),
  );
  const own = ANIMALS[countryOf(region)] ?? [];
  const generic = ANIMALS._generic ?? [];
  const free = (l: Animal[]) => l.filter((a) => !used.has(a.slug) && a.slug !== exclude);
  let pool = free(own);
  if (!pool.length) pool = free(generic);
  if (!pool.length) pool = (own.length ? own : generic).filter((a) => a.slug !== exclude);
  if (!pool.length) return null;
  const r = new Uint32Array(1);
  crypto.getRandomValues(r);
  return pool[r[0] % pool.length].slug;
}

async function regionOf(env: Env, searchId: string): Promise<string> {
  const s = await env.DB.prepare('SELECT region FROM searches WHERE id=?').bind(searchId).first<{ region: string }>();
  return s?.region ?? '';
}

/** Give a member an animal if they have none. */
export async function assignAnimal(env: Env, searchId: string, userId: string, region?: string): Promise<void> {
  const slug = await pickAnimal(env, searchId, region ?? (await regionOf(env, searchId)), null);
  if (slug) await env.DB.prepare('UPDATE members SET animal=? WHERE search_id=? AND user_id=? AND animal IS NULL').bind(slug, searchId, userId).run();
}

/** Add someone to a search (no-op if already there); new members get an animal. */
export async function ensureMember(env: Env, searchId: string, userId: string, role: 'owner' | 'member' | 'viewer' = 'member'): Promise<void> {
  const r = await env.DB.prepare('INSERT OR IGNORE INTO members (search_id, user_id, role) VALUES (?,?,?)').bind(searchId, userId, role).run();
  if (r.meta.changes) await assignAnimal(env, searchId, userId);
}

/** Members created before animals existed get one lazily. */
export async function ensureAnimals(env: Env, searchId: string, region: string): Promise<void> {
  const missing = (await env.DB.prepare('SELECT user_id FROM members WHERE search_id=? AND animal IS NULL').bind(searchId).all<{ user_id: string }>()).results;
  for (const m of missing) await assignAnimal(env, searchId, m.user_id, region);
}

/** "Another animal" button: a different unused one. */
export async function rerollAnimal(env: Env, searchId: string, userId: string, region: string): Promise<string | null> {
  const cur = await env.DB.prepare('SELECT animal FROM members WHERE search_id=? AND user_id=?').bind(searchId, userId).first<{ animal: string | null }>();
  const slug = await pickAnimal(env, searchId, region, cur?.animal ?? null);
  if (slug) await env.DB.prepare('UPDATE members SET animal=? WHERE search_id=? AND user_id=?').bind(slug, searchId, userId).run();
  return slug;
}

// Brief keys the Mini App shows. budget_cap* never leaves the agent; budget_said goes to the owner only.
const BRIEF_PUBLIC = [
  'bedrooms', 'budget_min', 'budget_max', 'property_type', 'districts', 'term', 'payment_terms', 'must_have', 'nice_to_have', 'deal_breakers',
  'move_in_flex', 'utilities_in_budget', 'living_room', 'pool', 'budget_includes_electricity', 'payment_upfront', 'construction_tolerance', 'transport', 'style',
];
export const isPrivateBriefKey = (k: string) => k === 'budget_said' || k.startsWith('budget_cap');

/** What a member may see from the brief: budget_cap stays with the agent, budget_said with the owner. */
export function publicBrief(region: string, raw: string | null, role: string) {
  const b = parseJson<any>(raw, {});
  const extra: Record<string, unknown> = {};
  for (const k of BRIEF_PUBLIC) if (b[k] != null && b[k] !== '') extra[k] = b[k];
  const a = b.anchor;
  const anchor = a && typeof a === 'object' && Number.isFinite(Number(a.lat)) && Number.isFinite(Number(a.lng))
    ? { lat: Number(a.lat), lng: Number(a.lng), label: a.label ?? null, to_label: a.to_label ?? null, icon: a.icon ?? null }
    : null;
  return {
    ...extra,
    move_in: b.move_in ?? null,
    term: b.term ?? null,
    ...(role === 'owner' ? { budget_said: b.budget_said ?? null } : {}),
    currency: b.currency ?? null,
    anchor: anchor && { ...anchor, max_minutes: Number(a.max_minutes ?? a.minutes) || null },
    anchors: Array.isArray(b.anchors) ? b.anchors : [],
    anchor_text: typeof a === 'string' ? a : null,
    timezone: b.timezone ?? regionTz(region),
    travel_kmh: Number(b.region_meta?.travel_kmh) || null,
    travel_mode: b.region_meta?.travel_mode ?? null,
  };
}

