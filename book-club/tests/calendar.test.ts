import { describe, expect, it } from 'vitest';
import {
  clubDateTime,
  clubDay,
  clubInstant,
  commonTime,
  monthDays,
  type Availability,
} from '../src/calendar';
const members = [
  { member_id: 'a', name: 'Аня' },
  { member_id: 'b', name: 'Борис' },
];
const day = '2030-04-10';
const free = (member_id: string): Availability => ({
  member_id,
  day,
  status: 'free',
  busy_ranges: [],
  comment: '',
});
describe('Общее время клуба', () => {
  it('не считает молчание согласием', () => {
    const result = commonTime(day, members, [free('a')], []);
    expect(result.state).toBe('unknown');
    expect(result.missing).toBe(1);
    expect(commonTime(day, [], [], []).state).toBe('unknown');
  });
  it('полностью занятый участник закрывает день для всех', () => {
    expect(commonTime(day, members, [free('a'), { ...free('b'), status: 'busy' }], []).state).toBe(
      'blocked',
    );
  });
  it('утренняя занятость сохраняет вечер, несколько интервалов пересекаются', () => {
    const result = commonTime(
      day,
      members,
      [
        {
          ...free('a'),
          status: 'partial',
          busy_ranges: [
            [0, 720],
            [1080, 1200],
          ],
        },
        { ...free('b'), status: 'partial', busy_ranges: [[900, 1080]] },
      ],
      [],
    );
    expect(result.state).toBe('free');
    expect(result.slots).toEqual([
      [720, 900],
      [1200, 1380],
    ]);
    expect(
      commonTime(
        day,
        members,
        [
          {
            ...free('a'),
            status: 'partial',
            busy_ranges: [
              [0, 720],
              [1080, 1200],
            ],
          },
          { ...free('b'), status: 'partial', busy_ranges: [[900, 1080]] },
        ],
        [],
        240,
      ).state,
    ).toBe('blocked');
  });
  it('не резервирует отменённые встречи и учитывает пересечение полуночи', () => {
    const m = {
      id: 'm',
      title: 'Встреча',
      starts_at: '2030-04-09T22:00:00Z',
      place: '',
      description: '',
      cancelled: false,
      version: 1,
      duration_minutes: 600,
    };
    expect(
      commonTime(
        day,
        members,
        members.map((m) => free(m.member_id)),
        [m],
      ).slots,
    ).toEqual([[660, 1380]]);
    expect(
      commonTime(
        day,
        members,
        members.map((m) => free(m.member_id)),
        [{ ...m, cancelled: true }],
      ).slots,
    ).toEqual([[540, 1380]]);
  });
  it('постоянно использует московское время независимо от устройства', () => {
    expect(clubInstant('2030-04-10T18:30')).toBe('2030-04-10T15:30:00.000Z');
    expect(clubDateTime('2030-04-10T15:30:00Z')).toBe('2030-04-10T18:30');
    expect(clubDay(new Date('2030-04-09T22:00:00Z'))).toBe(day);
  });
  it('строит календарь с понедельника и високосным февралем', () => {
    expect(monthDays('2028-02').filter(Boolean)).toHaveLength(29);
    expect(monthDays('2030-04')[0]).toBe('2030-04-01');
  });
});
