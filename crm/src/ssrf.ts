// Wave 9 · pure SSRF guard for the event image proxy (no D1, no Env; checked by scripts/test-wave9-pure.mts):
// https only, default port, no credentials, every resolved address public, manual redirects re-checked, ≤ 5 MB, image bytes only.

/** FNV-1a 32-bit of a string, base36 (the photo URL's version in proxy links). */
export function fnv(s: string): string {
  let x = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; }
  return x.toString(36);
}
export const proxySrc = (eventId: string, url: string) => `/img/e/${encodeURIComponent(eventId)}/${fnv(url)}`;

/** Hosts we never fetch (local, metadata, known-bad); extendable. */
const BLOCK_HOST = /(^|\.)(localhost|local|internal|intranet|home\.arpa|metadata\.google\.internal|test|invalid|example)$/i;
export const MAX_IMG = 5 * 1024 * 1024;

/** True for a public unicast IPv4/IPv6 literal; false for private, loopback, link-local, CGNAT, multicast, reserved. */
export function publicIp(ip: string): boolean {
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b, c] = v4.slice(1).map(Number);
    if (v4.slice(1).some((x) => Number(x) > 255)) return false;
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    if (a === 198 && b === 51 && c === 100) return false;
    if (a === 203 && b === 0 && c === 113) return false;
    return true;
  }
  const s = ip.toLowerCase().replace(/^\[|\]$/g, '');
  if (!s.includes(':')) return false;
  if (s === '::' || s === '::1') return false;
  const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return publicIp(mapped[1]);
  const first = parseInt(s.split(':')[0] || '0', 16);
  if ((first & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return false; // link-local
  if ((first & 0xff00) === 0xff00) return false; // multicast
  if (first === 0x2001 && parseInt(s.split(':')[1] || '0', 16) === 0x0db8) return false; // documentation
  if (first === 0x64 && s.startsWith('64:ff9b:')) return false; // NAT64 to anything
  return (first & 0xe000) === 0x2000; // global unicast 2000::/3
}

type Resolver = (host: string) => Promise<string[]>;
/** A/AAAA of a host over DNS-over-HTTPS (Cloudflare); throws when nothing resolves. */
export const dohResolve: Resolver = async (host) => {
  const ips: string[] = [];
  for (const type of ['A', 'AAAA']) {
    const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`, { headers: { accept: 'application/dns-json' }, cf: { cacheTtl: 300 } } as RequestInit);
    if (!r.ok) continue;
    const j: any = await r.json().catch(() => null);
    for (const a of j?.Answer ?? []) if ((a.type === 1 || a.type === 28) && typeof a.data === 'string') ips.push(a.data);
  }
  return ips;
};

/** Checks one URL against the SSRF rules (scheme, port, credentials, host, every resolved address). Returns a reason or null. */
export async function urlBlocked(raw: string, resolve: Resolver = dohResolve): Promise<string | null> {
  let u: URL;
  try { u = new URL(raw); } catch { return 'bad_url'; }
  if (u.protocol !== 'https:') return 'not_https';
  if (u.port && u.port !== '443') return 'port';
  if (u.username || u.password) return 'credentials';
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!host || BLOCK_HOST.test(host)) return 'blocked';
  if (/^[\d.]+$/.test(host) || host.includes(':')) return publicIp(host) ? null : 'private_ip';
  let ips: string[];
  try { ips = await resolve(host); } catch { return 'dns'; }
  if (!ips.length) return 'dns';
  return ips.every(publicIp) ? null : 'private_ip';
}

/** Fetch an image under the SSRF rules: manual redirects (re-checked), ≤ MAX_IMG, image bytes only. */
export async function safeImageFetch(raw: string, opts: { resolve?: Resolver; fetcher?: typeof fetch; ttl?: number } = {}): Promise<{ ok: true; body: Uint8Array; type: string } | { ok: false; fail: string }> {
  const f = opts.fetcher ?? fetch;
  let url = raw;
  for (let hop = 0; hop < 4; hop++) {
    const why = await urlBlocked(url, opts.resolve);
    if (why) return { ok: false, fail: why === 'blocked' || why === 'private_ip' ? 'blocked' : why === 'dns' ? 'error' : 'blocked' };
    let r: Response;
    try {
      r = await f(url, { redirect: 'manual', headers: { accept: 'image/avif,image/webp,image/jpeg,image/png,image/*;q=0.8', 'user-agent': 'HuntImageProxy/1.0 (+read-only)' },
        cf: { cacheTtl: opts.ttl ?? 21600, cacheEverything: true } } as RequestInit);
    } catch { return { ok: false, fail: 'error' }; }
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get('location');
      if (!loc) return { ok: false, fail: 'error' };
      url = new URL(loc, url).toString();
      continue;
    }
    if (r.status === 404 || r.status === 410) return { ok: false, fail: '404' };
    if (r.status === 401 || r.status === 403 || r.status === 451) return { ok: false, fail: 'refused' };
    if (!r.ok || !r.body) return { ok: false, fail: 'error' };
    const ct = (r.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!ct.startsWith('image/') || ct.includes('svg')) return { ok: false, fail: 'not_image' };
    if (Number(r.headers.get('content-length') ?? 0) > MAX_IMG) return { ok: false, fail: 'too_big' };
    // Stream with a hard cap (content-length may lie or be missing).
    const reader = r.body.getReader();
    const chunks: Uint8Array[] = [];
    let n = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      n += value.byteLength;
      if (n > MAX_IMG) { await reader.cancel().catch(() => null); return { ok: false, fail: 'too_big' }; }
      chunks.push(value);
    }
    const body = new Uint8Array(n);
    let off = 0;
    for (const c of chunks) { body.set(c, off); off += c.byteLength; }
    const type = sniffAny(body);
    if (!type) return { ok: false, fail: 'not_image' };
    return { ok: true, body, type };
  }
  return { ok: false, fail: 'error' };
}
/** jpeg / png / webp / gif / avif by their first bytes (the declared type is not trusted). */
export function sniffAny(b: Uint8Array): string | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length > 12 && String.fromCharCode(...b.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...b.subarray(8, 12)) === 'WEBP') return 'image/webp';
  if (b.length > 6 && String.fromCharCode(...b.subarray(0, 6)).startsWith('GIF8')) return 'image/gif';
  if (b.length > 12 && String.fromCharCode(...b.subarray(4, 8)) === 'ftyp' && /avi[fs]/.test(String.fromCharCode(...b.subarray(8, 12)))) return 'image/avif';
  return null;
}

