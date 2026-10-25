import { endpoint, service, checked } from '../_shared/http.ts';
Deno.serve(
  endpoint(async (req) => {
    const secret = Deno.env.get('CRON_SECRET');
    if (!secret || req.headers.get('x-cron-secret') !== secret) throw new Error('Нет доступа');
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
        const meeting = checked(
          await db.from('meetings').select('*').eq('id', job.meeting_id).single(),
        );
        const member = checked(
          await db.from('club_members').select('*').eq('id', job.member_id).single(),
        );
        const attendance = checked(
          await db
            .from('meeting_attendance')
            .select('response')
            .eq('meeting_id', job.meeting_id)
            .eq('member_id', job.member_id)
            .maybeSingle(),
        );
        const reminder = ['24h', '1h'].includes(job.kind);
        if (
          !member.active ||
          meeting.version !== job.meeting_version ||
          (meeting.cancelled && job.kind !== 'cancelled') ||
          (reminder &&
            (attendance?.response === 'no' || new Date(meeting.starts_at).getTime() <= Date.now()))
        ) {
          await finish({ status: 'skipped' });
          continue;
        }
        const prefix = (
          {
            new: 'Новая встреча',
            changed: 'Встреча изменена',
            cancelled: 'Встреча отменена',
            '24h': 'Встреча через 24 часа',
            '1h': 'Встреча через час',
          } as Record<string, string>
        )[job.kind];
        const text =
          `${prefix}: ${meeting.title}\n${new Date(meeting.starts_at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })} (МСК)\n${meeting.place}\n${meeting.description}`.slice(
            0,
            4000,
          );
        const response = await fetch(
          `https://api.telegram.org/bot${Deno.env.get('TELEGRAM_BOT_TOKEN')}/sendMessage`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: member.telegram_id, text }),
            signal: AbortSignal.timeout(15000),
          },
        );
        const result = await response.json();
        if (!response.ok || !result.ok) {
          if (response.status === 403) {
            await finish({
              status: 'failed',
              last_error: 'Пользователь заблокировал бота или не нажал /start',
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
