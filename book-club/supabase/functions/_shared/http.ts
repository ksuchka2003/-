import { createClient } from 'npm:@supabase/supabase-js@2';
export const service = () =>
  createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
export function headers(req: Request) {
  const allowed = (Deno.env.get('ALLOWED_ORIGINS') || '').split(',').map((x) => x.trim());
  const origin = req.headers.get('origin') || '';
  return {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : 'null',
    Vary: 'Origin',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-cron-secret',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}
export function endpoint(handler: (req: Request) => Promise<unknown>) {
  return async (req: Request) => {
    const h = headers(req);
    if (req.method === 'OPTIONS') return new Response(null, { headers: h });
    if (req.method !== 'POST')
      return new Response(JSON.stringify({ error: 'Только POST' }), { status: 405, headers: h });
    const origin = req.headers.get('origin');
    if (origin && h['Access-Control-Allow-Origin'] === 'null')
      return new Response(JSON.stringify({ error: 'Недопустимый origin' }), {
        status: 403,
        headers: h,
      });
    try {
      return new Response(JSON.stringify(await handler(req)), { headers: h });
    } catch (e) {
      const raw = e instanceof Error ? e.message : '';
      const msg = /[А-Яа-яЁё]/.test(raw)
        ? raw
        : 'Не удалось выполнить запрос. Проверьте данные и повторите.';
      return new Response(JSON.stringify({ error: msg }), { status: 400, headers: h });
    }
  };
}
export async function body(req: Request) {
  const reader = req.body?.getReader();
  if (!reader) throw new Error('Пустой запрос');
  const decoder = new TextDecoder();
  let size = 0;
  let raw = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 100000) {
      await reader.cancel();
      throw new Error('Запрос больше 100 КБ');
    }
    raw += decoder.decode(value, { stream: true });
  }
  raw += decoder.decode();
  return JSON.parse(raw);
}
export function checked<T extends { data: unknown; error: { message: string } | null }>(
  r: T,
): T['data'] {
  if (r.error) {
    const code = (r.error as { code?: string }).code;
    if (code === '23505')
      throw new Error('Такая запись уже существует. Проверьте ISBN, название и автора.');
    if (code === '23503')
      throw new Error('Связанная запись удалена или недоступна. Обновите каталог.');
    if (code && ['23514', '23502', '22P02', '22007'].includes(code))
      throw new Error('Проверьте обязательные поля, даты и допустимые значения.');
    throw new Error(r.error.message);
  }
  return r.data;
}
export async function caller(req: Request) {
  const authorization = req.headers.get('authorization') || '';
  if (!/^Bearer \S+$/.test(authorization)) throw new Error('Нет сессии');
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data, error } = await db.auth.getUser(authorization.slice(7));
  if (error || !data.user) throw new Error('Сессия истекла');
  const member = checked(
    await service()
      .from('club_members')
      .select('id,role')
      .eq('auth_user_id', data.user.id)
      .eq('active', true)
      .single(),
  );
  if (!member) throw new Error('Нет доступа к клубу');
  return { db, member };
}
