import { it, expect } from 'vitest';
import { meetingCountdown, personalCounts, clubCounts } from '../src/collection';
import { progressSchema } from '../src/domain';
const meeting = {
  id: 'm',
  title: 'Встреча',
  starts_at: '2030-01-04T12:00:00Z',
  duration_minutes: 120,
  version: 1,
  place: '',
  description: '',
  cancelled: false,
};
it('отсчёт встречи различает дни, минуты, начало, завершение и отмену', () => {
  expect(meetingCountdown(meeting, Date.parse('2030-01-02T09:00:00Z'))).toBe(
    'До встречи 2 дня 3 часа',
  );
  expect(meetingCountdown(meeting, Date.parse('2030-01-04T11:39:00Z'))).toBe(
    'До встречи 21 минута',
  );
  expect(meetingCountdown(meeting, Date.parse('2030-01-04T11:59:40Z'))).toBe(
    'Меньше минуты до встречи',
  );
  expect(meetingCountdown(meeting, Date.parse('2030-01-04T13:00:00Z'))).toBe('Встреча идёт');
  expect(meetingCountdown(meeting, Date.parse('2030-01-04T14:00:00Z'))).toBe('Встреча прошла');
  expect(meetingCountdown({ ...meeting, cancelled: true }, 0)).toBe('Встреча отменена');
});
it('счётчики не путают личное и клубное чтение, учитывают перечитывание и все статусы', () => {
  expect(
    personalCounts([
      { status: 'finished' },
      { status: 'reading' },
      { status: 'paused' },
      { status: 'planned' },
    ]),
  ).toEqual({ total: 4, finished: 1, unfinished: 3, reading: 1 });
  expect(
    clubCounts(
      [
        { id: 'a', status: 'reading' },
        { id: 'b', status: 'planned' },
        { id: 'c', status: 'archived' },
      ] as any,
      [{ book_id: 'a', status: 'finished' }] as any,
    ),
  ).toEqual({ total: 3, finished: 1, unfinished: 2 });
});
it('глава и даты совместимы со старым JSON, окончания до начала не допускаются', () => {
  const p = {
    bookId: '10000000-0000-4000-8000-000000000001',
    pages: 10,
    updatedAt: '2030-01-01T00:00:00Z',
  };
  expect(progressSchema.parse(p)).toEqual(p);
  expect(
    progressSchema.parse({
      ...p,
      chapter: 'Глава 2',
      startedOn: '2019-01-01',
      finishedOn: '2019-01-02',
    }).chapter,
  ).toBe('Глава 2');
  expect(() =>
    progressSchema.parse({ ...p, startedOn: '2019-01-03', finishedOn: '2019-01-02' }),
  ).toThrow();
});
