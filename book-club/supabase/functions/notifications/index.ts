import { endpoint, service, checked } from '../_shared/http.ts';
import { shouldNotify, meetingNotificationText } from '../_shared/meeting-notifications.ts';
Deno.serve(
  endpoint(async (req) => {
    const secret = Deno.env.get('CRON_SECRET');
    if (!secret || req.headers.get('x-cron-secret') !== secret) throw new Error('Нет доступа');
    if(req.headers.get('x-bookclub-probe')==='1'){
      const response=await fetch(`https://api.telegram.org/bot${Deno.env.get('TELEGRAM_BOT_TOKEN')}/getMe`,{signal:AbortSignal.timeout(10000)});
      const result=await response.json();
      if(!response.ok||!result.ok)throw new Error('Не удалось проверить подключение Telegram-бота');
      return {ready:true,botUsername:result.result.username};
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
        const meeting = checked(
          await db.from('meetings').select('*').eq('id', job.meeting_id).single(),
        );
        const member = checked(
          await db.from('club_members').select('*').eq('id', job.member_id).single(),
        );
        const attendance = checked(
          await db
            .from('meeting_attendance')
            .select('response,schedule_version')
            .eq('meeting_id', job.meeting_id)
            .eq('member_id', job.member_id)
            .maybeSingle(),
        );
        if (!shouldNotify(job,meeting,member.active,attendance)) {
          await finish({ status: 'skipped' });
          continue;
        }
        const text = meetingNotificationText(job.kind,meeting);
        const appUrl = Deno.env.get('TELEGRAM_APP_URL');
        const appLink = appUrl ? new URL(appUrl) : null;
        if(appLink) appLink.hash='/meetings';
        const response = await fetch(
          `https://api.telegram.org/bot${Deno.env.get('TELEGRAM_BOT_TOKEN')}/sendMessage`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: member.telegram_id, text, ...(appLink ? {reply_markup:{inline_keyboard:[[{text:'Открыть встречу',web_app:{url:appLink.href}}]]}} : {}) }),
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
