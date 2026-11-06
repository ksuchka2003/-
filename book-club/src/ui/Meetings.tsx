import { useEffect, useState } from 'react';
import { meetingCountdown, meetingEnd } from '../collection';
import { MeetingDiscussion } from './MeetingDiscussion';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, MapPin, Pencil, ExternalLink } from 'lucide-react';
import {
  type Meeting,
  type ClubBook,
  type MeetingQuestion,
  type MeetingReflection,
  uid,
} from '../domain';
import { action } from '../cloud';
import { clubDateTime, clubInstant, type Attendance, type Participant } from '../calendar';
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
  useClock,
} from './shared';
export const meetingDateLabel = (date: string) =>
  new Date(date).toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }) + ' · МСК';
export function MeetingEditor({ meeting, onClose }: { meeting?: Meeting; onClose: () => void }) {
  const books = useCloud<ClubBook>('club_books');
  const links = useCloud<{ meeting_id: string; book_id: string }>('meeting_books');
  const [v, setV] = useState<Meeting>(
    meeting || {
      id: uid(),
      title: '',
      starts_at: '',
      place: '',
      description: '',
      cancelled: false,
      version: 1,
      duration_minutes: 120,
      venue_url: '',
    },
  );
  const [ids, setIds] = useState<string[] | null>(null);
  const selected =
    ids || links.data?.filter((l) => l.meeting_id === meeting?.id).map((l) => l.book_id) || [];
  const { run, busy, error } = useTask();
  const query = useQueryClient();
  return (
    <Modal title={meeting ? 'Редактировать встречу' : 'Предложить встречу'} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await run(async () => {
              await action('admin.meeting', { ...v, book_ids: selected });
              await query.invalidateQueries({ queryKey: ['cloud'] });
            }, 'Встреча сохранена')
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
        <Field label="Дата и время · МСК">
          <input
            type="datetime-local"
            required
            value={v.starts_at ? clubDateTime(v.starts_at) : ''}
            onChange={(e) =>
              setV({ ...v, starts_at: e.target.value ? clubInstant(e.target.value) : '' })
            }
          />
        </Field>
        <Field label="Место">
          <input
            maxLength={1000}
            value={v.place}
            onChange={(e) => setV({ ...v, place: e.target.value })}
            placeholder="Кафе, адрес или онлайн"
          />
        </Field>
        <Field label="Ссылка на место или созвон">
          <input
            type="url"
            pattern="https://.*"
            maxLength={2048}
            value={v.venue_url || ''}
            onChange={(e) => setV({ ...v, venue_url: e.target.value })}
            placeholder="https://…"
          />
        </Field>
        <Field label="Описание">
          <textarea
            rows={3}
            maxLength={10000}
            value={v.description}
            onChange={(e) => setV({ ...v, description: e.target.value })}
          />
        </Field>
        <details className="book-extra">
          <summary>Книги и продолжительность</summary>
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
          {books.data?.map((b) => (
            <label className="check" key={b.id}>
              <input
                type="checkbox"
                checked={selected.includes(b.id)}
                onChange={(e) =>
                  setIds(
                    e.target.checked ? [...selected, b.id] : selected.filter((id) => id !== b.id),
                  )
                }
              />
              {b.title}
            </label>
          ))}
        </details>
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
        <p>{meetingDateLabel(meeting.starts_at)}</p>
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
            placeholder="Пожелания или вопрос к организатору"
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
    : a.interested === false
      ? 'Не планирует участвовать'
      : { yes: 'Приду', no: 'Хочу, но не смогу', maybe: 'Пока не знаю' }[a.response];
export function MeetingCard({
  meeting: m,
  compact = false,
}: {
  meeting: Meeting;
  compact?: boolean;
}) {
  const clock = useClock();
  const attend = useCloud<Attendance>('meeting_attendance');
  const people = useCloud<Participant>('meeting_participants');
  const { identity } = useSession();
  const [respond, setRespond] = useState(false);
  const [edit, setEdit] = useState(false);
  const [discussion, setDiscussion] = useState<'questions' | 'reflections' | null>(null);
  const questions = useCloud<MeetingQuestion>('meeting_questions');
  const reflections = useCloud<MeetingReflection>('meeting_reflections');
  const answers = (attend.data || []).filter(
    (a) => a.meeting_id === m.id && a.schedule_version === (m.schedule_version || 1),
  );
  const mine = answers.find((a) => a.member_id === identity?.id);
  const old = attend.data?.find(
    (a) => a.meeting_id === m.id && a.member_id === identity?.id && !mine,
  );
  const upcoming = !m.cancelled && Date.parse(m.starts_at) > clock;
  return (
    <article className={`meeting-card ${m.cancelled ? 'cancelled' : ''}`}>
      <div className="meeting-body">
        <div className="section-title">
          <h2>{m.title}</h2>
          {identity?.role === 'admin' && (
            <button
              className="icon"
              aria-label="Редактировать встречу"
              onClick={() => setEdit(true)}
            >
              <Pencil size={17} />
            </button>
          )}
        </div>
        <p>
          {meetingDateLabel(m.starts_at)} {m.cancelled && <span className="badge">Отменена</span>}
        </p>
        <p className="countdown" aria-live="off">
          {meetingCountdown(m, clock)}
        </p>
        {m.place && (
          <p>
            <MapPin size={15} /> {m.place}
          </p>
        )}
        {m.venue_url && (
          <a className="place-link" href={m.venue_url} target="_blank" rel="noopener noreferrer">
            Открыть место или созвон <ExternalLink size={16} />
          </a>
        )}
        {m.description && (
          <p className={`prewrap ${compact ? 'clamp-description' : ''}`}>{m.description}</p>
        )}
        <ErrorNote text={attend.error?.message || people.error?.message} />
        {upcoming && (
          <>
            {attend.isLoading ? (
              <Loading />
            ) : (
              <>
                <p>
                  {old
                    ? 'Время изменилось — ответьте заново.'
                    : mine
                      ? `Ваш ответ: ${answerLabel(mine)}`
                      : 'Сможете прийти на встречу?'}
                </p>
                {mine?.comment && <p className="prewrap">{mine.comment}</p>}
                <button
                  className="primary"
                  disabled={!!attend.error}
                  onClick={() => setRespond(true)}
                >
                  {mine ? 'Изменить ответ' : 'Ответить на приглашение'}
                </button>
              </>
            )}
          </>
        )}
        {!compact && (
          <details className="calendar-details">
            <summary>
              Ответы · {answers.length}/{people.data?.length || 0}
            </summary>
            {people.data?.map((p) => {
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
        )}
        <div className="actions discussion-links">
          <button onClick={() => setDiscussion('questions')}>
            Вопросы к встрече
            {questions.data?.filter((q) => q.meeting_id === m.id).length
              ? ` · ${questions.data.filter((q) => q.meeting_id === m.id).length}`
              : ''}
          </button>
          <button onClick={() => setDiscussion('reflections')}>
            Итоги встречи
            {reflections.data?.filter((r) => r.meeting_id === m.id).length
              ? ` · ${reflections.data.filter((r) => r.meeting_id === m.id).length}`
              : ''}
          </button>
        </div>
        {compact && (
          <Link className="meeting-more" to="/meetings">
            Подробнее о встрече →
          </Link>
        )}
      </div>
      {discussion && (
        <MeetingDiscussion
          meeting={m}
          initialTab={discussion}
          onClose={() => setDiscussion(null)}
        />
      )}
      {respond && (
        <ResponseEditor
          meeting={m}
          answer={attend.data?.find((a) => a.meeting_id === m.id && a.member_id === identity?.id)}
          onClose={() => setRespond(false)}
        />
      )}
      {edit && <MeetingEditor meeting={m} onClose={() => setEdit(false)} />}
    </article>
  );
}
export function Meetings() {
  const clock = useClock();
  const meetings = useCloud<Meeting>('meetings');
  const { identity } = useSession();
  const [edit, setEdit] = useState(false);
  const [past, setPast] = useState(false);
  const listed = (meetings.data || [])
    .filter((m) =>
      past ? m.cancelled || meetingEnd(m) <= clock : !m.cancelled && meetingEnd(m) > clock,
    )
    .sort((a, b) =>
      past ? b.starts_at.localeCompare(a.starts_at) : a.starts_at.localeCompare(b.starts_at),
    );
  return (
    <>
      <div className="page-heading">
        <h1>Встречи клуба</h1>
        {identity?.role === 'admin' && (
          <button className="primary" onClick={() => setEdit(true)}>
            <Plus size={18} />
            Предложить встречу
          </button>
        )}
      </div>
      <CloudGate>
        <div className="tabs">
          <button className={!past ? 'active' : ''} onClick={() => setPast(false)}>
            Предстоящие
          </button>
          <button className={past ? 'active' : ''} onClick={() => setPast(true)}>
            Прошедшие и отменённые
          </button>
        </div>
        <ErrorNote text={meetings.error?.message} />
        {meetings.isLoading ? (
          <Loading />
        ) : (
          !meetings.error &&
          (!listed.length ? (
            <Empty title={past ? 'Прошедших встреч нет' : 'Предложенных встреч пока нет'} />
          ) : (
            <div className="stack">
              {listed.map((m) => (
                <MeetingCard key={m.id} meeting={m} />
              ))}
            </div>
          ))
        )}
      </CloudGate>
      {edit && <MeetingEditor onClose={() => setEdit(false)} />}
    </>
  );
}
