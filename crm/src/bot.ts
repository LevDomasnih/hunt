import { Env, HttpError, now, rid, sha256hex, event, esc, parseJson, safeEqual, sensitive, redactSensitive, httpUrl } from './util';
import { orderDraft } from './orders';
import { tg, kb, photoOf } from './tg';
import { putAlbum, kvPhoto } from './media';
import { t, pickLang, DECISIONS } from './i18n';
import { listingCard, listingKeyboard, draftCard, draftKeyboard, dayPlan } from './cards';
import { ensureMember } from './members';
import { recomputeDecision } from './scores';
import { acceptGuestInvite, isGuestOf } from './wave5';
import { deleteAccount, privacyText } from './account';
import { sharesCallback, proposalComment } from './shares';
import { webStart, webCallback, webCommand } from './web';
import { onBusinessConnection, onBusinessMessage, replyCallback, replyMessage, sendViaBusiness } from './access';
import { seal, isSealed, openDraft } from './vault';

const appLink = (env: Env, startapp?: string) =>
  `https://t.me/${env.BOT_USERNAME}${startapp ? `?startapp=${encodeURIComponent(startapp)}` : '?startapp'}`;

async function ownerOf(env: Env, search: any) {
  return env.DB.prepare('SELECT * FROM users WHERE id=?').bind(search.owner_id).first<any>();
}

async function upsertTgUser(env: Env, from: any) {
  const existing = await env.DB.prepare('SELECT * FROM users WHERE tg_user_id=?').bind(from.id).first<any>();
  const name = [from.first_name, from.last_name].filter(Boolean).join(' ') || from.username || String(from.id);
  if (existing) {
    if (existing.tg_username !== (from.username ?? null) || existing.display_name !== name) {
      await env.DB.prepare('UPDATE users SET tg_username=?, display_name=? WHERE id=?').bind(from.username ?? null, name, existing.id).run();
    }
    return { ...existing, display_name: name };
  }
  const u = { id: rid('u_'), tg_user_id: from.id, tg_username: from.username ?? null, display_name: name, lang: pickLang(from.language_code) };
  await env.DB.prepare('INSERT INTO users (id, tg_user_id, tg_username, display_name, lang, created_at) VALUES (?,?,?,?,?,?)')
    .bind(u.id, u.tg_user_id, u.tg_username, u.display_name, u.lang, now()).run();
  return u;
}

async function issueToken(env: Env, userId: string, label: string): Promise<string> {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  const tok = 'hunt_' + btoa(String.fromCharCode(...b)).replace(/[+/=]/g, (c) => ({ '+': '-', '/': '_', '=': '' })[c]!);
  await env.DB.prepare('INSERT INTO tokens (hash, user_id, label, created_at) VALUES (?,?,?,?)').bind(await sha256hex(tok), userId, label, now()).run();
  return tok;
}

async function useInvite(env: Env, code: string) {
  const inv = await env.DB.prepare('SELECT * FROM invites WHERE code=?').bind(code).first<any>();
  if (!inv) return null;
  if (inv.uses >= inv.max_uses) return null;
  if (inv.expires_at && inv.expires_at < now()) return null;
  await env.DB.prepare('UPDATE invites SET uses=uses+1 WHERE code=?').bind(code).run();
  return inv;
}

async function isHunter(env: Env, userId: string) {
  return env.DB.prepare('SELECT * FROM hunters WHERE user_id=?').bind(userId).first<any>();
}

async function makeHunter(env: Env, user: any, invitedBy: string | null, admin: boolean) {
  await env.DB.prepare('INSERT OR IGNORE INTO hunters (user_id, is_admin, invited_by, created_at) VALUES (?,?,?,?)')
    .bind(user.id, admin ? 1 : 0, invitedBy, now()).run();
  const tok = await issueToken(env, user.id, 'telegram');
  await tg(env, 'sendMessage', {
    chat_id: user.tg_user_id,
    parse_mode: 'HTML',
    text: `${t(user.lang, 'welcome')}\n\n${t(user.lang, 'welcome_token')}\n<code>${tok}</code>\n\nAPI: <code>${esc(env.PUBLIC_URL)}</code>`,
  });
}

// ---------- outbound helpers used by the agent API ----------

export async function publishListing(env: Env, l: any, files: (File | string)[] | null) {
  const s = await env.DB.prepare('SELECT * FROM searches WHERE id=?').bind(l.search_id).first<any>();
  // Photos are stored in KV, so the Mini App works without any Telegram group.
  if (files && files.length) {
    // Files become ONE KV value (an album, served as slices); URLs must be http(s).
    const list = files.slice(0, 12);
    const blobs = list.filter((f): f is File => typeof f !== 'string');
    const album = blobs.length ? await putAlbum(env, l.id, blobs) : [];
    let bi = 0;
    const photos: any[] = list.map((f) => (typeof f === 'string' ? { url: httpUrl(f, 'photo url') } : album[bi++]));
    await env.DB.prepare('UPDATE listings SET photos=? WHERE id=?').bind(JSON.stringify(photos), l.id).run();
    l.photos = JSON.stringify(photos);
  }
  if (!s?.tg_chat_id) return parseJson<any[]>(l.photos, []);
  const owner = await ownerOf(env, s);
  const lang = owner?.lang ?? 'en';
  let photos = parseJson<any[]>(l.photos, []);

  if (files && files.length) {
    // Mirror the album into the group (Telegram needs the bytes again; KV keeps the originals).
    const fd = new FormData();
    fd.set('chat_id', String(s.tg_chat_id));
    const media: any[] = [];
    let i = 0;
    for (const p of photos.slice(0, 10)) {
      if (p.url) { media.push({ type: 'photo', media: p.url }); continue; }
      if (!p.kv) continue;
      const got = await kvPhoto(env, p.kv, p.i ?? null);
      if (!got) continue;
      const buf = got.body instanceof ArrayBuffer ? got.body : await new Response(got.body).arrayBuffer();
      fd.set(`p${i}`, new Blob([buf], { type: got.type ?? 'image/jpeg' }), `p${i}.jpg`);
      media.push({ type: 'photo', media: `attach://p${i++}` });
    }
    if (media.length) {
      fd.set('media', JSON.stringify(media));
      await tg<any[]>(env, 'sendMediaGroup', fd);
    }
    l.tg_message_id = null; // card goes under the new album
  } else if (!l.tg_message_id && photos.some((p) => p.file_id)) {
    await tg(env, 'sendMediaGroup', {
      chat_id: s.tg_chat_id,
      media: photos.filter((p) => p.file_id).slice(0, 10).map((p) => ({ type: 'photo', media: p.file_id })),
    });
  }

  const votes = await votesOf(env, l.id);
  const text = listingCard({ ...l, photos }, lang, votes);
  const reply_markup = kb(listingKeyboard(l, lang, appLink(env, l.id)).map((row) => row.map((b) => (b.url ? { ...b, url: appLink(env, l.id) } : b))));
  if (l.tg_message_id) {
    await tg(env, 'editMessageText', { chat_id: s.tg_chat_id, message_id: l.tg_message_id, text, parse_mode: 'HTML', reply_markup, link_preview_options: { is_disabled: true } }).catch(() => null);
  } else {
    const m = await tg<any>(env, 'sendMessage', { chat_id: s.tg_chat_id, text, parse_mode: 'HTML', reply_markup, link_preview_options: { is_disabled: true } });
    await env.DB.prepare('UPDATE listings SET tg_message_id=? WHERE id=?').bind(m.message_id, l.id).run();
  }
  return photos;
}

async function votesOf(env: Env, lid: string) {
  const r = await env.DB.prepare('SELECT u.display_name name, v.decision FROM votes v JOIN users u ON u.id=v.user_id WHERE v.listing_id=? ORDER BY v.at').bind(lid).all<any>();
  return r.results;
}

export async function sendDraftForApproval(env: Env, s: any, d: any) {
  const owner = await ownerOf(env, s);
  if (!owner?.tg_user_id) return;
  const c = d.contact_id ? await env.DB.prepare('SELECT name FROM contacts WHERE id=?').bind(d.contact_id).first<any>() : null;
  const l = d.listing_id ? await env.DB.prepare('SELECT title FROM listings WHERE id=?').bind(d.listing_id).first<any>() : null;
  const m = await tg<any>(env, 'sendMessage', {
    chat_id: owner.tg_user_id,
    text: draftCard(d, owner.lang, c?.name ?? null, l?.title ?? null),
    parse_mode: 'HTML',
    reply_markup: kb(draftKeyboard(d, owner.lang)),
  });
  await env.DB.prepare('UPDATE drafts SET tg_message_id=? WHERE id=?').bind(m.message_id, d.id).run();
}

export async function postDayPlan(env: Env, s: any, date: string) {
  const owner = await ownerOf(env, s);
  const r = await env.DB.prepare(
    `SELECT v.*, l.title, l.lat, l.lng, l.map_url FROM viewings v JOIN listings l ON l.id=v.listing_id
     WHERE v.search_id=? AND substr(v.starts_at,1,10)=? ORDER BY v.starts_at`,
  ).bind(s.id, date).all<any>();
  const chat = s.tg_chat_id ?? owner?.tg_user_id;
  if (!chat) return;
  await tg(env, 'sendMessage', { chat_id: chat, text: dayPlan(r.results, owner?.lang ?? 'en', date), parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
}

export async function notify(env: Env, s: any, text: string, to: 'owner' | 'chat') {
  const owner = await ownerOf(env, s);
  const chat = to === 'chat' && s.tg_chat_id ? s.tg_chat_id : owner?.tg_user_id;
  if (chat) await tg(env, 'sendMessage', { chat_id: chat, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
}

// ---------- webhook ----------

export async function handleWebhook(req: Request, env: Env): Promise<Response> {
  if (!env.TG_WEBHOOK_SECRET || !safeEqual(req.headers.get('x-telegram-bot-api-secret-token') ?? '', env.TG_WEBHOOK_SECRET.trim())) return new Response('forbidden', { status: 403 });
  const u: any = await req.json();
  try {
    if (u.business_connection) await onBusinessConnection(env, u.business_connection);
    else if (u.business_message) await onBusinessMessage(env, u.business_message);
    else if (u.callback_query) await onCallback(env, u.callback_query);
    else if (u.my_chat_member) await onBotMembership(env, u.my_chat_member);
    else if (u.message) await onMessage(env, u.message);
  } catch (e) {
    console.error('webhook', e);
  }
  return new Response('ok');
}

async function onMessage(env: Env, msg: any) {
  if (!msg.from || msg.from.is_bot) return;
  const user = await upsertTgUser(env, msg.from);
  const text: string = msg.text ?? '';
  const isPrivate = msg.chat.type === 'private';
  const [cmd, arg] = text.split(/\s+/, 2);
  const command = cmd?.startsWith('/') ? cmd.split('@')[0] : null;

  if (isPrivate) {
    // A file in the DM during a deal: attach it to the deal listing (we keep only the Telegram file_id).
    if (msg.document || msg.photo || msg.video) return attachDealFile(env, user, msg);
    // Waiting for an edited draft text?
    const st = await env.DB.prepare('SELECT state FROM bot_state WHERE tg_user_id=?').bind(msg.from.id).first<any>();
    if (st && !command && text) {
      const s = parseJson<any>(st.state, {});
      if (await proposalComment(env, user, msg.chat.id, s, text)) return;
      if (await replyMessage(env, user, msg.chat.id, s, text)) return;
      if (s.kind === 'edit_draft') {
        if (sensitive(text)) return void (await tg(env, 'sendMessage', { chat_id: msg.chat.id, text: t(user.lang, 'sensitive_refused') }));
        const was = await env.DB.prepare('SELECT d.text, s.owner_id FROM drafts d JOIN searches s ON s.id=d.search_id WHERE d.id=?').bind(s.draft_id).first<any>();
        await env.DB.prepare("UPDATE drafts SET edited_text=?, status='edited', decided_by=?, updated_at=? WHERE id=? AND status='pending'").bind(isSealed(was?.text) ? await seal(env, was.owner_id, text) : text, user.id, now(), s.draft_id).run();
        await env.DB.prepare('DELETE FROM bot_state WHERE tg_user_id=?').bind(msg.from.id).run();
        const d = await env.DB.prepare('SELECT * FROM drafts WHERE id=?').bind(s.draft_id).first<any>();
        if (d) await event(env, d.search_id, 'draft_decided', d.id, user.id, { status: 'edited' });
        const sent = d ? await sendViaBusiness(env, d.id) : false;
        await tg(env, 'sendMessage', { chat_id: msg.chat.id, text: sent ? (user.lang === 'en' ? 'Sent.' : 'Отправлено.') : t(user.lang, 'edited_queued') });
        return;
      }
    }
    if (command === '/start') {
      if (arg && (await webStart(env, user, msg.chat.id, arg))) return;
      if (arg) {
        const inv = await useInvite(env, arg);
        if (inv?.kind === 'hunter' || inv?.kind === 'admin') return makeHunter(env, user, inv.created_by, inv.kind === 'admin');
        if (inv?.kind === 'guest' && inv.search_id) {
          const r = await acceptGuestInvite(env, inv, user);
          const ru = user.lang === 'ru';
          const text = r.already_member ? t(user.lang, 'welcome')
            : ru ? `Тебя позвали в гости: ${r.title}\nДоступ с ${String(r.from).slice(8, 10)}.${String(r.from).slice(5, 7)} по ${String(r.to).slice(8, 10)}.${String(r.to).slice(5, 7)}: адрес, Wi-Fi, места рядом и контакты.`
            : `You're invited as a guest: ${r.title}\nAccess ${r.from} – ${r.to}: address, Wi-Fi, places nearby and contacts.`;
          await tg(env, 'sendMessage', { chat_id: msg.chat.id, text, reply_markup: kb([[{ text: t(user.lang, 'open_app'), web_app: { url: `${env.PUBLIC_URL}/app` } }]]) });
          return;
        }
        if (inv?.kind === 'member' && inv.search_id) {
          await ensureMember(env, inv.search_id, user.id);
          const s = await env.DB.prepare('SELECT title FROM searches WHERE id=?').bind(inv.search_id).first<any>();
          await tg(env, 'sendMessage', {
            chat_id: msg.chat.id,
            text: `${t(user.lang, 'welcome')}\n\n🏠 ${s?.title ?? ''}`,
            reply_markup: kb([[{ text: t(user.lang, 'open_app'), web_app: { url: `${env.PUBLIC_URL}/app` } }]]),
          });
          return;
        }
      }
      if (env.OPEN_SIGNUP === '1' && !(await isHunter(env, user.id))) return makeHunter(env, user, null, false);
      const known = (await isHunter(env, user.id)) || (await env.DB.prepare("SELECT 1 FROM members WHERE user_id=?1 UNION SELECT 1 FROM guests WHERE user_id=?1 AND status='active'").bind(user.id).first());
      await tg(env, 'sendMessage', {
        chat_id: msg.chat.id,
        text: known ? t(user.lang, 'welcome') : t(user.lang, 'no_signup'),
        reply_markup: known ? kb([[{ text: t(user.lang, 'open_app'), web_app: { url: `${env.PUBLIC_URL}/app` } }]]) : undefined,
      });
      return;
    }
    if (command && (await webCommand(env, user, msg.chat.id, command))) return;
    if (command === '/token') {
      if (!(await isHunter(env, user.id))) return void tg(env, 'sendMessage', { chat_id: msg.chat.id, text: t(user.lang, 'no_signup') });
      const tok = await issueToken(env, user.id, 'telegram');
      await tg(env, 'sendMessage', { chat_id: msg.chat.id, parse_mode: 'HTML', text: `${t(user.lang, 'welcome_token')}\n<code>${tok}</code>` });
      return;
    }
    if (command === '/revoke') {
      // Kill every agent token and web link of this person (a lost laptop, a leaked link). /token issues a fresh token.
      await env.DB.batch([
        env.DB.prepare('UPDATE tokens SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL').bind(now(), user.id),
        env.DB.prepare('UPDATE users SET link_gen=link_gen+1 WHERE id=?').bind(user.id),
        env.DB.prepare('DELETE FROM web_sessions WHERE user_id=?').bind(user.id),
      ]);
      await tg(env, 'sendMessage', { chat_id: msg.chat.id, text: t(user.lang, 'revoked') });
      return;
    }
    if (command === '/privacy') return void (await tg(env, 'sendMessage', { chat_id: msg.chat.id, text: privacyText(user.lang) }));
    if (command === '/delete') {
      const ru = user.lang === 'ru';
      const h = await isHunter(env, user.id);
      // The one who runs this Hunt deletes it in Cloudflare: an accidental /delete must not wipe the server owner's home.
      if (h?.is_admin) return void (await tg(env, 'sendMessage', { chat_id: msg.chat.id, text: ru ? 'Ты админ этого Hunt: удали проекты вручную или весь сервер в Cloudflare.' : 'You are an admin of this Hunt: remove projects by hand or the whole server in Cloudflare.' }));
      if (arg?.toLowerCase() !== 'yes') {
        return void (await tg(env, 'sendMessage', { chat_id: msg.chat.id, parse_mode: 'HTML', text: ru
          ? 'Удалю все проекты, где ты хозяин, с вариантами, перепиской, тратами, фото и контактами, и твои токены. Вернуть нельзя. В чужих проектах вместо имени останется «—».\n\nПодтверди: <code>/delete yes</code>'
          : 'This deletes every project you own with its listings, messages, expenses, photos and contacts, and your tokens. It cannot be undone. In other people\'s projects your name becomes “—”.\n\nConfirm: <code>/delete yes</code>' }));
      }
      const n = await deleteAccount(env, user.id);
      await tg(env, 'sendMessage', { chat_id: msg.chat.id, text: ru ? `Готово. Удалено проектов: ${n}.` : `Done. Projects deleted: ${n}.` });
      return;
    }
    if (command === '/invite') {
      const h = await isHunter(env, user.id);
      if (!h?.is_admin) return void tg(env, 'sendMessage', { chat_id: msg.chat.id, text: t(user.lang, 'no_signup') });
      const code = rid('');
      await env.DB.prepare("INSERT INTO invites (code, kind, created_by, max_uses, created_at) VALUES (?, 'hunter', ?, 1, ?)").bind(code, user.id, now()).run();
      await tg(env, 'sendMessage', { chat_id: msg.chat.id, text: `https://t.me/${env.BOT_USERNAME}?start=${code}` });
      return;
    }
    if (command === '/app' || command === '/list' || command === '/plan') {
      await tg(env, 'sendMessage', {
        chat_id: msg.chat.id,
        text: t(user.lang, 'open_app'),
        reply_markup: kb([[{ text: t(user.lang, 'open_app'), web_app: { url: `${env.PUBLIC_URL}/app${command === '/plan' ? '#plan' : ''}` } }]]),
      });
      return;
    }
    // Free text from a hunter in DM = an instruction for the agent, attached to their most recent active search.
    if (!command && text && (await isHunter(env, user.id))) {
      const s = await env.DB.prepare("SELECT id, title FROM searches WHERE owner_id=? AND status IN ('active','found','living') ORDER BY updated_at DESC LIMIT 1").bind(user.id).first<any>();
      if (s) {
        if (sensitive(text)) return void (await tg(env, 'sendMessage', { chat_id: msg.chat.id, reply_to_message_id: msg.message_id, text: t(user.lang, 'sensitive_refused') }));
        await event(env, s.id, 'instruction', null, user.id, { name: user.display_name, text });
        await tg(env, 'sendMessage', { chat_id: msg.chat.id, reply_to_message_id: msg.message_id, text: t(user.lang, 'instruction_queued') });
      }
    }
    return;
  }

  // Group chat
  if ((command === '/start' && !arg) || command === '/link') {
    await linkLatestSearch(env, user, msg.chat.id);
    return;
  }
  if (command === '/start' && arg) {
    const inv = await env.DB.prepare("SELECT * FROM invites WHERE code=? AND kind='member'").bind(arg).first<any>();
    if (inv?.search_id) {
      const s = await env.DB.prepare('SELECT * FROM searches WHERE id=?').bind(inv.search_id).first<any>();
      if (s && s.owner_id === user.id) {
        await env.DB.prepare('UPDATE searches SET tg_chat_id=?, updated_at=? WHERE id=?').bind(msg.chat.id, now(), s.id).run();
        await tg(env, 'sendMessage', { chat_id: msg.chat.id, text: `${t(user.lang, 'chat_linked')}: ${s.title}` });
      }
    }
    return;
  }
  const s = await env.DB.prepare('SELECT * FROM searches WHERE tg_chat_id=?').bind(msg.chat.id).first<any>();
  if (!s) return;
  // Writing in the group never makes anyone a member (M5): only members' messages reach the feed; joining needs the invite link.
  const mem = await env.DB.prepare("SELECT role FROM members WHERE search_id=? AND user_id=? AND role IN ('owner','member')").bind(s.id, user.id).first<any>();
  if (!mem) return;
  const clean = redactSensitive(text) ?? '';
  if (msg.reply_to_message && clean) {
    const l = await env.DB.prepare('SELECT id FROM listings WHERE search_id=? AND tg_message_id=?').bind(s.id, msg.reply_to_message.message_id).first<any>();
    if (l) await event(env, s.id, 'comment', l.id, user.id, { name: user.display_name, text: clean.slice(0, 2000) });
  } else if (clean && !command) {
    await event(env, s.id, 'chat', null, user.id, { name: user.display_name, text: clean.slice(0, 2000) });
  }
}

/** Document / photo / video sent to the bot DM by a member of a search with a deal → a document row + an event for the agent. */
async function attachDealFile(env: Env, user: any, msg: any) {
  const deal = await env.DB.prepare(
    `SELECT d.listing_id, d.search_id, l.title FROM deals d JOIN members m ON m.search_id=d.search_id AND m.user_id=? AND m.role IN ('owner','member')
     JOIN searches s ON s.id=d.search_id JOIN listings l ON l.id=d.listing_id WHERE s.status!='closed' ORDER BY d.updated_at DESC LIMIT 1`,
  ).bind(user.id).first<any>();
  if (!deal) {
    await tg(env, 'sendMessage', { chat_id: msg.chat.id, reply_to_message_id: msg.message_id, text: t(user.lang, 'doc_no_deal') });
    return;
  }
  // Wave 4: a 3D scan (.glb) from a LiDAR app → a scan of the current deal; .usdz → ask for a GLB export.
  const fname = String(msg.document?.file_name ?? '').toLowerCase();
  if (/\.(usdz|reality)$/.test(fname)) {
    await tg(env, 'sendMessage', { chat_id: msg.chat.id, reply_to_message_id: msg.message_id, text: t(user.lang, 'scan_usdz') });
    return;
  }
  if (/\.(glb|gltf)$/.test(fname) || msg.document?.mime_type === 'model/gltf-binary') return attachScan(env, user, msg, deal);
  const ph = photoOf(msg);
  const f = msg.document ?? msg.video ?? null;
  const fileKind = msg.document ? 'document' : msg.video ? 'video' : 'photo';
  const caption = redactSensitive(String(msg.caption ?? '').trim()) ?? '';
  const name = f?.file_name ? redactSensitive(f.file_name) : null;
  const moving = fileKind === 'video' ? await env.DB.prepare('SELECT 1 FROM moveouts WHERE search_id=?').bind(deal.search_id).first() : null;
  const kind = fileKind === 'video' ? (moving ? 'moveout_video' : 'movein_video') : fileKind === 'photo' ? 'receipt' : /lease|договор|sewa|agreement|contract/i.test(`${name} ${caption}`) ? 'lease' : 'other';
  const title = (caption || name || (user.lang === 'ru' ? (fileKind === 'photo' ? 'Фото' : fileKind === 'video' ? 'Видео' : 'Документ') : fileKind === 'photo' ? 'Photo' : fileKind === 'video' ? 'Video' : 'Document')).slice(0, 160);
  const id = rid('doc_');
  const t0 = now();
  await env.DB.prepare(`INSERT INTO documents (id, search_id, listing_id, kind, title, status, doc_date, tg_file_id, tg_chat_id, file_kind, file_name, mime, size, created_by, created_at, updated_at)
    VALUES (?,?,?,?,?, 'have', ?,?,?,?,?,?,?,?,?,?)`)
    .bind(id, deal.search_id, deal.listing_id, kind, title, t0.slice(0, 10), f?.file_id ?? ph?.file_id, msg.chat.id, fileKind, name, f?.mime_type ?? (fileKind === 'photo' ? 'image/jpeg' : null), f?.file_size ?? null, user.id, t0, t0).run();
  await event(env, deal.search_id, 'document', id, user.id, { name: user.display_name, title, kind, status: 'have', file_kind: fileKind, listing_id: deal.listing_id, from_bot: true });
  await tg(env, 'sendMessage', {
    chat_id: msg.chat.id, reply_to_message_id: msg.message_id, parse_mode: 'HTML',
    text: `📎 ${t(user.lang, 'doc_attached')}: <b>${esc(deal.title)}</b>\n${t(user.lang, 'doc_attached_tail')}`,
    reply_markup: kb([[{ text: t(user.lang, 'open_docs'), web_app: { url: `${env.PUBLIC_URL}/app#/s/${deal.search_id}/docs` } }]]),
  });
}

/** A .glb sent to the bot DM: a document of kind 'scan' + a scan row (caption = room; "bike <plate>" links a bike). */
async function attachScan(env: Env, user: any, msg: any, deal: any) {
  const f = msg.document;
  if ((f.file_size ?? 0) > 20 * 1024 * 1024) {
    await tg(env, 'sendMessage', { chat_id: msg.chat.id, reply_to_message_id: msg.message_id, text: t(user.lang, 'scan_big') });
    await event(env, deal.search_id, 'instruction', null, user.id, { name: user.display_name, kind: 'scan_big', text: `${f.file_name} ${(f.file_size / 1048576).toFixed(1)} MB` });
    return;
  }
  const caption = (redactSensitive(String(msg.caption ?? '').trim()) ?? '');
  const plate = caption.match(/(?:bike|байк|мото)\s+([A-Za-z]{1,2}\s?\d{1,4}\s?[A-Za-z]{0,3})/i)?.[1]?.replace(/\s+/g, ' ').toUpperCase() ?? null;
  const bike = plate ? await env.DB.prepare("SELECT id FROM bikes WHERE search_id=? AND replace(upper(plate),' ','')=?").bind(deal.search_id, plate.replace(/\s/g, '')).first<any>() : null;
  const moving = await env.DB.prepare('SELECT 1 FROM moveouts WHERE search_id=?').bind(deal.search_id).first();
  const phase = bike ? 'bike' : moving ? 'moveout' : 'movein';
  const room = (caption.replace(/(?:bike|байк|мото)\s+\S+(\s\S+)?/i, '').trim() || (user.lang === 'ru' ? 'Весь дом' : 'Whole house')).slice(0, 60);
  const id = rid('doc_');
  const t0 = now();
  await env.DB.prepare(`INSERT INTO documents (id, search_id, listing_id, kind, title, status, doc_date, tg_file_id, tg_chat_id, file_kind, file_name, mime, size, created_by, created_at, updated_at)
    VALUES (?,?,?, 'scan', ?, 'have', ?,?,?, 'document', ?, 'model/gltf-binary', ?,?,?,?)`)
    .bind(id, deal.search_id, deal.listing_id, `3D · ${room}`, t0.slice(0, 10), f.file_id, msg.chat.id, f.file_name ?? 'scan.glb', f.file_size ?? null, user.id, t0, t0).run();
  // An open "todo" row for the same room gets the file; otherwise a new scan row.
  const todo = await env.DB.prepare("SELECT id FROM scans WHERE search_id=? AND phase=? AND lower(room)=lower(?) AND doc_id IS NULL").bind(deal.search_id, phase, room).first<any>();
  if (todo) await env.DB.prepare("UPDATE scans SET doc_id=?, status='ok', updated_at=? WHERE id=?").bind(id, t0, todo.id).run();
  else await env.DB.prepare(`INSERT INTO scans (id, search_id, listing_id, bike_id, room, phase, status, doc_id, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?, 'ok', ?,?,?,?)`)
    .bind(rid('sc_'), deal.search_id, deal.listing_id, bike?.id ?? null, room, phase, id, user.id, t0, t0).run();
  await event(env, deal.search_id, 'scan', id, user.id, { name: user.display_name, room, phase, from_bot: true });
  await tg(env, 'sendMessage', {
    chat_id: msg.chat.id, reply_to_message_id: msg.message_id, parse_mode: 'HTML',
    text: `🧊 ${t(user.lang, 'scan_attached')}: <b>${esc(room)}</b> · ${esc(deal.title)}`,
    reply_markup: kb([[{ text: t(user.lang, 'scan_open'), web_app: { url: `${env.PUBLIC_URL}/app#/s/${deal.search_id}/${phase === 'bike' ? 'bikes' : 'act'}` } }]]),
  });
}

async function onCallback(env: Env, q: any) {
  const user = await upsertTgUser(env, q.from);
  const [kind, a, id] = String(q.data ?? '').split(':');
  const answer = (text?: string) => tg(env, 'answerCallbackQuery', { callback_query_id: q.id, text }).catch(() => null);

  if (kind === 'v' && (DECISIONS as readonly string[]).includes(a)) {
    const l = await env.DB.prepare('SELECT * FROM listings WHERE id=?').bind(id).first<any>();
    if (!l) return answer();
    const s = await env.DB.prepare('SELECT * FROM searches WHERE id=?').bind(l.search_id).first<any>();
    const member = await env.DB.prepare('SELECT role FROM members WHERE search_id=? AND user_id=?').bind(l.search_id, user.id).first<any>();
    // Only members vote (M5): a group voter who is not a member gets a hint to join through the invite; guests and viewers don't vote.
    if (!member) {
      if (await isGuestOf(env, l.search_id, user.id)) return answer('—');
      return answer(s?.tg_chat_id && q.message?.chat?.id === s.tg_chat_id ? t(user.lang, 'vote_join_first') : '—');
    }
    if (!['owner', 'member'].includes(member.role)) return answer('—');
    // Wave 6: a closed project is a read-only archive (same as the Mini App's 409 closed).
    if (s?.status === 'closed') return answer(user.lang === 'en' ? 'The project is closed' : 'Проект закрыт');
    await env.DB.prepare('INSERT INTO votes (listing_id, user_id, decision, at) VALUES (?,?,?,?) ON CONFLICT(listing_id,user_id) DO UPDATE SET decision=excluded.decision, at=excluded.at')
      .bind(l.id, user.id, a, now()).run();
    const group = await recomputeDecision(env, l.id);
    await event(env, l.search_id, 'vote', l.id, user.id, { name: user.display_name, decision: a, group, title: l.title });
    await publishListing(env, { ...l, decision: group }, null);
    return answer(t(user.lang, a as any));
  }

  // Wave 9 · "Как было?": the morning-after rating of a booked event (ef) or a party (pf).
  if (kind === 'ef' || kind === 'pf') {
    const { rateFromBot } = await import('./party');
    const txt = await rateFromBot(env, user, kind, Number(a), id);
    if (!txt) return answer('—');
    await tg(env, 'editMessageText', { chat_id: q.message.chat.id, message_id: q.message.message_id, parse_mode: 'HTML', text: txt,
      reply_markup: q.message.reply_markup?.inline_keyboard?.[1] ? kb([q.message.reply_markup.inline_keyboard[1]]) : undefined }).catch(() => null);
    return answer(user.lang === 'en' ? 'Thanks!' : 'Спасибо!');
  }
  if (kind === 'ar') return answer((await replyCallback(env, user, q, id)) ?? '—');
  if (kind === 'wl') return answer((await webCallback(env, user, q, a, id)) ?? '—');
  if (kind === 'ps' || kind === 'pr') return answer((await sharesCallback(env, user, q, kind, a, id)) ?? '—');
  if (kind === 'd') {
    const d = await env.DB.prepare('SELECT d.*, s.owner_id FROM drafts d JOIN searches s ON s.id=d.search_id WHERE d.id=?').bind(id).first<any>();
    if (!d || d.owner_id !== user.id) return answer('—');
    if (d.status !== 'pending') return answer(d.status);
    await openDraft(env, d);
    const c = d.contact_id ? await env.DB.prepare('SELECT name FROM contacts WHERE id=?').bind(d.contact_id).first<any>() : null;
    const base = draftCard(d, user.lang, c?.name ?? null, null);
    if (a === 'ok' || a === 'no') {
      const status = a === 'ok' ? 'approved' : 'rejected';
      await env.DB.prepare('UPDATE drafts SET status=?, decided_by=?, updated_at=? WHERE id=?').bind(status, user.id, now(), d.id).run();
      if (status === 'rejected' && d.kind === 'other') await orderDraft(env, d.id, status); // wave 10: an order's draft → collecting again
      await event(env, d.search_id, 'draft_decided', d.id, user.id, { status });
      if (a === 'ok') await sendViaBusiness(env, d.id);
      await tg(env, 'editMessageText', {
        chat_id: q.message.chat.id, message_id: q.message.message_id, parse_mode: 'HTML',
        text: `${base}\n\n${a === 'ok' ? '✅ ' + t(user.lang, 'sent') : '✕ ' + t(user.lang, 'skipped')}`,
      }).catch(() => null);
      return answer();
    }
    if (a === 'ed') {
      await env.DB.prepare('INSERT OR REPLACE INTO bot_state (tg_user_id, state, at) VALUES (?,?,?)').bind(q.from.id, JSON.stringify({ kind: 'edit_draft', draft_id: d.id }), now()).run();
      await tg(env, 'sendMessage', { chat_id: q.message.chat.id, text: t(user.lang, 'send_new_text'), reply_markup: { force_reply: true } });
      return answer();
    }
  }
  return answer();
}

/** Updates the webhook asks for; business_* = the person connected the bot to their own Telegram (src/access.ts). */
export const BOT_UPDATES = ['message', 'callback_query', 'my_chat_member', 'business_connection', 'business_message'];

/** The bot's command menu (set by /setup and by the agent's admin webhook call). */
export const BOT_COMMANDS = [
  { command: 'app', description: 'Open Hunt' },
  { command: 'plan', description: 'Viewings plan' },
  { command: 'web', description: 'Sign in on the site' },
  { command: 'logout', description: 'Sign out of the site everywhere' },
  { command: 'token', description: 'New agent token' },
  { command: 'invite', description: 'Invite a hunter (admins)' },
  { command: 'revoke', description: 'Revoke my agent tokens and web links' },
  { command: 'privacy', description: 'What this Hunt stores' },
  { command: 'delete', description: 'Delete my projects and data' },
];

/** True once someone became an admin (the first setup invite was used). */
export async function adminExists(env: Env): Promise<boolean> {
  return !!(await env.DB.prepare('SELECT 1 FROM hunters WHERE is_admin=1 LIMIT 1').first());
}

/** One-time setup: creates an admin invite. Called with the SETUP_KEY. */
export async function setupInvite(env: Env): Promise<string> {
  const sys = await env.DB.prepare("SELECT id FROM users WHERE id='u_system'").first();
  if (!sys) await env.DB.prepare("INSERT INTO users (id, display_name, lang, created_at) VALUES ('u_system','system','en',?)").bind(now()).run();
  const code = rid('');
  await env.DB.batch([
    env.DB.prepare("UPDATE invites SET max_uses=uses WHERE kind='admin' AND uses < max_uses"), // only the newest setup invite works
    env.DB.prepare("INSERT INTO invites (code, kind, created_by, max_uses, created_at) VALUES (?, 'admin', 'u_system', 1, ?)").bind(code, now()),
  ]);
  return `https://t.me/${env.BOT_USERNAME}?start=${code}`;
}

/** Link a group to the hunter's most recent active search that has no group yet. */
async function linkLatestSearch(env: Env, user: any, chatId: number) {
  const already = await env.DB.prepare('SELECT id, title FROM searches WHERE tg_chat_id=?').bind(chatId).first<any>();
  if (already) return void tg(env, 'sendMessage', { chat_id: chatId, text: `${t(user.lang, 'chat_linked')}: ${already.title}` });
  const s = await env.DB.prepare("SELECT id, title FROM searches WHERE owner_id=? AND status='active' AND tg_chat_id IS NULL ORDER BY created_at DESC LIMIT 1").bind(user.id).first<any>();
  if (!s) return;
  await env.DB.prepare('UPDATE searches SET tg_chat_id=?, updated_at=? WHERE id=?').bind(chatId, now(), s.id).run();
  await tg(env, 'sendMessage', { chat_id: chatId, text: `${t(user.lang, 'chat_linked')}: ${s.title}` });
}

/** The bot was added to a group: link it if the person who added it owns a search without a group. */
async function onBotMembership(env: Env, upd: any) {
  const st = upd.new_chat_member?.status;
  if (!['member', 'administrator'].includes(st) || !upd.from || upd.chat?.type === 'private') return;
  const user = await upsertTgUser(env, upd.from);
  if (!(await isHunter(env, user.id))) return;
  await linkLatestSearch(env, user, upd.chat.id);
}
