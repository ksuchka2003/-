import { telegram, installBot, WebhookConflict } from '../_shared/bot-api.ts';
import { service, checked } from '../_shared/http.ts';
import { groupCommand, isChatAdmin } from '../_shared/group-commands.ts';
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
    const db = service();
    if (update.my_chat_member) {
      const change = update.my_chat_member;
      if (['left', 'kicked'].includes(change.new_chat_member?.status)) {
        checked(
          await db
            .from('notification_chat')
            .update({ active: false })
            .eq('chat_id', change.chat.id),
        );
        checked(
          await db
            .from('notification_jobs')
            .update({ status: 'skipped' })
            .eq('chat_id', change.chat.id)
            .in('status', ['pending', 'processing']),
        );
      }
      return Response.json({ ok: true });
    }
    if (message?.migrate_to_chat_id) {
      checked(
        await db.rpc('migrate_notification_chat', {
          p_old: message.chat.id,
          p_new: message.migrate_to_chat_id,
        }),
      );
      return Response.json({ ok: true });
    }
    if (!message || typeof message.text !== 'string' || message.from?.is_bot)
      return Response.json({ ok: true });
    const command = groupCommand(message.text, me.username);
    if (command) {
      let text = 'Выполните эту команду в группе книжного клуба.';
      if (['group', 'supergroup'].includes(message.chat.type)) {
        const member = checked(
          await db
            .from('club_members')
            .select('role,active')
            .eq('telegram_id', message.from.id)
            .maybeSingle(),
        );
        if (!member?.active || member.role !== 'admin' || message.sender_chat) {
          text = 'Подключить группу может администратор книжного клуба со своего аккаунта.';
        } else {
          const bot = await telegram('getChatMember', { chat_id: message.chat.id, user_id: me.id });
          if (!isChatAdmin(bot.status))
            text =
              'Сначала назначьте бота администратором группы, затем повторите команду. Это нужно для проверки прав и отправки уведомлений.';
          else {
            const person = await telegram('getChatMember', {
              chat_id: message.chat.id,
              user_id: message.from.id,
            });
            if (!isChatAdmin(person.status))
              text = 'Команду должен отправить администратор этой группы.';
            else {
              checked(
                await db.rpc('connect_notification_chat', {
                  p_telegram: message.from.id,
                  p_chat: message.chat.id,
                  p_title: message.chat.title || 'Книжный клуб',
                  p_active: command === 'connect_club',
                }),
              );
              text =
                command === 'connect_club'
                  ? 'Группа подключена. Здесь будут выбранные книги, встречи и напоминания за день.'
                  : 'Уведомления в этой группе отключены.';
            }
          }
        }
      }
      await telegram('sendMessage', { chat_id: message.chat.id, text });
      return Response.json({ ok: true });
    }
    const match = message.text.match(/^\/(start|club)(?:@([a-z0-9_]+))?(?:\s+(\S+))?\s*$/i);
    if (!match || (match[2] && match[2].toLowerCase() !== me.username.toLowerCase()))
      return Response.json({ ok: true });
    if (message.chat.type === 'private') {
      const appUrl = new URL(Deno.env.get('TELEGRAM_APP_URL')!);
      appUrl.hash = '/';
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
  } catch (error) {
    if (error instanceof WebhookConflict)
      return Response.json({ error: error.message }, { status: 409 });
    return Response.json({ error: 'Не удалось обработать команду' }, { status: 500 });
  }
});
export {};
