import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { initData } from './telegram';
import { getDB } from './db';
import { type SyncOp, message } from './domain';
import { requestJson } from '../supabase/functions/_shared/request';
export type Identity = { id: string; role: 'admin' | 'member'; telegramId?: string };
export const configured = Boolean(
  import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY,
);
let token = '';
let expiry = 0;
let identity: Identity | null = null;
let client: SupabaseClient | null = null;
export const currentIdentity = () => identity;
async function edge(name: string, data: unknown, auth = false) {
  if (!configured) throw new Error('Клуб ещё не подключён. Доступна личная библиотека.');
  let reply: { response: Response; data: any };
  try {
    reply = await requestJson<any>(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        ...(auth ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(data),
    });
  } catch (error) {
    if (error instanceof SyntaxError)
      throw new Error('Сервис клуба недоступен. Попробуйте ещё раз позже.');
    if (error instanceof Error && error.name === 'TimeoutError')
      throw new Error('Сервер клуба не ответил вовремя. Нажмите «Повторить вход».');
    throw new Error('Нет связи с клубом. Проверьте интернет и повторите вход.');
  }
  if (!reply.response.ok) throw new Error(reply.data.error || 'Ошибка сервера');
  return reply.data;
}
let authenticating: Promise<Identity> | null = null;
export async function authenticate(): Promise<Identity> {
  if (authenticating) return authenticating;
  authenticating = (async () => {
    if (!initData()) throw new Error('Для доступа к клубу откройте приложение внутри Telegram');
    const data = await edge('telegram-auth', {
      initData: initData(),
      inviteToken: new URLSearchParams(location.search).get('invite') || undefined,
    });
    token = data.access_token;
    expiry = data.expires_at;
    identity = data.member;
    client = createClient(
      import.meta.env.VITE_SUPABASE_URL,
      import.meta.env.VITE_SUPABASE_ANON_KEY,
      {
        accessToken: async () => {
          await ensureAuth();
          return token;
        },
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      },
    );
    return identity!;
  })();
  try {
    return await authenticating;
  } catch (e) {
    identity = null;
    token = '';
    expiry = 0;
    client = null;
    throw e;
  } finally {
    authenticating = null;
  }
}
async function ensureAuth() {
  if (!identity || expiry * 1000 < Date.now() + 60000) await authenticate();
}
export async function rows<T>(table: string, expectedMember?: string): Promise<T[]> {
  const cachedTables = [
    'club_books',
    'club_readings',
    'member_profiles',
    'member_privacy_settings',
    'meetings',
    'meeting_books',
    'meeting_attendance',
    'visible_progress',
    'visible_reviews',
    'public_quotes',
    'quote_likes',
    'visible_book_polls',
  ];
  const cacheable = cachedTables.includes(table);
  if (
    !navigator.onLine &&
    identity &&
    (!expectedMember || identity.id === expectedMember) &&
    cacheable
  ) {
    const cached = await getDB().cloud_cache.get(table);
    if (cached) return cached.rows as T[];
  }
  await ensureAuth();
  if (expectedMember && identity?.id !== expectedMember)
    throw new Error('Аккаунт изменился. Закройте и снова откройте приложение.');
  const order: Record<string, string[]> = {
    member_profiles: ['member_id'],
    member_privacy_settings: ['member_id'],
    quote_likes: ['quote_id', 'member_id'],
    meeting_books: ['meeting_id', 'book_id'],
    meeting_attendance: ['meeting_id', 'member_id'],
    club_settings: ['key'],
    private_library_records: ['kind', 'entity_id'],
    visible_member_invites: ['id'],
    visible_book_polls: ['id'],
  };
  const data: unknown[] = [];
  for (let start = 0; ; start += 500) {
    let request = client!.from(table).select('*');
    for (const key of order[table] || ['id']) request = request.order(key);
    if (table === 'notification_jobs')
      request = client!.from(table).select('*').order('run_at', { ascending: false }).limit(200);
    const response = await (table === 'notification_jobs'
      ? request
      : request.range(start, start + 499));
    if (
      response.error &&
      cacheable &&
      (!navigator.onLine ||
        /Failed to fetch|NetworkError|fetch failed/i.test(response.error.message))
    ) {
      const cached = await getDB().cloud_cache.get(table);
      if (cached) return cached.rows as T[];
    }
    if (response.error)
      throw new Error('Не удалось загрузить данные клуба. Проверьте сеть и состояние проекта.');
    data.push(...(response.data || []));
    if (table === 'notification_jobs' || (response.data?.length || 0) < 500) break;
  }
  if (expectedMember && identity?.id !== expectedMember)
    throw new Error('Аккаунт изменился. Закройте и снова откройте приложение.');
  if (table === 'club_books') {
    const db = getDB();
    await db.transaction('rw', db.club_catalog_cache, async () => {
      await db.club_catalog_cache.clear();
      await db.club_catalog_cache.bulkPut(data as import('./domain').ClubBook[]);
    });
  }
  if (cacheable)
    await getDB().cloud_cache.put({ table, rows: data, savedAt: new Date().toISOString() });
  return data as T[];
}
export async function action(name: string, data: unknown, expectedMember?: string) {
  await ensureAuth();
  if (expectedMember && identity?.id !== expectedMember)
    throw new Error('Аккаунт изменился. Закройте и снова откройте приложение.');
  return edge('club-api', { action: name, data }, true);
}
let syncing = false;
export async function flushQueue(
  send: (op: SyncOp) => Promise<unknown> = (op) => action('sync', op, op.scope),
  scope = identity?.id,
) {
  if (syncing || !navigator.onLine || !scope) return;
  syncing = true;
  const db = getDB();
  try {
    const ops = (await db.sync_queue.orderBy('createdAt').toArray())
      .filter((op) => op.scope === scope)
      .sort((a, b) => {
        const priority = (op: SyncOp) => (op.kind === 'privacy' ? 0 : op.payload === null ? 1 : 2);
        return priority(a) - priority(b) || a.createdAt.localeCompare(b.createdAt);
      });
    for (const op of ops) {
      try {
        await send(op);
        await db.transaction('rw', [db.sync_queue, db.quotes], async () => {
          if ((await db.sync_queue.get(op.id))?.revision === op.revision) {
            await db.sync_queue.delete(op.id);
            if (op.kind === 'quote' && op.payload === null)
              await db.quotes.update(op.entityId, { published: false });
          }
        });
      } catch (e) {
        await db.transaction('rw', db.sync_queue, async () => {
          if ((await db.sync_queue.get(op.id))?.revision === op.revision)
            await db.sync_queue.update(op.id, {
              attempts: op.attempts + 1,
              error: message(e),
            });
        });
        break;
      }
    }
  } finally {
    syncing = false;
  }
}
