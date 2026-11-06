// @vitest-environment node
import { beforeAll, afterAll, beforeEach, it, expect, vi } from 'vitest';
const store = vi.hoisted(() => ({ role: 'admin', active: true, rpcs: [] as any[] }));
vi.mock('../supabase/functions/_shared/http.ts', () => ({
  service: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { role: store.role, active: store.active },
            error: null,
          }),
        }),
      }),
    }),
    rpc: async (name: string, data: unknown) => {
      store.rpcs.push({ name, data });
      return { data: { active: true }, error: null };
    },
  }),
  checked: (r: any) => {
    if (r.error) throw new Error(r.error.message);
    return r.data;
  },
}));
let handler: (req: Request) => Promise<Response>;
const env: Record<string, string> = {
  TELEGRAM_BOT_TOKEN: 'unit-test-token',
  TELEGRAM_WEBHOOK_SECRET: 'unit-test-secret',
  SUPABASE_URL: 'https://club.test.invalid',
  TELEGRAM_APP_URL: 'https://books.test.invalid/-/',
};
let calls: { method: string; data: any }[];
let oldWebhook = '';
let botAdmin = true,
  personAdmin = true;
beforeAll(async () => {
  vi.stubGlobal('Deno', {
    env: { get: (key: string) => env[key] },
    serve: (fn: typeof handler) => {
      handler = fn;
    },
  });
  await import('../supabase/functions/telegram-bot/index');
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  calls = [];
  oldWebhook = '';
  store.role = 'admin';
  store.active = true;
  store.rpcs = [];
  botAdmin = true;
  personAdmin = true;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, opts: RequestInit) => {
      const method = url.split('/').at(-1)!;
      const data = JSON.parse(opts.body as string);
      calls.push({ method, data });
      return Response.json({
        ok: true,
        result:
          method === 'getMe'
            ? { id: 999, username: 'test_club_bot', has_main_web_app: true }
            : method === 'getWebhookInfo'
              ? { url: oldWebhook }
              : method === 'getChatMember'
                ? {
                    status: (data.user_id === 999 ? botAdmin : personAdmin)
                      ? 'administrator'
                      : 'member',
                  }
                : true,
      });
    }),
  );
});
const request = (body: unknown, secret = 'unit-test-secret') =>
  new Request('https://club.test.invalid/functions/v1/telegram-bot', {
    method: 'POST',
    headers: { 'x-telegram-bot-api-secret-token': secret },
    body: JSON.stringify(body),
  });
it('отклоняет неподтверждённые вызовы, включая установку webhook', async () => {
  expect((await handler(request({ install: true }, 'wrong'))).status).toBe(403);
  expect(calls).toHaveLength(0);
});
it('устанавливает только свой webhook и сохраняет ожидающие обновления', async () => {
  expect((await handler(request({ install: true }))).status).toBe(200);
  const call = calls.find((c) => c.method === 'setWebhook')!;
  expect(call.data.url).toBe('https://club.test.invalid/functions/v1/telegram-bot');
  expect(call.data.drop_pending_updates).toBe(false);
  expect(call.data.allowed_updates).toEqual(['message', 'my_chat_member']);
});
it('не перезаписывает webhook другого приложения', async () => {
  oldWebhook = 'https://other.test.invalid/webhook';
  expect((await handler(request({ install: true }))).status).toBe(409);
  expect(calls.some((c) => c.method === 'setWebhook')).toBe(false);
});
it('передаёт приглашение в личную кнопку Mini App и отвечает группе обычной ссылкой', async () => {
  await handler(
    request({
      message: {
        text: '/start join_' + 'a'.repeat(48),
        from: { is_bot: false },
        chat: { id: 42, type: 'private' },
      },
    }),
  );
  const personal = calls.find((c) => c.method === 'sendMessage')!.data;
  expect(personal.reply_markup.inline_keyboard[0][0].web_app.url).toContain(
    'invite=' + 'a'.repeat(48),
  );
  expect(new URL(personal.reply_markup.inline_keyboard[0][0].web_app.url).hash).toBe('#/');
  calls = [];
  await handler(
    request({
      message: {
        text: '/club@test_club_bot',
        from: { is_bot: false },
        chat: { id: -100123, type: 'supergroup' },
      },
    }),
  );
  const group = calls.find((c) => c.method === 'sendMessage')!.data;
  expect(group.reply_markup.inline_keyboard[0][0].url).toBe(
    'https://t.me/test_club_bot?startapp=club',
  );
  expect(group.reply_markup.inline_keyboard[0][0].web_app).toBeUndefined();
});
it('не отвечает на команды другого бота и сообщения пользователей', async () => {
  for (const text of ['/club@another_bot', 'Привет'])
    await handler(
      request({ message: { text, from: { is_bot: false }, chat: { id: 42, type: 'private' } } }),
    );
  expect(calls.some((c) => c.method === 'sendMessage')).toBe(false);
});
const connectMessage = () => ({
  message: {
    text: '/connect_club@test_club_bot',
    from: { id: 42, is_bot: false },
    chat: { id: -100123, type: 'supergroup', title: 'Наш книжный клуб' },
  },
});
it('подключает группу только от администратора клуба и группы, передаёт подтверждённые Telegram ID серверу', async () => {
  const result = await handler(request(connectMessage()));
  expect(result.status).toBe(200);
  expect(store.rpcs).toEqual([
    {
      name: 'connect_notification_chat',
      data: { p_telegram: 42, p_chat: -100123, p_title: 'Наш книжный клуб', p_active: true },
    },
  ]);
  expect(calls.find((c) => c.method === 'sendMessage')?.data.text).toContain('Группа подключена');
});
it('чужой участник, отключённый администратор и анонимный отправитель не могут подключить группу', async () => {
  store.role = 'member';
  await handler(request(connectMessage()));
  store.role = 'admin';
  store.active = false;
  await handler(request(connectMessage()));
  store.active = true;
  const anonymous = connectMessage();
  await handler(request({ message: { ...anonymous.message, sender_chat: { id: -100123 } } }));
  expect(store.rpcs).toHaveLength(0);
  expect(calls.filter((c) => c.method === 'getChatMember')).toHaveLength(0);
});
it('проверяет права бота и отправителя в Telegram до привязки', async () => {
  botAdmin = false;
  await handler(request(connectMessage()));
  expect(calls.find((c) => c.method === 'sendMessage')?.data.text).toContain(
    'назначьте бота администратором',
  );
  botAdmin = true;
  personAdmin = false;
  await handler(request(connectMessage()));
  expect(store.rpcs).toHaveLength(0);
});
it('личная команда и команда другого бота не привязывают группу', async () => {
  const input = connectMessage();
  await handler(request({ message: { ...input.message, chat: { id: 42, type: 'private' } } }));
  await handler(request({ message: { ...input.message, text: '/connect_club@other_bot' } }));
  expect(store.rpcs).toHaveLength(0);
});
