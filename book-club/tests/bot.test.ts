// @vitest-environment node
import { beforeAll, afterAll, beforeEach, it, expect, vi } from 'vitest';
let handler: (req: Request) => Promise<Response>;
const env: Record<string, string> = {
  TELEGRAM_BOT_TOKEN: 'unit-test-token',
  TELEGRAM_WEBHOOK_SECRET: 'unit-test-secret',
  SUPABASE_URL: 'https://club.test.invalid',
  TELEGRAM_APP_URL: 'https://books.test.invalid/-/',
};
let calls: { method: string; data: any }[] = [],
  oldWebhook = '';
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
      const method = url.split('/').at(-1)!,
        data = JSON.parse(opts.body as string);
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
it('отклоняет неподтверждённые вызовы', async () => {
  expect((await handler(request({ install: true }, 'wrong'))).status).toBe(403);
  expect(calls).toHaveLength(0);
});
it('настраивает webhook и меню, не предлагает групповую рассылку', async () => {
  expect((await handler(request({ install: true }))).status).toBe(200);
  const call = calls.find((c) => c.method === 'setWebhook')!;
  expect(call.data.allowed_updates).toEqual(['message']);
  expect(call.data.drop_pending_updates).toBe(false);
  expect(
    calls.find((c) => c.method === 'setMyCommands')?.data.commands.map((c: any) => c.command),
  ).toEqual(['club', 'start']);
  expect(calls.find((c) => c.method === 'setChatMenuButton')?.data.menu_button.web_app.url).toBe(
    'https://books.test.invalid/-/#/',
  );
});
it('сохраняет webhook другого приложения', async () => {
  oldWebhook = 'https://other.test.invalid/webhook';
  expect((await handler(request({ install: true }))).status).toBe(409);
  expect(calls.some((c) => c.method === 'setWebhook')).toBe(false);
});
it('личная кнопка открывает главную и сохраняет токен приглашения', async () => {
  await handler(
    request({
      message: {
        text: '/start join_' + 'a'.repeat(48),
        from: { is_bot: false },
        chat: { id: 42, type: 'private' },
      },
    }),
  );
  const data = calls.find((c) => c.method === 'sendMessage')!.data,
    url = new URL(data.reply_markup.inline_keyboard[0][0].web_app.url);
  expect(data.chat_id).toBe(42);
  expect(url.searchParams.get('invite')).toBe('a'.repeat(48));
  expect(url.hash).toBe('#/');
});
it('не отправляет сообщения в группы, даже по старой команде подключения', async () => {
  for (const text of ['/club@test_club_bot', '/connect_club@test_club_bot', '/start', 'Привет'])
    await handler(
      request({
        message: {
          text,
          from: { id: 42, is_bot: false },
          chat: { id: -100123, type: 'supergroup' },
        },
      }),
    );
  expect(calls.some((c) => c.method === 'sendMessage')).toBe(false);
});
it('не отвечает на чужие команды и сообщения ботов', async () => {
  for (const text of ['/club@other_bot', 'Привет'])
    await handler(
      request({ message: { text, from: { is_bot: false }, chat: { id: 42, type: 'private' } } }),
    );
  await handler(
    request({
      message: { text: '/club', from: { is_bot: true }, chat: { id: 42, type: 'private' } },
    }),
  );
  expect(calls.some((c) => c.method === 'sendMessage')).toBe(false);
});
