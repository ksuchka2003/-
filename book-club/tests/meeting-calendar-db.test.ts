// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
let db: PGlite;
const admin = '10000000-0000-4000-8000-000000000001',
  alice = '10000000-0000-4000-8000-000000000002';
const meeting = '20000000-0000-4000-8000-000000000001';
let day: string;
async function actor(id: string) {
  await db.exec(`reset role;set role authenticated;set request.jwt.claim.sub='${id}';`);
}
async function act(name: string, data: unknown) {
  return db.query('select public.club_action($1,$2::jsonb)', [name, JSON.stringify(data)]);
}
const invite = (extra = {}) => ({
  id: meeting,
  title: 'Книжный вечер',
  starts_at: day + 'T18:00:00+03:00',
  duration_minutes: 120,
  version: 1,
  ...extra,
});
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    "create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;alter default privileges in schema public grant all on tables to anon,authenticated;",
  );
  for (const file of [
    '202610250001_club.sql',
    '202610250002_private_library.sql',
    '202610310003_polls_and_invites.sql',
    '202610310004_meeting_calendar.sql',
  ])
    await db.exec(readFileSync('supabase/migrations/' + file, 'utf8'));
  for (const [id, tg, role] of [
    [admin, 1, 'admin'],
    [alice, 2, 'member'],
  ] as const) {
    await db.query('insert into auth.users values($1)', [id]);
    await db.query(
      'insert into public.club_members(id,auth_user_id,telegram_id,role) values($1,$1,$2,$3)',
      [id, tg, role],
    );
    await db.query("insert into public.member_profiles(member_id,name) values($1,'Имя')", [id]);
  }
  day = (
    await db.query<{ day: string }>(
      "select ((now() at time zone 'Europe/Moscow')::date+2)::text as day",
    )
  ).rows[0].day;
}, 30000);
afterAll(async () => {
  await db?.close();
});
describe.sequential('Календарь: серверные права и приглашения', () => {
  it('сохраняет только своё время, не позволяет прямую запись или обход RPC', async () => {
    await actor(alice);
    await act('availability', {
      member_id: admin,
      day,
      status: 'partial',
      busy_ranges: [[0, 720]],
      comment: 'Могу вечером',
    });
    const rows = (
      await db.query<{ member_id: string }>('select * from public.meeting_availability')
    ).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].member_id).toBe(alice);
    await expect(
      db.query("update public.meeting_availability set status='busy'"),
    ).rejects.toThrow();
    await expect(db.query("select public.club_action_v3('attendance','{}')")).rejects.toThrow();
    await expect(act('admin.meeting', invite())).rejects.toThrow('администратор');
  });
  it('проверяет интервалы, день и длину комментария', async () => {
    await actor(alice);
    for (const busy_ranges of [
      [[720, 600]],
      [
        [600, 800],
        [700, 900],
      ],
      [[-1, 900]],
      [[0, 1500]],
      [[0.5, 60]],
    ])
      await expect(act('availability', { day, status: 'partial', busy_ranges })).rejects.toThrow();
    await expect(act('availability', { day: '2001-01-01', status: 'free' })).rejects.toThrow(
      '12 месяцев',
    );
    await expect(
      act('availability', { day, status: 'free', comment: 'a'.repeat(1001) }),
    ).rejects.toThrow();
  });
  it('не раскрывает расписание посторонним и отключённым участникам', async () => {
    await db.exec('reset role;set role anon;');
    await expect(db.query('select * from public.meeting_availability')).rejects.toThrow();
    await actor('10000000-0000-4000-8000-000000000099');
    expect((await db.query('select * from public.meeting_availability')).rows).toHaveLength(0);
    expect((await db.query('select * from public.meeting_participants')).rows).toHaveLength(0);
    await expect(act('availability', { day, status: 'free' })).rejects.toThrow('доступа');
  });
  it('запрещает занятые часы, допускает вечер и создаёт приглашения всем', async () => {
    await actor(admin);
    await expect(
      act('admin.meeting', invite({ starts_at: day + 'T10:00:00+03:00' })),
    ).rejects.toThrow('занят');
    await act('admin.meeting', invite());
    expect(
      (await db.query("select * from public.notification_jobs where kind='new'")).rows,
    ).toHaveLength(2);
    await actor(alice);
    await act('attendance', {
      meeting_id: meeting,
      schedule_version: 1,
      response: 'no',
      interested: true,
      comment: 'Хочу, но могу только в 20:00',
    });
    await act('attendance', {
      meeting_id: meeting,
      schedule_version: 1,
      response: 'yes',
      interested: true,
      comment: 'Уже могу',
    });
    const rows = (await db.query<{ comment: string }>('select * from public.meeting_attendance'))
      .rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].comment).toBe('Уже могу');
  });
  it('перенос требует нового ответа, правка описания сохраняет согласие; не даёт двойную бронь', async () => {
    await actor(admin);
    await act('admin.meeting', invite({ description: 'Новое описание' }));
    let m = (
      await db.query<{ version: number; schedule_version: number }>('select * from public.meetings')
    ).rows[0];
    expect(m.schedule_version).toBe(1);
    await act('admin.meeting', invite({ version: m.version, starts_at: day + 'T20:00:00+03:00' }));
    m = (
      await db.query<{ version: number; schedule_version: number }>('select * from public.meetings')
    ).rows[0];
    expect(m.schedule_version).toBe(2);
    await expect(
      act(
        'admin.meeting',
        invite({ id: '20000000-0000-4000-8000-000000000002', starts_at: day + 'T21:00:00+03:00' }),
      ),
    ).rejects.toThrow('другой встречей');
    await actor(alice);
    await expect(
      act('attendance', { meeting_id: meeting, schedule_version: 1, response: 'yes' }),
    ).rejects.toThrow('изменилось');
    await act('attendance', {
      meeting_id: meeting,
      schedule_version: 2,
      response: 'maybe',
      comment: 'Уточню завтра',
    });
  });
  it('полная занятость закрывает день, отметки удалённого участника не блокируют клуб', async () => {
    await actor(alice);
    await act('availability', { day, status: 'busy' });
    await actor(admin);
    const value = invite({
      id: '20000000-0000-4000-8000-000000000003',
      starts_at: day + 'T12:00:00+03:00',
    });
    await expect(act('admin.meeting', value)).rejects.toThrow('занят');
    await act('admin.member', { id: alice, active: false });
    expect((await db.query('select * from public.meeting_availability')).rows).toHaveLength(0);
    expect((await db.query('select * from public.meeting_participants')).rows).toHaveLength(1);
    await act('admin.meeting', value);
    await act('admin.member', { id: alice, active: true });
  });
  it('отмена закрывает ответы и удаление отметки возвращает неизвестность', async () => {
    await actor(admin);
    const m = (
      await db.query<{ version: number }>('select * from public.meetings where id=$1', [meeting])
    ).rows[0];
    await act('admin.meeting', invite({ version: m.version, cancelled: true }));
    await actor(alice);
    await expect(
      act('attendance', { meeting_id: meeting, schedule_version: 2, response: 'yes' }),
    ).rejects.toThrow('отменена');
    await act('availability', { day, status: null });
    expect((await db.query('select * from public.meeting_availability')).rows).toHaveLength(0);
  });
});
