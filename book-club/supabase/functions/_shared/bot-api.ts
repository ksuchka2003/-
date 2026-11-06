export async function telegram(method: string, data: unknown = {}) {
  const response = await fetch(
    `https://api.telegram.org/bot${Deno.env.get('TELEGRAM_BOT_TOKEN')}/${method}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(8000),
    },
  );
  const reply = await response.json();
  if (!response.ok || !reply.ok) throw new Error('Telegram API временно недоступен');
  return reply.result;
}
export class WebhookConflict extends Error {}
export async function installBot() {
  const me = await telegram('getMe');
  const ownUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/telegram-bot`;
  const old = await telegram('getWebhookInfo');
  if (old.url && old.url !== ownUrl)
    throw new WebhookConflict('У бота уже есть другой webhook. Он сохранён.');
  const secret = Deno.env.get('TELEGRAM_WEBHOOK_SECRET');
  if (!secret) throw new Error('Не настроен секрет webhook');
  await telegram('setWebhook', {
    url: ownUrl,
    secret_token: secret,
    allowed_updates: ['message', 'my_chat_member'],
    drop_pending_updates: false,
  });
  await telegram('setMyCommands', {
    commands: [
      { command: 'club', description: 'Открыть книжный клуб' },
      { command: 'start', description: 'Начать' },
      { command: 'connect_club', description: 'Подключить уведомления в этой группе' },
      { command: 'disconnect_club', description: 'Отключить уведомления в этой группе' },
    ],
  });
  return { username: me.username, hasMainApp: Boolean(me.has_main_web_app), installed: true };
}
