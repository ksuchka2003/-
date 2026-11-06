import { endpoint, service, checked } from '../_shared/http.ts';
import {
  shouldNotify,
  meetingNotificationText,
  selectedBookText,
} from '../_shared/meeting-notifications.ts';
import { installBot } from '../_shared/bot-api.ts';
Deno.serve(
  endpoint(async (req) => {
    const secret = Deno.env.get('CRON_SECRET');
    if (!secret || req.headers.get('x-cron-secret') !== secret) throw new Error('Нет доступа');
    if (req.headers.get('x-bookclub-probe') === '1') {
      if (req.headers.get('x-bookclub-install') === '1') return installBot();
      const response = await fetch(
        `https://api.telegram.org/bot${Deno.env.get('TELEGRAM_BOT_TOKEN')}/getMe`,
        { signal: AbortSignal.timeout(10000) },
      );
      const result = await response.json();
      if (!response.ok || !result.ok)
        throw new Error('Не удалось проверить подключение Telegram-бота');
      return { ready: true, botUsername: result.result.username };
    }
    const db = service();
    const jobs = checked(await db.rpc('claim_notifications'));
    let sent = 0;
    for (const job of jobs || []) {
      const finish = async (values: Record<string, unknown>) =>
        checked(
          await db
            .from('notification_jobs')
            .update(values)
            .eq('id', job.id)
            .eq('lock_token', job.lock_token)
            .eq('status', 'processing'),
        );
      try {
        const group = checked(
          await db.from('notification_chat').select('*').eq('active', true).maybeSingle(),
        );
        if (
          !job.chat_id ||
          !group ||
          group.chat_id !== job.chat_id ||
          group.generation !== job.chat_generation
        ) {
          await finish({ status: 'skipped' });
          continue;
        }
        let text: string;
        if (job.kind === 'selected_book') {
          const current = checked(
            await db.rpc('book_announcement_current', {
              p_book: job.book_id,
              p_generation: job.book_generation,
            }),
          );
          const book = checked(
            await db.from('club_books').select('title,authors').eq('id', job.book_id).maybeSingle(),
          );
          if (!current || !book) {
            await finish({ status: 'skipped' });
            continue;
          }
          text = selectedBookText(book);
        } else {
          const meeting = checked(
            await db.from('meetings').select('*').eq('id', job.meeting_id).maybeSingle(),
          );
          if (!meeting || !shouldNotify(job, meeting, true)) {
            await finish({ status: 'skipped' });
            continue;
          }
          text = meetingNotificationText(job.kind, meeting);
        }
        const response = await fetch(
          `https://api.telegram.org/bot${Deno.env.get('TELEGRAM_BOT_TOKEN')}/sendMessage`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: job.chat_id,
              text,
              link_preview_options: { is_disabled: true },
            }),
            signal: AbortSignal.timeout(15000),
          },
        );
        const result = await response.json();
        if (!response.ok || !result.ok) {
          if (result.parameters?.migrate_to_chat_id) {
            checked(
              await db.rpc('migrate_notification_chat', {
                p_old: job.chat_id,
                p_new: result.parameters.migrate_to_chat_id,
              }),
            );
            await finish({ status: 'pending', run_at: new Date().toISOString() });
            continue;
          }
          if (response.status === 403) {
            await finish({
              status: 'failed',
              last_error: 'Бот удалён из группы или ему запрещена отправка сообщений',
            });
            continue;
          }
          const delay = Math.max(
            result.parameters?.retry_after || 0,
            Math.min(3600, 30 * 2 ** job.attempts),
          );
          await finish({
            status: job.attempts >= 6 ? 'failed' : 'pending',
            run_at: new Date(Date.now() + delay * 1000).toISOString(),
            last_error: String(result.description).slice(0, 500),
          });
          continue;
        }
        await finish({ status: 'sent', sent_at: new Date().toISOString(), last_error: null });
        sent++;
      } catch {
        await finish({
          status: job.attempts >= 6 ? 'failed' : 'pending',
          run_at: new Date(Date.now() + 60000).toISOString(),
          last_error: 'Сетевая ошибка отправки',
        });
      }
    }
    return { sent, processed: jobs?.length || 0 };
  }),
);
