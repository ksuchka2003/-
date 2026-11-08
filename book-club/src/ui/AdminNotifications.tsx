import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { action } from '../cloud';
import { useCloud, useTask, ErrorNote, Empty, Loading } from './shared';
type Job = { id: string; status: string; kind: string; last_error: string | null; run_at: string };
const kinds: Record<string, string> = {
  new: 'Новая встреча',
  changed: 'Изменение встречи',
  cancelled: 'Отмена встречи',
  '24h': 'Напоминание за сутки',
  '1h': 'Напоминание за час',
  selected_book: 'Выбранная книга',
};
const statuses: Record<string, string> = {
  pending: 'В очереди',
  processing: 'Отправляется',
  sent: 'Отправлено',
  failed: 'Не отправлено',
  skipped: 'Пропущено',
};
export function AdminNotifications() {
  const jobs = useCloud<Job>('notification_jobs');
  const [more, setMore] = useState(false);
  const [failedOnly, setFailedOnly] = useState(false);
  const { run, busy, error } = useTask();
  const query = useQueryClient();
  const failures = (jobs.data || []).filter((j) => j.status === 'failed');
  const listed = failedOnly ? failures : jobs.data || [];
  return (
    <>
      <p className="section-hint">
        Бот пишет в личный чат: выбранная книга, встречи и напоминание за сутки. Участнику нужно
        один раз нажать «Начать» в боте.
      </p>
      <ErrorNote text={error || jobs.error?.message} />
      {jobs.isLoading ? (
        <Loading label="Загружаем отправки…" />
      ) : (
        !jobs.error && (
          <>
            {failures.length > 0 && (
              <div className="delivery-notice">
                <p>Не отправлено: {failures.length}. Можно повторить попытку.</p>
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await action('admin.retry_notifications', {});
                      await query.invalidateQueries({ queryKey: ['cloud'] });
                    }, 'Сообщения возвращены в очередь')
                  }
                >
                  <RefreshCw size={16} />
                  Повторить отправку
                </button>
              </div>
            )}
            <h2 className="list-heading">Последние отправки</h2>
            {failures.length > 0 && (
              <div className="segmented" role="group" aria-label="Список отправок">
                <button
                  aria-pressed={!failedOnly}
                  onClick={() => {
                    setFailedOnly(false);
                    setMore(false);
                  }}
                >
                  Все
                </button>
                <button
                  aria-pressed={failedOnly}
                  onClick={() => {
                    setFailedOnly(true);
                    setMore(false);
                  }}
                >
                  С ошибкой
                </button>
              </div>
            )}
            {!listed.length ? (
              <Empty title="Отправок пока нет" />
            ) : (
              <div className="stack admin-list">
                {listed.slice(0, more ? undefined : 10).map((j) => (
                  <article className="delivery-row" key={j.id}>
                    <div>
                      <b>{kinds[j.kind] || 'Уведомление'}</b>
                      <span className={`badge ${j.status === 'failed' ? 'delivery-failed' : ''}`}>
                        {statuses[j.status] || 'Ожидает'}
                      </span>
                    </div>
                    {j.run_at && (
                      <small>
                        {new Date(j.run_at).toLocaleString('ru-RU', {
                          timeZone: 'Europe/Moscow',
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}{' '}
                        · МСК
                      </small>
                    )}
                    {j.last_error && j.status === 'failed' && (
                      <details>
                        <summary>Причина ошибки</summary>
                        <p>{j.last_error}</p>
                      </details>
                    )}
                  </article>
                ))}
              </div>
            )}
            {listed.length > 10 && !more && (
              <button className="load-more" onClick={() => setMore(true)}>
                Показать остальные
              </button>
            )}
            <details className="book-extra admin-history">
              <summary>О доставке уведомлений</summary>
              <p className="section-hint">
                Напоминания могут задерживаться, если облачный проект приостановлен или Telegram
                недоступен. Если участник заблокировал бота, ему нужно сначала снова открыть чат с
                ботом.
              </p>
            </details>
          </>
        )
      )}
    </>
  );
}
