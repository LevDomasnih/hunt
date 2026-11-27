// A KV-shaped store in the same SQLite file (table _cf_kv: account deletion skips _cf_ tables), for node/server.mjs. It covers what src/ uses:
// get, getWithMetadata (text | json | arrayBuffer | stream), put with metadata and expirationTtl, delete, list by prefix with a cursor.

const toBytes = async (v) => {
  if (typeof v === 'string') return new TextEncoder().encode(v);
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  if (v && typeof v.getReader === 'function') return new Uint8Array(await new Response(v).arrayBuffer());
  throw new TypeError('KV put: unsupported value');
};

const as = (bytes, type) => {
  if (bytes == null) return null;
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  switch (type ?? 'text') {
    case 'text': return new TextDecoder().decode(b);
    case 'json': return JSON.parse(new TextDecoder().decode(b));
    case 'arrayBuffer': return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    case 'stream': return new Response(b).body;
    default: throw new TypeError(`KV get: unknown type ${type}`);
  }
};

export class NodeKV {
  /** @param {import('node:sqlite').DatabaseSync} db */
  constructor(db) {
    this.db = db;
    db.exec('CREATE TABLE IF NOT EXISTS _cf_kv (key TEXT PRIMARY KEY, value BLOB NOT NULL, metadata TEXT, expires INTEGER)');
  }
  row(key) {
    const r = this.db.prepare('SELECT value, metadata, expires FROM _cf_kv WHERE key=?').get(key);
    if (!r) return null;
    if (r.expires && r.expires <= Date.now() / 1000) { this.db.prepare('DELETE FROM _cf_kv WHERE key=?').run(key); return null; }
    return r;
  }
  async get(key, opts) {
    const r = this.row(key);
    return r ? as(r.value, typeof opts === 'string' ? opts : opts?.type) : null;
  }
  async getWithMetadata(key, opts) {
    const r = this.row(key);
    if (!r) return { value: null, metadata: null };
    return { value: as(r.value, typeof opts === 'string' ? opts : opts?.type), metadata: r.metadata ? JSON.parse(r.metadata) : null };
  }
  async put(key, value, opts = {}) {
    const exp = opts.expiration ? Number(opts.expiration) : opts.expirationTtl ? Math.floor(Date.now() / 1000) + Number(opts.expirationTtl) : null;
    this.db.prepare('INSERT OR REPLACE INTO _cf_kv (key, value, metadata, expires) VALUES (?, ?, ?, ?)')
      .run(key, await toBytes(value), opts.metadata == null ? null : JSON.stringify(opts.metadata), exp);
  }
  async delete(key) { this.db.prepare('DELETE FROM _cf_kv WHERE key=?').run(key); }
  /** Keys in order; the cursor is the last key of the previous page. */
  async list(opts = {}) {
    const limit = Math.min(1000, opts.limit ?? 1000), prefix = opts.prefix ?? '', after = opts.cursor ?? '';
    const rows = this.db.prepare(`SELECT key, metadata, expires FROM _cf_kv WHERE key >= ? AND key < ? AND key > ? AND (expires IS NULL OR expires > ?)
      ORDER BY key LIMIT ?`).all(prefix, prefix + '￿', after, Math.floor(Date.now() / 1000), limit + 1);
    const page = rows.slice(0, limit);
    const done = rows.length <= limit;
    return {
      keys: page.map((r) => ({ name: r.key, ...(r.expires ? { expiration: r.expires } : {}), ...(r.metadata ? { metadata: JSON.parse(r.metadata) } : {}) })),
      list_complete: done,
      ...(done ? {} : { cursor: page[page.length - 1].key }),
    };
  }
  /** Drop expired values (the server's cron calls it). */
  sweep() { return Number(this.db.prepare('DELETE FROM _cf_kv WHERE expires IS NOT NULL AND expires <= ?').run(Math.floor(Date.now() / 1000)).changes); }
}
