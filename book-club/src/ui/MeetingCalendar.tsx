import { useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { action } from '../cloud';
import type { Meeting } from '../domain';
import {
  clubDay,
  clock,
  commonTime,
  minutes,
  monthDays,
  type Availability,
  type Interval,
  type Participant,
} from '../calendar';
import { ErrorNote, Field, Modal, useSession, useTask } from './shared';
export const dayLabel = (day: string) =>
  new Date(day + 'T12:00:00Z').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
const stateLabels = { free: 'Свободны все', unknown: 'Ждём ответы', blocked: 'Занято' };
function AvailabilityEditor({
  day,
  rows,
  members,
  meetings,
  duration,
  onClose,
  onPropose,
}: {
  day: string;
  rows: Availability[];
  members: Participant[];
  meetings: Meeting[];
  duration: number;
  onClose: () => void;
  onPropose: (local: string) => void;
}) {
  const { identity } = useSession();
  const own = rows.find((a) => a.member_id === identity?.id && a.day === day);
  const [status, setStatus] = useState(own?.status || 'free');
  const [ranges, setRanges] = useState<Interval[]>(
    own?.busy_ranges.length ? own.busy_ranges : [[9 * 60, 12 * 60]],
  );
  const [comment, setComment] = useState(own?.comment || '');
  const { run, busy, error } = useTask();
  const query = useQueryClient();
  const common = commonTime(day, members, rows, meetings, duration);
  const [slot, setSlot] = useState(common.slots[0] ? clock(common.slots[0][0]) : '18:00');
  const allowed = common.slots.some(
    ([start, end]) => minutes(slot) >= start && minutes(slot) + duration <= end,
  );
  const past = day < clubDay();
  const save = async (reset = false) => {
    if (
      await run(
        async () => {
          const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
          if (
            !reset &&
            status === 'partial' &&
            sorted.some(([start, end], i) => start >= end || (i > 0 && start < sorted[i - 1][1]))
          )
            throw new Error(
              'Проверьте время: интервалы не должны пересекаться, окончание — позже начала',
            );
          await action('availability', {
            day,
            status: reset ? null : status,
            busy_ranges: status === 'partial' ? sorted : [],
            comment,
          });
          await query.invalidateQueries({ queryKey: ['cloud'] });
        },
        reset ? 'Отметка снята' : 'Ваше время сохранено',
      )
    )
      onClose();
  };
  return (
    <Modal title={dayLabel(day)} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {!past && (
          <>
            <Field label="Моя доступность">
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as Availability['status'])}
              >
                <option value="free">Свободен, готов собраться</option>
                <option value="partial">Занят часть дня</option>
                <option value="busy">Занят весь день</option>
              </select>
            </Field>
            {status === 'partial' && (
              <fieldset>
                <legend>Когда я занят · МСК</legend>
                <div className="chips">
                  {[
                    ['Утром', 0, 720],
                    ['Днём', 720, 1080],
                    ['Вечером', 1080, 1440],
                  ].map(([title, start, end]) => (
                    <button
                      key={title}
                      type="button"
                      onClick={() => setRanges([[Number(start), Number(end)]])}
                    >
                      {title}
                    </button>
                  ))}
                </div>
                {ranges.map(([start, end], i) => (
                  <div className="busy-range" key={i}>
                    <Field label={`Занят с ${i + 1}`}>
                      <select
                        value={start}
                        onChange={(e) =>
                          setRanges(
                            ranges.map((r, j) => (j === i ? [Number(e.target.value), r[1]] : r)),
                          )
                        }
                      >
                        {Array.from({ length: 48 }, (_, k) => (
                          <option value={k * 30} key={k}>
                            {clock(k * 30)}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label={`Занят до ${i + 1}`}>
                      <select
                        value={end}
                        onChange={(e) =>
                          setRanges(
                            ranges.map((r, j) => (j === i ? [r[0], Number(e.target.value)] : r)),
                          )
                        }
                      >
                        {Array.from({ length: 48 }, (_, k) => (
                          <option value={(k + 1) * 30} key={k}>
                            {clock((k + 1) * 30)}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <button
                      type="button"
                      className="icon"
                      disabled={ranges.length === 1}
                      aria-label={`Удалить интервал ${i + 1}`}
                      onClick={() => setRanges(ranges.filter((_, j) => j !== i))}
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  disabled={ranges.length >= 12}
                  onClick={() => setRanges([...ranges, [18 * 60, 20 * 60]])}
                >
                  <Plus size={16} /> Ещё интервал
                </button>
                <p className="muted">В остальное время вы готовы собраться.</p>
              </fieldset>
            )}
            <Field label="Комментарий к дню">
              <textarea
                rows={2}
                maxLength={1000}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Например: могу после работы, лучше онлайн"
              />
            </Field>
            <ErrorNote text={error} />
            <div className="actions">
              <button className="primary" disabled={busy}>
                Сохранить моё время
              </button>
              {own && (
                <button type="button" disabled={busy} onClick={() => void save(true)}>
                  Снять отметку
                </button>
              )}
            </div>
          </>
        )}
        <div className="calendar-details">
          <h3>{stateLabels[common.state]}</h3>
          {common.slots.length > 0 && (
            <p>
              {common.missing ? 'Пока подходят интервалы: ' : 'Общее свободное время: '}
              {common.slots.map(([s, e]) => `${clock(s)}–${clock(e)}`).join(', ')} · МСК
            </p>
          )}
          {common.missing > 0 && (
            <p className="muted">Не ответили: {common.missing}. Это ещё не согласованное время.</p>
          )}
          {members.map((m) => {
            const a = rows.find((r) => r.day === day && r.member_id === m.member_id);
            return (
              <div className="availability-person" key={m.member_id}>
                <b>{m.name}</b>
                <span>
                  {!a
                    ? 'Нет ответа'
                    : a.status === 'free'
                      ? 'Свободен'
                      : a.status === 'busy'
                        ? 'Занят весь день'
                        : `Занят ${a.busy_ranges.map(([s, e]) => `${clock(s)}–${clock(e)}`).join(', ')}`}
                </span>
                {a?.comment && <p className="prewrap">{a.comment}</p>}
              </div>
            );
          })}
        </div>
        {identity?.role === 'admin' && !past && common.slots.length > 0 && (
          <fieldset>
            <legend>Предложить встречу · {duration} мин</legend>
            <Field label="Начало встречи (МСК)">
              <input
                type="time"
                step="1800"
                value={slot}
                onChange={(e) => setSlot(e.target.value)}
              />
            </Field>
            <button type="button" disabled={!allowed} onClick={() => onPropose(day + 'T' + slot)}>
              Предложить это время
            </button>
          </fieldset>
        )}
      </form>
    </Modal>
  );
}
export function MeetingCalendar({
  rows,
  members,
  meetings,
  onPropose,
}: {
  rows: Availability[];
  members: Participant[];
  meetings: Meeting[];
  onPropose: (local: string, duration: number) => void;
}) {
  const today = clubDay();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [day, setDay] = useState<string | null>(null);
  const [duration, setDuration] = useState(120);
  const move = (delta: number) => {
    const d = new Date(month + '-01T12:00:00Z');
    d.setUTCMonth(d.getUTCMonth() + delta);
    setMonth(d.toISOString().slice(0, 7));
  };
  return (
    <section className="meeting-calendar" aria-label="Календарь встреч">
      <div className="calendar-heading">
        <button
          className="icon"
          aria-label="Предыдущий месяц"
          disabled={month <= today.slice(0, 7)}
          onClick={() => move(-1)}
        >
          <ChevronLeft />
        </button>
        <h2 aria-live="polite">
          {new Date(month + '-01T12:00:00Z').toLocaleDateString('ru-RU', {
            month: 'long',
            year: 'numeric',
          })}
        </h2>
        <button
          className="icon"
          aria-label="Следующий месяц"
          disabled={month >= String(Number(today.slice(0, 4)) + 1) + today.slice(4, 7)}
          onClick={() => move(1)}
        >
          <ChevronRight />
        </button>
      </div>
      <div className="calendar-toolbar">
        <p>Отметьте дни, когда готовы собраться.</p>
        <Field label="Время на встречу">
          <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
            {[60, 90, 120, 180, 240].map((m) => (
              <option key={m} value={m}>
                {m} мин
              </option>
            ))}
          </select>
        </Field>
      </div>
      <p className="muted calendar-caption">
        Общие варианты: 09:00–23:00 МСК. Занятость одного участника закрывает только его занятые
        часы.
      </p>
      <div className="calendar-grid">
        <div className="calendar-week" aria-hidden="true">
          {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>
        <div className="calendar-days">
          {monthDays(month).map((date, i) => {
            if (!date) return <span key={'empty' + i} />;
            const info = commonTime(date, members, rows, meetings, duration);
            const hasMeeting = meetings.some(
              (m) => !m.cancelled && clubDay(new Date(m.starts_at)) === date,
            );
            return (
              <button
                key={date}
                disabled={date < today || date > clubDay(new Date(Date.now() + 366 * 86400000))}
                aria-label={`${dayLabel(date)}: ${stateLabels[info.state]}`}
                className={`calendar-day ${info.state} ${date === today ? 'today' : ''}`}
                onClick={() => setDay(date)}
              >
                <b>{Number(date.slice(-2))}</b>
                <small>
                  {info.state === 'blocked'
                    ? 'Занято'
                    : info.state === 'free'
                      ? 'Все'
                      : `${info.answered}/${members.length}`}
                </small>
                {hasMeeting && <span className="meeting-dot" aria-label="Есть встреча" />}
              </button>
            );
          })}
        </div>
      </div>
      <div className="calendar-legend">
        <span className="free">Свободны все</span>
        <span className="unknown">Ждём ответы</span>
        <span className="blocked">Занято</span>
      </div>
      {day && (
        <AvailabilityEditor
          key={day}
          day={day}
          rows={rows}
          members={members}
          meetings={meetings}
          duration={duration}
          onClose={() => setDay(null)}
          onPropose={(local) => {
            setDay(null);
            onPropose(local, duration);
          }}
        />
      )}
    </section>
  );
}
