import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, MapPin, Pencil } from 'lucide-react';
import { type Meeting, type ClubBook, uid } from '../domain';
import { action } from '../cloud';
import {
  clubDay,
  clubDateTime,
  clubInstant,
  commonTime,
  type Attendance,
  type Availability,
  type Participant,
} from '../calendar';
import { MeetingCalendar } from './MeetingCalendar';
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
} from './shared';

export function MeetingEditor({
  meeting,
  initialDate = '',
  duration = 120,
  onClose,
}: {
  meeting?: Meeting;
  initialDate?: string;
  duration?: number;
  onClose: () => void;
}) {
  const books = useCloud<ClubBook>('club_books');
  const links = useCloud<{ meeting_id: string; book_id: string }>('meeting_books');
  const availability = useCloud<Availability>('meeting_availability');
  const participants = useCloud<Participant>('meeting_participants');
  const meetings = useCloud<Meeting>('meetings');
  const [v, setV] = useState(
    meeting || {
      id: uid(),
      title: '',
      starts_at: initialDate ? clubInstant(initialDate) : '',
      place: '',
      description: '',
      cancelled: false,
      version: 1,
      duration_minutes: duration,
    },
  );
  const [ids, setIds] = useState<string[] | null>(null);
  const selected =
    ids || links.data?.filter((l) => l.meeting_id === meeting?.id).map((l) => l.book_id) || [];
  const { run, busy, error } = useTask();
  const query = useQueryClient();
  const localDate = v.starts_at ? clubDateTime(v.starts_at) : '';
  const common = localDate
    ? commonTime(
        localDate.slice(0, 10),
        participants.data || [],
        availability.data || [],
        meetings.data || [],
        v.duration_minutes || 120,
        v.id,
      )
    : null;
  return (
    <Modal title={meeting ? 'Редактировать встречу' : 'Предложить встречу'} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await run(async () => {
              await action('admin.meeting', { ...v, book_ids: selected });
              await query.invalidateQueries({ queryKey: ['cloud'] });
            }, 'Встреча предложена участникам')
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
        <div className="form-grid">
          <Field label="Дата и время · МСК">
            <input
              type="datetime-local"
              required
              value={localDate}
              onChange={(e) =>
                setV({ ...v, starts_at: e.target.value ? clubInstant(e.target.value) : '' })
              }
            />
          </Field>
          <Field label="Продолжительность, минут">
            <input
              type="number"
              min={30}
              max={720}
              step={30}
              required
              value={v.duration_minutes || 120}
              onChange={(e) => setV({ ...v, duration_minutes: Number(e.target.value) })}
            />
          </Field>
        </div>
        {!!common?.missing && (
          <p className="muted">
            Пока не ответили: {common.missing}. Участники смогут ответить на приглашение.
          </p>
        )}
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
            rows={3}
            value={v.description}
            onChange={(e) => setV({ ...v, description: e.target.value })}
          />
        </Field>
        {!!books.data?.length && (
          <fieldset>
            <legend>Обсуждаем книги</legend>
            {books.data.map((b) => (
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
        )}
        {meeting && (
          <label className="check">
            <input
              type="checkbox"
              checked={v.cancelled}
              onChange={(e) => setV({ ...v, cancelled: e.target.checked })}
            />
            Встреча отменена
          </label>
        )}
        <ErrorNote text={error} />
        <button className="primary" disabled={busy}>
          {meeting ? 'Сохранить встречу' : 'Предложить участникам'}
        </button>
      </form>
    </Modal>
  );
}
function ResponseEditor({
  meeting,
  answer,
  onClose,
}: {
  meeting: Meeting;
  answer?: Attendance;
  onClose: () => void;
}) {
  const [choice, setChoice] = useState(
    answer?.interested === false ? 'decline' : answer?.response || 'maybe',
  );
  const [comment, setComment] = useState(answer?.comment || '');
  const { run, busy, error } = useTask();
  const query = useQueryClient();
  return (
    <Modal title="Ответ на приглашение" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await run(async () => {
              await action('attendance', {
                meeting_id: meeting.id,
                schedule_version: meeting.schedule_version || 1,
                response: choice === 'decline' ? 'no' : choice,
                interested: choice !== 'decline',
                comment,
              });
              await query.invalidateQueries({ queryKey: ['cloud'] });
            }, 'Ответ сохранён')
          )
            onClose();
        }}
      >
        <h3>{meeting.title}</h3>
        <p>
          {new Date(meeting.starts_at).toLocaleString('ru-RU', {
            timeZone: 'Europe/Moscow',
            day: 'numeric',
            month: 'long',
            hour: '2-digit',
            minute: '2-digit',
          })}{' '}
          · МСК
        </p>
        <Field label="Сможете прийти?">
          <select value={choice} onChange={(e) => setChoice(e.target.value)}>
            <option value="yes">Приду</option>
            <option value="no">Хочу, но не смогу</option>
            <option value="maybe">Пока не знаю</option>
            <option value="decline">Не планирую участвовать</option>
          </select>
        </Field>
        <Field label="Комментарий к встрече">
          <textarea
            rows={3}
            maxLength={2000}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Когда удобно, хочется ли встретиться, что обсудить"
          />
        </Field>
        <ErrorNote text={error} />
        <button className="primary" disabled={busy}>
          Сохранить ответ
        </button>
      </form>
    </Modal>
  );
}
const answerLabel = (a?: Attendance) =>
  !a
    ? 'Нет ответа'
    : !a.interested
      ? 'Не планирует участвовать'
      : { yes: 'Приду', no: 'Хочу, но не смогу', maybe: 'Пока не знаю' }[a.response];
export function Meetings() {
  const meetings = useCloud<Meeting>('meetings');
  const books = useCloud<ClubBook>('club_books');
  const links = useCloud<{ meeting_id: string; book_id: string }>('meeting_books');
  const attend = useCloud<Attendance>('meeting_attendance');
  const availability = useCloud<Availability>('meeting_availability');
  const participants = useCloud<Participant>('meeting_participants');
  const { identity } = useSession();
  const [edit, setEdit] = useState<{
    meeting?: Meeting;
    initialDate?: string;
    duration?: number;
  } | null>(null);
  const [respond, setRespond] = useState<Meeting | null>(null);
  const [tab, setTab] = useState<'calendar' | 'meetings'>('calendar');
  const [past, setPast] = useState(false);
  const all = meetings.data || [];
  const upcoming = all.filter((m) => !m.cancelled && Date.parse(m.starts_at) > Date.now());
  const unanswered = upcoming.filter(
    (m) =>
      !attend.data?.some(
        (a) =>
          a.meeting_id === m.id &&
          a.member_id === identity?.id &&
          a.schedule_version === (m.schedule_version || 1),
      ),
  );
  const listed = all
    .filter((m) =>
      past
        ? m.cancelled || Date.parse(m.starts_at) <= Date.now()
        : !m.cancelled && Date.parse(m.starts_at) > Date.now(),
    )
    .sort((a, b) =>
      past ? b.starts_at.localeCompare(a.starts_at) : a.starts_at.localeCompare(b.starts_at),
    );
  const loading =
    meetings.isLoading || availability.isLoading || participants.isLoading || attend.isLoading;
  const error =
    meetings.error?.message ||
    availability.error?.message ||
    participants.error?.message ||
    attend.error?.message;
  return (
    <>
      <div className="page-heading">
        <h1>Встречи клуба</h1>
        {identity?.role === 'admin' && (
          <button className="primary" onClick={() => setEdit({})}>
            <Plus size={18} /> Предложить
          </button>
        )}
      </div>
      <CloudGate>
        <div className="tabs">
          <button className={tab === 'calendar' ? 'active' : ''} onClick={() => setTab('calendar')}>
            Календарь
          </button>
          <button className={tab === 'meetings' ? 'active' : ''} onClick={() => setTab('meetings')}>
            Встречи{unanswered.length > 0 ? ` · ${unanswered.length} ждут ответа` : ''}
          </button>
        </div>
        <ErrorNote text={error} />
        {loading ? (
          <Loading />
        ) : error ? null : (
          <>
            {tab === 'calendar' ? (
              <>
                {unanswered.length > 0 && (
                  <div className="invitation-prompt">
                    <p>
                      Сможете прийти?{' '}
                      {unanswered.length === 1
                        ? unanswered[0].title
                        : `Приглашений без ответа: ${unanswered.length}`}
                    </p>
                    <button onClick={() => setRespond(unanswered[0])}>Ответить</button>
                  </div>
                )}
                <MeetingCalendar
                  rows={availability.data || []}
                  members={participants.data || []}
                  meetings={all}
                  onPropose={(initialDate, duration) => setEdit({ initialDate, duration })}
                />
              </>
            ) : (
              <>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={past}
                    onChange={(e) => setPast(e.target.checked)}
                  />
                  Прошедшие и отменённые
                </label>
                {!listed.length ? (
                  <Empty title={past ? 'Прошедших встреч нет' : 'Предложенных встреч пока нет'} />
                ) : (
                  <div className="stack">
                    {listed.map((m) => {
                      const answers = (attend.data || []).filter(
                        (a) =>
                          a.meeting_id === m.id && a.schedule_version === (m.schedule_version || 1),
                      );
                      const mine = answers.find((a) => a.member_id === identity?.id);
                      const old = (attend.data || []).find(
                        (a) => a.meeting_id === m.id && a.member_id === identity?.id && !mine,
                      );
                      const info = commonTime(
                        clubDay(new Date(m.starts_at)),
                        participants.data || [],
                        availability.data || [],
                        [],
                        m.duration_minutes || 120,
                      );
                      const start =
                        Number(clubDateTime(m.starts_at).slice(11, 13)) * 60 +
                        Number(clubDateTime(m.starts_at).slice(14, 16));
                      const conflict = !info.slots.some(
                        ([from, to]) => start >= from && start + (m.duration_minutes || 120) <= to,
                      );
                      return (
                        <article
                          className={`meeting-card ${m.cancelled ? 'cancelled' : ''}`}
                          key={m.id}
                        >
                          <div className="meeting-body">
                            <div className="section-title">
                              <h2>{m.title}</h2>
                              {identity?.role === 'admin' && (
                                <button
                                  className="icon"
                                  aria-label="Редактировать встречу"
                                  onClick={() => setEdit({ meeting: m })}
                                >
                                  <Pencil size={17} />
                                </button>
                              )}
                            </div>
                            <p>
                              {new Date(m.starts_at).toLocaleString('ru-RU', {
                                timeZone: 'Europe/Moscow',
                                day: 'numeric',
                                month: 'long',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}{' '}
                              · МСК · {m.duration_minutes || 120} мин{' '}
                              {m.cancelled && <span className="badge">Отменена</span>}
                            </p>
                            {!!m.place && (
                              <p>
                                <MapPin size={15} /> {m.place}
                              </p>
                            )}
                            {!!m.description && <p className="prewrap">{m.description}</p>}
                            <div className="chips">
                              {links.data
                                ?.filter((l) => l.meeting_id === m.id)
                                .map((l) => (
                                  <Link className="badge" key={l.book_id} to={'/club/' + l.book_id}>
                                    {books.data?.find((b) => b.id === l.book_id)?.title || 'Книга'}
                                  </Link>
                                ))}
                            </div>
                            {!past && (
                              <>
                                <p>
                                  {old
                                    ? 'Время изменилось — ответьте заново.'
                                    : mine
                                      ? `Ваш ответ: ${answerLabel(mine)}`
                                      : 'Сможете прийти на встречу?'}
                                </p>
                                {mine?.comment && <p className="prewrap">{mine.comment}</p>}
                                <button className="primary" onClick={() => setRespond(m)}>
                                  {mine ? 'Изменить ответ' : 'Ответить на приглашение'}
                                </button>
                                {conflict && (
                                  <p className="muted">
                                    В календаре появилась занятость. Проверьте общее время.
                                  </p>
                                )}
                              </>
                            )}
                            <details className="calendar-details">
                              <summary>
                                Ответы · {answers.length}/{participants.data?.length || 0}
                              </summary>
                              {participants.data?.map((p) => {
                                const a = answers.find((a) => a.member_id === p.member_id);
                                return (
                                  <div className="availability-person" key={p.member_id}>
                                    <b>{p.name}</b>
                                    <span>{answerLabel(a)}</span>
                                    {a?.comment && <p className="prewrap">{a.comment}</p>}
                                  </div>
                                );
                              })}
                            </details>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </CloudGate>
      {edit && <MeetingEditor {...edit} onClose={() => setEdit(null)} />}
      {respond && (
        <ResponseEditor
          key={respond.id}
          meeting={respond}
          answer={attend.data?.find(
            (a) => a.meeting_id === respond.id && a.member_id === identity?.id,
          )}
          onClose={() => setRespond(null)}
        />
      )}
    </>
  );
}
