import { telegram, installBot, WebhookConflict } from '../_shared/bot-api.ts';
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
    if (update.install === true) return Response.json(await installBot());
    const message = update.message;
    if (
      !message ||
      message.chat?.type !== 'private' ||
      typeof message.text !== 'string' ||
      message.from?.is_bot
    )
      return Response.json({ ok: true });
    const match = message.text.match(/^\/(start|club)(?:@([a-z0-9_]+))?(?:\s+(\S+))?\s*$/i);
    if (!match || (match[2] && match[2].toLowerCase() !== me.username.toLowerCase()))
      return Response.json({ ok: true });
    {
      const appUrl = new URL(Deno.env.get('TELEGRAM_APP_URL')!);
      appUrl.hash = '/';
      if (/^join_[a-f0-9]{48}$/.test(match[3] || ''))
        appUrl.searchParams.set('invite', match[3].slice(5));
      await telegram('sendMessage', {
        chat_id: message.chat.id,
        text: 'Книжный клуб',
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Открыть книжный клуб', web_app: { url: appUrl.toString() } }],
          ],
        },
      });
    }
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof WebhookConflict)
      return Response.json({ error: error.message }, { status: 409 });
    return Response.json({ error: 'Не удалось обработать команду' }, { status: 500 });
  }
});
export {};
