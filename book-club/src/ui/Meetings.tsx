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
import { clubDateTime, clubInstant } from '../calendar';
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
  confirmClose,
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
  const [initial] = useState(v);
  const [bookSearch, setBookSearch] = useState('');
  const selected =
    ids || links.data?.filter((l) => l.meeting_id === meeting?.id).map((l) => l.book_id) || [];
  const { run, busy, error } = useTask();
  const query = useQueryClient();
  const waitingForLinks = !!meeting && (links.isLoading || !links.data || !!links.error);
  const save = async (value: Meeting) => {
    if (waitingForLinks) return;
    if (
      await run(
        async () => {
          await action('admin.meeting', { ...value, book_ids: selected });
          await query.invalidateQueries({ queryKey: ['cloud'] });
        },
        value.cancelled ? 'Встреча отменена' : 'Встреча сохранена',
      )
    )
      onClose();
  };
  return (
    <Modal
      title={meeting ? 'Редактировать встречу' : 'Создать встречу'}
      onClose={() =>
        confirmClose(
          JSON.stringify(v) !== JSON.stringify(initial) ||
            (ids !== null &&
              JSON.stringify([...ids].sort()) !==
                JSON.stringify(
                  (links.data || [])
                    .filter((l) => l.meeting_id === meeting?.id)
                    .map((l) => l.book_id)
                    .sort(),
                )),
          onClose,
        )
      }
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          await save(v);
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
        <Field label="Описание">
          <textarea
            rows={3}
            maxLength={10000}
            value={v.description}
            onChange={(e) => setV({ ...v, description: e.target.value })}
          />
        </Field>
        <details className="book-extra">
          <summary>Ссылка, книги и длительность</summary>
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
          <Field label="Найти книгу встречи">
            <input
              value={bookSearch}
              onChange={(e) => setBookSearch(e.target.value)}
              placeholder="Название или автор"
            />
          </Field>
          <p className="section-hint">Выбрано книг: {selected.length}</p>
          <ErrorNote text={books.error?.message} />
          <div className="meeting-book-options">
            {books.data
              ?.filter((b) =>
                `${b.title} ${b.authors}`
                  .toLocaleLowerCase('ru')
                  .includes(bookSearch.trim().toLocaleLowerCase('ru')),
              )
              .sort(
                (a, b) =>
                  Number(selected.includes(b.id)) - Number(selected.includes(a.id)) ||
                  a.title.localeCompare(b.title, 'ru'),
              )
              .map((b) => (
                <label className="check" key={b.id}>
                  <input
                    type="checkbox"
                    checked={selected.includes(b.id)}
                    onChange={(e) =>
                      setIds(
                        e.target.checked
                          ? [...selected, b.id]
                          : selected.filter((id) => id !== b.id),
                      )
                    }
                  />
                  {b.title}
                </label>
              ))}
          </div>
        </details>
        <ErrorNote text={error || (meeting ? links.error?.message : '')} />
        <footer>
          <button className="primary" disabled={busy || waitingForLinks}>
            {meeting ? 'Сохранить встречу' : 'Создать встречу'}
          </button>
          {meeting && (
            <button
              type="button"
              className={v.cancelled ? '' : 'danger'}
              disabled={busy || waitingForLinks}
              onClick={() => {
                if (
                  !confirm(
                    v.cancelled
                      ? 'Возобновить встречу и уведомить участников?'
                      : 'Отменить встречу? Участники получат уведомление в боте.',
                  )
                )
                  return;
                void save({ ...v, cancelled: !v.cancelled });
              }}
            >
              {v.cancelled ? 'Возобновить встречу' : 'Отменить встречу'}
            </button>
          )}
        </footer>
      </form>
    </Modal>
  );
}
export function MeetingCard({
  meeting: m,
  compact = false,
}: {
  meeting: Meeting;
  compact?: boolean;
}) {
  const clock = useClock();
  const { identity } = useSession();
  const [edit, setEdit] = useState(false);
  const [discussion, setDiscussion] = useState<'questions' | 'reflections' | null>(null);
  const questions = useCloud<MeetingQuestion>('meeting_questions');
  const reflections = useCloud<MeetingReflection>('meeting_reflections');
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
            Создать встречу
          </button>
        )}
      </div>
      <CloudGate>
        <div className="segmented" role="group" aria-label="Список встреч">
          <button aria-pressed={!past} onClick={() => setPast(false)}>
            Предстоящие
          </button>
          <button aria-pressed={past} onClick={() => setPast(true)}>
            Прошедшие
          </button>
        </div>
        <ErrorNote text={meetings.error?.message} />
        {meetings.isLoading ? (
          <Loading />
        ) : (
          !meetings.error &&
          (!listed.length ? (
            <Empty title={past ? 'Прошедших встреч нет' : 'Предстоящих встреч пока нет'} />
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
