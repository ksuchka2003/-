const token = () => Deno.env.get('TELEGRAM_BOT_TOKEN')!;
async function telegram(method: string, data: unknown = {}) {
  const response = await fetch(`https://api.telegram.org/bot${token()}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(8000),
  });
  const reply = await response.json();
  if (!reply.ok) throw new Error('Telegram API временно недоступен');
  return reply.result;
}
Deno.serve(async (req) => {
  const secret = Deno.env.get('TELEGRAM_WEBHOOK_SECRET');
  if (
    req.method !== 'POST' ||
    !secret ||
    req.headers.get('x-telegram-bot-api-secret-token') !== secret
  )
    return new Response('Forbidden', { status: 403 });
  try {
    const raw = await req.text();
    if (raw.length > 64000) return new Response('Too large', { status: 413 });
    const update = JSON.parse(raw);
    const me = await telegram('getMe');
    const ownUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/telegram-bot`;
    if (update.install === true) {
      const old = await telegram('getWebhookInfo');
      if (old.url && old.url !== ownUrl)
        return Response.json(
          { error: 'У бота уже есть другой webhook. Он сохранён.' },
          { status: 409 },
        );
      await telegram('setWebhook', {
        url: ownUrl,
        secret_token: secret,
        allowed_updates: ['message'],
        drop_pending_updates: false,
      });
      await telegram('setMyCommands', {
        commands: [
          { command: 'club', description: 'Открыть книжный клуб' },
          { command: 'start', description: 'Начать' },
        ],
      });
      return Response.json({
        username: me.username,
        hasMainApp: Boolean(me.has_main_web_app),
        installed: true,
      });
    }
    const message = update.message;
    if (!message || typeof message.text !== 'string' || message.from?.is_bot)
      return Response.json({ ok: true });
    const match = message.text.match(/^\/(start|club)(?:@([a-z0-9_]+))?(?:\s+(\S+))?\s*$/i);
    if (!match || (match[2] && match[2].toLowerCase() !== me.username.toLowerCase()))
      return Response.json({ ok: true });
    if (message.chat.type === 'private') {
      const appUrl = new URL(Deno.env.get('TELEGRAM_APP_URL')!);
      if (/^join_[a-f0-9]{48}$/.test(match[3] || ''))
        appUrl.searchParams.set('invite', match[3].slice(5));
      await telegram('sendMessage', {
        chat_id: message.chat.id,
        text: 'Книжный клуб «Между строк»',
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Открыть книжный клуб', web_app: { url: appUrl.toString() } }],
          ],
        },
      });
    } else {
      const url = `https://t.me/${me.username}?${me.has_main_web_app ? 'startapp=club' : 'start=club'}`;
      await telegram('sendMessage', {
        chat_id: message.chat.id,
        text: 'Библиотека, голосования и встречи нашего книжного клуба.',
        reply_markup: { inline_keyboard: [[{ text: 'Открыть книжный клуб', url }]] },
      });
    }
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: 'Не удалось обработать команду' }, { status: 500 });
  }
});
export {};
