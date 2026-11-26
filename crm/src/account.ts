// /privacy and /delete in the bot: what is stored, and removing a person with their own projects.
import { Env, now } from './util';
import { eraseKey } from './vault';

export function privacyText(lang: string): string {
  return lang === 'ru'
    ? ['Что хранит этот Hunt: твой Telegram-профиль, проекты, варианты, голоса, траты, контакты хозяев и переписку, которую записал твой агент, фото из проекта.',
      'Не хранит: входы в Telegram и WhatsApp (они на твоём компьютере), номера паспортов и карт.',
      'Если ты подключил бота к своему Telegram: он видит только чаты, которые ты открыл, и оставляет только хозяев из твоих проектов. Остальное выбрасывает и не записывает. Отозвать и удалить переписку: Hunt → Настройки → Что видит Hunt.',
      'Кто видит: ты и люди, которых ты позвал в проект. Тот, кто держит этот сервер, технически может открыть базу. Общие для всех только афиша и средние оценки мест, без имён.',
      'Твой агент думает на твоей подписке: тексты уходят поставщику твоей модели.',
      'Если твой Хант предложит поделиться городом, бот покажет, что именно уйдёт, и без твоего «да» не отправит. Принятое в общий каталог остаётся там.',
      'Удалить всё своё: /delete'].join('\n\n')
    : ['This Hunt stores: your Telegram profile, projects, listings, votes, expenses, owners\' contacts and the messages your agent logged, project photos.',
      'It does not store: your Telegram and WhatsApp logins (they stay on your computer), passport and card numbers.',
      'If you connected the bot to your Telegram: it sees only the chats you opened and keeps only the owners of your projects. The rest is thrown away unrecorded. To take it back and delete conversations: Hunt → Settings → What Hunt sees.',
      'Who sees it: you and the people you invited to a project. Whoever runs this server can technically open the database. Shared by everyone: the events feed and average ratings of places, without names.',
      'Your agent runs on your own subscription: texts go to the provider of your model.',
      'If your Hunt offers to share a city, the bot shows exactly what would go and sends nothing without your yes. What the shared catalogue accepted stays there.',
      'Delete everything of yours: /delete'].join('\n\n');
}

// Rows that hang on a parent by another key than search_id / listing_id: [table, column, parent table].
const CHILDREN: [string, string, string][] = [
  ['order_lines', 'order_id', 'orders'], ['party_items', 'party_id', 'parties'], ['party_guests', 'party_id', 'parties'], ['party_ratings', 'party_id', 'parties'],
  ['renewal_votes', 'renewal_id', 'renewals'],
];

/** Deletes the projects this person owns with everything attached, their contacts, dossiers, tokens and profile. Their name stays in other people's projects as "deleted". */
export async function deleteAccount(env: Env, userId: string): Promise<number> {
  const DB = env.DB;
  const list = async (q: string, ...b: unknown[]) => ((await DB.prepare(q).bind(...b).all<{ id: string }>()).results ?? []).map((r) => r.id);
  const sids = await list('SELECT id FROM searches WHERE owner_id=?', userId);
  const lids = await list('SELECT l.id FROM listings l JOIN searches s ON s.id=l.search_id WHERE s.owner_id=?', userId);
  const parties = await list('SELECT p.id FROM parties p JOIN searches s ON s.id=p.search_id WHERE s.owner_id=?', userId);
  const tables = await list("SELECT name id FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%'");
  const has = new Map<string, Set<string>>();
  for (const t of tables) has.set(t, new Set(await list(`SELECT name id FROM pragma_table_info('${t}')`)));

  // Files first: the database rows are still there if this fails and the person can try again.
  const prefixes = [...sids.flatMap((s) => [`r/${s}/`, `m/${s}/`, `i/${s}/`]), ...lids.flatMap((l) => [`p/${l}/`, `a/${l}/`, `v/${l}/`, `o/${l}/`]), ...parties.map((p) => `y/${p}/`)];
  for (const prefix of prefixes) {
    for (let cursor: string | undefined; ;) {
      const r: KVNamespaceListResult<unknown, string> = await env.PHOTOS_KV.list({ prefix, cursor });
      for (const k of r.keys) await env.PHOTOS_KV.delete(k.name);
      if (r.list_complete) break;
      cursor = r.cursor;
    }
  }

  const S = '(SELECT id FROM searches WHERE owner_id=?1)', LI = `(SELECT id FROM listings WHERE search_id IN ${S})`, C = '(SELECT id FROM contacts WHERE owner_id=?1)';
  const st: D1PreparedStatement[] = [DB.prepare('PRAGMA defer_foreign_keys=ON')];
  const run = (q: string) => st.push(DB.prepare(q).bind(userId));
  // Shared between hunters: keep the row, drop the link to this person.
  run(`UPDATE afisha SET search_id=NULL WHERE search_id IN ${S}`);
  run(`UPDATE afisha SET organizer_contact_id=NULL WHERE organizer_contact_id IN ${C}`);
  run(`UPDATE useful_links SET search_id=NULL, suggested_by=NULL WHERE shared=1 AND (suggested_by=?1 OR search_id IN ${S})`);
  run(`DELETE FROM useful_links WHERE pack_id IS NULL AND shared=0 AND suggested_by=?1`);
  run('UPDATE useful_links SET suggested_by=NULL WHERE suggested_by=?1');
  run(`DELETE FROM supplier_prices WHERE item_id IN (SELECT i.id FROM supplier_items i JOIN suppliers s ON s.id=i.supplier_id WHERE s.search_id IN ${S})`);
  run(`DELETE FROM supplier_items WHERE supplier_id IN (SELECT id FROM suppliers WHERE search_id IN ${S})`);
  run('DELETE FROM dossier_items WHERE dossier_id IN (SELECT id FROM dossiers WHERE owner_id=?1)');
  for (const [t, col, parent] of CHILDREN) run(`DELETE FROM ${t} WHERE ${col} IN (SELECT id FROM ${parent} WHERE search_id IN ${S})`);
  for (const t of tables) {
    if (t === 'searches' || t === 'listings' || t === 'afisha') continue;
    const c = has.get(t)!;
    if (c.has('listing_id')) run(`DELETE FROM "${t}" WHERE listing_id IN ${LI}`);
    if (c.has('search_id')) run(`DELETE FROM "${t}" WHERE search_id IN ${S}`);
  }
  run('DELETE FROM dossiers WHERE owner_id=?1');
  // Contacts: in the hunter's own rows everything is gone already; anything left elsewhere loses the link.
  for (const t of tables) {
    const c = has.get(t)!;
    for (const col of ['contact_id', 'landlord_contact_id', 'owner_contact_id']) {
      if (!c.has(col)) continue;
      run(t === 'contact_channels' || t === 'listing_contacts' || t === 'threads' || t === 'people_notes' || t === 'access_peers' || t === 'access_mutes' ? `DELETE FROM "${t}" WHERE ${col} IN ${C}` : `UPDATE "${t}" SET ${col}=NULL WHERE ${col} IN ${C}`);
    }
  }
  run('DELETE FROM contacts WHERE owner_id=?1');
  run(`DELETE FROM listings WHERE search_id IN ${S}`);
  run('DELETE FROM searches WHERE owner_id=?1');
  run('DELETE FROM bot_state WHERE tg_user_id=(SELECT tg_user_id FROM users WHERE id=?1)');
  run('DELETE FROM outbox WHERE chat_id=(SELECT tg_user_id FROM users WHERE id=?1)');
  run('DELETE FROM invites WHERE created_by=?1 AND uses=0');
  run('UPDATE hunters SET invited_by=NULL WHERE invited_by=?1');
  run('DELETE FROM hunters WHERE user_id=?1');
  run('DELETE FROM tokens WHERE user_id=?1');
  run('DELETE FROM profiles WHERE user_id=?1');
  run('DELETE FROM pack_shares WHERE user_id=?1');
  for (const t of ['access', 'access_peers', 'access_mutes', 'access_log', 'access_receipts', 'chat_keys']) run(`DELETE FROM ${t} WHERE ${t === 'chat_keys' ? 'owner_id' : 'user_id'}=?1`);
  run('DELETE FROM access_log WHERE actor=?1');
  run('DELETE FROM web_sessions WHERE user_id=?1');
  run('DELETE FROM web_logins WHERE user_id=?1');
  st.push(DB.prepare("UPDATE users SET tg_user_id=NULL, tg_username=NULL, display_name='—', link_gen=link_gen+1 WHERE id=?").bind(userId));
  await eraseKey(env, userId);
  await DB.batch(st);
  console.log('account deleted', now(), sids.length);
  return sids.length;
}
