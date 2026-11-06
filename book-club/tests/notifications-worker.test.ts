// @vitest-environment node
import { beforeAll, afterAll, beforeEach, it, expect, vi } from 'vitest';
const state = vi.hoisted(() => ({
  jobs: [] as any[],
  members: {} as Record<string, any>,
  updates: [] as any[],
  rpcCalls: [] as string[],
  current: true,
  version: 1,
}));
vi.mock('../supabase/functions/_shared/http.ts', () => ({
  endpoint: (fn: any) => fn,
  checked: (r: any) => {
    if (r.error) throw new Error(r.error.message);
    return r.data;
  },
  service: () => ({
    rpc: async (name: string) => {
      state.rpcCalls.push(name);
      return { data: name === 'claim_notifications' ? state.jobs : state.current, error: null };
    },
    from: (table: string) => ({
      update: (values: any) => {
        let id = '';
        const chain = {
          eq: (key: string, value: any): any => {
            if (key === 'id') id = value;
            if (key === 'status') {
              state.updates.push({ id, ...values });
              return Promise.resolve({ data: null, error: null });
            }
            return chain;
          },
        };
        return chain;
      },
      select: () => ({
        eq: (_key: string, id: string) => ({
          maybeSingle: async () => ({
            data:
              table === 'club_members'
                ? state.members[id] || null
                : table === 'club_books'
                  ? { title: 'Охота на овец', authors: 'Харуки Мураками' }
                  : {
                      version: state.version,
                      cancelled: false,
                      title: 'Встреча',
                      starts_at: new Date(Date.now() + 86400000).toISOString(),
                      place: 'Кафе',
                      description: '',
                    },
            error: null,
          }),
        }),
      }),
    }),
  }),
}));
let handler: (request: Request) => Promise<any>,
  sent: any[] = [];
beforeAll(async () => {
  vi.stubGlobal('Deno', {
    env: { get: (key: string) => (key === 'CRON_SECRET' ? 'secret' : 'test-token') },
    serve: (fn: typeof handler) => (handler = fn),
  });
  await import('../supabase/functions/notifications/index');
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  state.jobs = [];
  state.members = {
    a: { active: true, telegram_id: 42 },
    b: { active: false, telegram_id: 43 },
    bad: { active: true, telegram_id: -123 },
  };
  state.updates = [];
  state.rpcCalls = [];
  state.current = true;
  state.version = 1;
  sent = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, opts: RequestInit) => {
      if (url.endsWith('/getMe'))
        return Response.json({ ok: true, result: { username: 'test_club_bot' } });
      const data = JSON.parse(opts.body as string);
      sent.push(data);
      return Response.json({ ok: true, result: { message_id: 1 } });
    }),
  );
});
const request = (extra: Record<string, string> = {}) =>
  new Request('https://club.test.invalid/functions/v1/notifications', {
    method: 'POST',
    headers: { 'x-cron-secret': 'secret', ...extra },
  });
const job = (id: string, member = 'a') => ({
  id,
  member_id: member,
  chat_id: null,
  kind: 'selected_book',
  book_id: 'book',
  book_generation: 1,
  meeting_version: 1,
  lock_token: 'lock',
  attempts: 1,
});
it('отправляет выбранную книгу только в подтверждённый личный Telegram-чат и отмечает sent после ответа', async () => {
  state.jobs = [job('one')];
  expect(await handler(request())).toEqual({ sent: 1, processed: 1 });
  expect(sent).toEqual([
    {
      chat_id: 42,
      text: 'Выбранная книга: Охота на овец — Харуки Мураками',
      link_preview_options: { is_disabled: true },
    },
  ]);
  expect(state.updates[0].status).toBe('sent');
});
it('пропускает любые группы, удалённых участников, неизвестные аккаунты и отрицательные ID', async () => {
  state.jobs = [
    { ...job('group'), member_id: null, chat_id: -123 },
    job('inactive', 'b'),
    job('unknown', 'none'),
    job('negative', 'bad'),
  ];
  await handler(request());
  expect(sent).toHaveLength(0);
  expect(state.updates).toHaveLength(4);
  expect(state.updates.every((x) => x.status === 'skipped')).toBe(true);
});
it('не отправляет устаревшую книгу или встречу прежней версии', async () => {
  state.current = false;
  state.version = 2;
  state.jobs = [job('book'), { ...job('meeting'), kind: '24h', meeting_id: 'meeting' }];
  await handler(request());
  expect(sent).toHaveLength(0);
  expect(state.updates.every((x) => x.status === 'skipped')).toBe(true);
});
it('403 объясняет необходимость /start, 429 переносит отправку, сетевая ошибка остаётся в очереди', async () => {
  state.jobs = [job('blocked'), job('limited'), job('network')];
  let i = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      i++;
      if (i === 3) throw new TypeError('Failed to fetch');
      return Response.json(
        { ok: false, description: 'failed', parameters: { retry_after: 120 } },
        { status: i === 1 ? 403 : 429 },
      );
    }),
  );
  await handler(request());
  expect(state.updates.map((x) => x.status)).toEqual(['failed', 'pending', 'pending']);
  expect(state.updates[0].last_error).toContain('/start');
  expect(Date.parse(state.updates[1].run_at)).toBeGreaterThan(Date.now() + 110000);
});
it('отклоняет неверный cron-secret до получения заданий', async () => {
  await expect(handler(request({ 'x-cron-secret': 'wrong' }))).rejects.toThrow('Нет доступа');
  expect(state.rpcCalls).toHaveLength(0);
  expect(sent).toHaveLength(0);
});
it('проверка готовности не забирает задания и не отправляет сообщения', async () => {
  state.jobs = [job('untouched')];
  const result = await handler(request({ 'x-bookclub-probe': '1' }));
  expect(result.ready).toBe(true);
  expect(state.rpcCalls).toHaveLength(0);
  expect(sent).toHaveLength(0);
});
