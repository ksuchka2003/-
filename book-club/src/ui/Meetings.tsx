import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, MapPin, CalendarDays, Pencil } from 'lucide-react';
import { type Meeting, type ClubBook, type Profile, uid } from '../domain';
import { action } from '../cloud';
import {
  CloudGate,
  Modal,
  Field,
  useCloud,
  useSession,
  useTask,
  Empty,
  Loading,
  ErrorNote,
  dateLabel,
} from './shared';
export function MeetingEditor({ meeting, onClose }: { meeting?: Meeting; onClose: () => void }) {
  const books = useCloud<ClubBook>('club_books');
  const links = useCloud<{ meeting_id: string; book_id: string }>('meeting_books');
  const [v, setV] = useState(
    meeting || {
      id: uid(),
      title: '',
      starts_at: '',
      place: '',
      description: '',
      cancelled: false,
      version: 1,
    },
  );
  const [ids, setIds] = useState<string[] | null>(null);
  const selected =
    ids || links.data?.filter((l) => l.meeting_id === meeting?.id).map((l) => l.book_id) || [];
  const { run, busy, error } = useTask();
  const query = useQueryClient();
  const localDate = v.starts_at
    ? new Date(Date.parse(v.starts_at) - new Date(v.starts_at).getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16)
    : '';
  return (
    <Modal title={meeting ? 'Редактировать встречу' : 'Новая встреча'} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await run(async () => {
              await action('admin.meeting', { ...v, book_ids: selected });
              await query.invalidateQueries({ queryKey: ['cloud'] });
            }, 'Встреча сохранена, уведомления поставлены в очередь')
          )
            onClose();
        }}
      >
        <Field label="Название встречи">
          <input
            required
            maxLength={300}
            value={v.title}
            onChange={(e) => setV({ ...v, title: e.target.value })}
          />
        </Field>
        <Field label="Дата и время (часовой пояс устройства)">
          <input
            type="datetime-local"
            required
            value={localDate}
            onChange={(e) =>
              setV({
                ...v,
                starts_at: e.target.value ? new Date(e.target.value).toISOString() : '',
              })
            }
          />
        </Field>
        <Field label="Место или ссылка">
          <input
            maxLength={1000}
            value={v.place}
            onChange={(e) => setV({ ...v, place: e.target.value })}
          />
        </Field>
        <Field label="Описание">
          <textarea
            maxLength={10000}
            rows={4}
            value={v.description}
            onChange={(e) => setV({ ...v, description: e.target.value })}
          />
        </Field>
        <fieldset>
          <legend>Обсуждаем книги</legend>
          {books.data?.map((b) => (
            <label className="check" key={b.id}>
              <input
                type="checkbox"
                checked={selected.includes(b.id)}
                onChange={(e) =>
                  setIds(
                    e.target.checked ? [...selected, b.id] : selected.filter((x) => x !== b.id),
                  )
                }
              />
              {b.title}
            </label>
          ))}
        </fieldset>
        {meeting && (
          <label className="check">
            <input
              type="checkbox"
              checked={v.cancelled}
              onChange={(e) => setV({ ...v, cancelled: e.target.checked })}
            />{' '}
            Встреча отменена (участники получат уведомление)
          </label>
        )}
        <ErrorNote text={error} />
        <button className="primary" disabled={busy}>
          Сохранить встречу
        </button>
      </form>
    </Modal>
  );
}
export function Meetings() {
  const meetings = useCloud<Meeting>('meetings');
  const books = useCloud<ClubBook>('club_books');
  const links = useCloud<{ meeting_id: string; book_id: string }>('meeting_books');
  const attend = useCloud<{ meeting_id: string; member_id: string; response: string }>(
    'meeting_attendance',
  );
  const profiles = useCloud<Profile>('member_profiles');
  const { identity } = useSession();
  const { run, busy, error } = useTask();
  const query = useQueryClient();
  const [edit, setEdit] = useState<Meeting | true | null>(null);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Встречи клуба</h1>
        </div>
        {identity?.role === 'admin' && (
          <button className="primary" onClick={() => setEdit(true)}>
            <Plus size={18} /> Создать
          </button>
        )}
      </div>
      <CloudGate>
        <ErrorNote text={meetings.error?.message || error} />
        {meetings.isLoading ? (
          <Loading />
        ) : !meetings.data?.length ? (
          <Empty title="Встреч пока нет" />
        ) : (
          <div className="stack">
            {[...meetings.data]
              .sort((a, b) => b.starts_at.localeCompare(a.starts_at))
              .map((m) => {
                const response = attend.data?.find(
                  (a) => a.meeting_id === m.id && a.member_id === identity?.id,
                )?.response;
                return (
                  <article className={`meeting-card ${m.cancelled ? 'cancelled' : ''}`} key={m.id}>
                    <div className="meeting-date">
                      <CalendarDays size={24} />
                      <b>{new Date(m.starts_at).getDate()}</b>
                      <span>
                        {new Date(m.starts_at).toLocaleDateString('ru-RU', { month: 'short' })}
                      </span>
                    </div>
                    <div className="meeting-body">
                      <div className="section-title">
                        <h2>{m.title}</h2>
                        {identity?.role === 'admin' && (
                          <button
                            aria-label="Редактировать встречу"
                            className="icon"
                            onClick={() => setEdit(m)}
                          >
                            <Pencil size={17} />
                          </button>
                        )}
                      </div>
                      <p>
                        {dateLabel(m.starts_at)}
                        {m.cancelled && <span className="badge">Отменена</span>}
                      </p>
                      <p className="muted">
                        <MapPin size={15} /> {m.place || 'Место уточняется'}
                      </p>
                      <p className="prewrap">{m.description}</p>
                      <div className="chips">
                        {links.data
                          ?.filter((l) => l.meeting_id === m.id)
                          .map((l) => (
                            <span className="badge" key={l.book_id}>
                              {books.data?.find((b) => b.id === l.book_id)?.title}
                            </span>
                          ))}
                      </div>
                      <div className="rsvp">
                        {[
                          ['yes', 'Приду'],
                          ['no', 'Не смогу'],
                          ['maybe', 'Пока не знаю'],
                        ].map(([k, v]) => (
                          <button
                            key={k}
                            disabled={busy || m.cancelled || Date.parse(m.starts_at) < Date.now()}
                            className={response === k ? 'selected' : ''}
                            onClick={() =>
                              void run(async () => {
                                await action('attendance', { meeting_id: m.id, response: k });
                                await query.invalidateQueries({ queryKey: ['cloud'] });
                              }, 'Ответ сохранён')
                            }
                          >
                            {v}{' '}
                            <small>
                              {attend.data?.filter((a) => a.meeting_id === m.id && a.response === k)
                                .length || 0}
                            </small>
                          </button>
                        ))}
                      </div>
                      <details>
                        <summary>Ответы участников</summary>
                        {attend.data
                          ?.filter((a) => a.meeting_id === m.id)
                          .map((a) => (
                            <p key={a.member_id}>
                              {profiles.data?.find((p) => p.member_id === a.member_id)?.name ||
                                'Участник'}{' '}
                              —{' '}
                              {{ yes: 'Приду', no: 'Не смогу', maybe: 'Пока не знаю' }[a.response]}
                            </p>
                          ))}
                      </details>
                    </div>
                  </article>
                );
              })}
          </div>
        )}
      </CloudGate>
      {edit && (
        <MeetingEditor meeting={edit === true ? undefined : edit} onClose={() => setEdit(null)} />
      )}
    </>
  );
}
