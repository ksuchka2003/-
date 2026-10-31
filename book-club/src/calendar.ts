import type { Meeting } from './domain';
export type Interval = [number, number];
export type Availability = {
  member_id: string;
  day: string;
  status: 'free' | 'partial' | 'busy';
  busy_ranges: Interval[];
  comment: string;
};
export type Participant = { member_id: string; name: string };
export type Attendance = {
  meeting_id: string;
  member_id: string;
  response: 'yes' | 'no' | 'maybe';
  interested: boolean;
  comment: string;
  schedule_version: number;
};
export const clubDay = (date = new Date()) =>
  new Date(date.getTime() + 3 * 3600000).toISOString().slice(0, 10);
export const clubDateTime = (iso: string) =>
  new Date(Date.parse(iso) + 3 * 3600000).toISOString().slice(0, 16);
export const clubInstant = (local: string) => new Date(local + ':00+03:00').toISOString();
export const clock = (minute: number) =>
  `${Math.floor(minute / 60)
    .toString()
    .padStart(2, '0')}:${(minute % 60).toString().padStart(2, '0')}`;
export const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
export function subtract(windows: Interval[], busy: Interval): Interval[] {
  return windows.flatMap(([start, end]) =>
    busy[0] >= end || busy[1] <= start
      ? [[start, end] as Interval]
      : [
          ...(busy[0] > start ? [[start, busy[0]] as Interval] : []),
          ...(busy[1] < end ? [[busy[1], end] as Interval] : []),
        ],
  );
}
export function commonTime(
  day: string,
  members: Participant[],
  rows: Availability[],
  meetings: Meeting[],
  duration = 120,
  exclude?: string,
) {
  const answers = members.flatMap(
    (m) => rows.find((r) => r.member_id === m.member_id && r.day === day) || [],
  );
  let windows: Interval[] = [[9 * 60, 23 * 60]];
  for (const a of answers) {
    if (a.status === 'busy') windows = [];
    for (const range of a.busy_ranges) windows = subtract(windows, range);
  }
  for (const m of meetings.filter((m) => !m.cancelled && m.id !== exclude)) {
    const start = (Date.parse(m.starts_at) - Date.parse(day + 'T00:00:00+03:00')) / 60000;
    windows = subtract(windows, [start, start + (m.duration_minutes || 120)]);
  }
  const slots = windows.filter(([start, end]) => end - start >= duration);
  const missing = members.length - answers.length;
  return {
    slots,
    missing,
    answered: answers.length,
    state: !slots.length ? 'blocked' : !members.length || missing ? 'unknown' : 'free',
  } as const;
}
export function monthDays(month: string) {
  const [year, number] = month.split('-').map(Number);
  const offset = (new Date(Date.UTC(year, number - 1, 1)).getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(year, number, 0)).getUTCDate();
  return [
    ...Array(offset).fill(null),
    ...Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`),
  ] as (string | null)[];
}
