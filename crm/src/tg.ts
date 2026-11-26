import { Env, HttpError } from './util';

/** Minimal Telegram Bot API client. */
/** The local-dev placeholder from crm/README.md; only this exact value switches the bot to dry mode. */
export const FAKE_BOT_TOKEN = '000:fake';
const botToken = (env: Env) => String(env.TG_BOT_TOKEN ?? '').trim();
export const tgDry = (env: Env) => botToken(env) === FAKE_BOT_TOKEN;

/** Dry-run log line without secrets: agent tokens, signed link/photo/doc tokens, invite codes, guide tokens. */
export function redactForLog(s: string): string {
  return s
    .replace(/hunt_[A-Za-z0-9_-]{8,}/g, 'hunt_***')
    .replace(/([?&](?:k|t|start|startgroup|startapp)=)[^&"\s\\]+/g, '$1***')
    .replace(/\/g\/[a-f0-9]{32}/g, '/g/***');
}

export async function tg<T = any>(env: Env, method: string, params: Record<string, unknown> | FormData): Promise<T> {
  // Local dev runs with the fake token: never call api.telegram.org with it.
  if (tgDry(env)) {
    // Show what would have been sent (secrets masked), then refuse as before.
    if (!(params instanceof FormData)) console.log(`[tg dry] ${method} ${redactForLog(JSON.stringify(params)).slice(0, 1500)}`);
    throw new HttpError(503, 'telegram_off', `${method}: no real bot token configured`);
  }
  const url = `https://api.telegram.org/bot${botToken(env)}/${method}`;
  const init: RequestInit =
    params instanceof FormData
      ? { method: 'POST', body: params }
      : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params) };
  const r = await fetch(url, init);
  const data: any = await r.json().catch(() => ({ ok: false, description: `HTTP ${r.status}` }));
  if (!data.ok) throw new HttpError(502, 'telegram', `${method}: ${data.description}`);
  return data.result as T;
}

export interface InlineButton {
  text: string;
  callback_data?: string;
  url?: string;
  web_app?: { url: string };
}

export const kb = (rows: InlineButton[][]) => ({ inline_keyboard: rows });

/** Largest photo size file_id from a Telegram message. */
export function photoOf(msg: any): { file_id: string; w: number; h: number } | null {
  const sizes = msg?.photo;
  if (!Array.isArray(sizes) || !sizes.length) return null;
  const p = sizes[sizes.length - 1];
  return { file_id: p.file_id, w: p.width, h: p.height };
}

/** Stream a Telegram file (photo) to the client. */
export async function fileResponse(env: Env, file_id: string): Promise<Response> {
  const f = await tg<{ file_path: string }>(env, 'getFile', { file_id });
  const r = await fetch(`https://api.telegram.org/file/bot${botToken(env)}/${f.file_path}`);
  return new Response(r.body, {
    status: r.status,
    headers: {
      'content-type': /^image\/(jpeg|png|webp)$/.test(r.headers.get('content-type') ?? '') ? r.headers.get('content-type')! : 'image/jpeg',
      'cache-control': 'private, max-age=172800, immutable', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox",
    },
  });
}

const INLINE_DOC = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'video/mp4', 'video/quicktime', 'audio/mpeg', 'audio/ogg', 'model/gltf-binary']);

/** Stream any Telegram file (documents, videos) with its own type; nothing is kept on our side. Bot API getFile: up to 20 MB. */
export async function tgFileStream(env: Env, file_id: string, opts: { mime?: string | null; name?: string | null; download?: boolean } = {}): Promise<Response> {
  const f = await tg<{ file_path: string; file_size?: number }>(env, 'getFile', { file_id });
  const r = await fetch(`https://api.telegram.org/file/bot${botToken(env)}/${f.file_path}`);
  const name = (opts.name || f.file_path.split('/').pop() || 'file').replace(/[^\w.\- ]+/g, '_');
  // Only PDFs, images, video, audio and 3D models open inline; anything else (html, svg, …) is a download. Never sniffed, sandboxed.
  const type = String(opts.mime || r.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim().toLowerCase();
  const inline = !opts.download && INLINE_DOC.has(type);
  return new Response(r.body, {
    status: r.status,
    headers: {
      'content-type': inline || opts.download ? type : 'application/octet-stream',
      'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${name}"; filename*=UTF-8''${encodeURIComponent(opts.name || name)}`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
    },
  });
}
