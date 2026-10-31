// @vitest-environment node
import { beforeAll, afterAll, beforeEach, it, expect, vi } from 'vitest';
let handler: (req: Request) => Promise<Response>;
const env: Record<string, string> = {
  TELEGRAM_BOT_TOKEN: 'unit-test-token',
  TELEGRAM_WEBHOOK_SECRET: 'unit-test-secret',
  SUPABASE_URL: 'https://club.test.invalid',
  TELEGRAM_APP_URL: 'https://books.test.invalid/-/',
};
let calls: { method: string; data: any }[];
let oldWebhook = '';
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
            ? { username: 'test_club_bot', has_main_web_app: true }
            : method === 'getWebhookInfo'
              ? { url: oldWebhook }
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
  expect(call.data.allowed_updates).toEqual(['message']);
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
