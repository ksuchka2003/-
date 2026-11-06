// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, it, expect, describe } from 'vitest';
let db: PGlite;
const admin = '10000000-0000-4000-8000-000000000001',
  alice = '10000000-0000-4000-8000-000000000002',
  bob = '10000000-0000-4000-8000-000000000003';
const book = '20000000-0000-4000-8000-000000000001',
  personal = '30000000-0000-4000-8000-000000000001',
  future = '40000000-0000-4000-8000-000000000001',
  past = '40000000-0000-4000-8000-000000000002',
  cancelled = '40000000-0000-4000-8000-000000000003',
  question = '50000000-0000-4000-8000-000000000001',
  reflection = '60000000-0000-4000-8000-000000000001',
  quote = '70000000-0000-4000-8000-000000000001';
async function actor(id: string) {
  await db.exec(`reset role;set role authenticated;set request.jwt.claim.sub='${id}';`);
}
async function act(name: string, data: unknown) {
  return db.query('select public.club_action($1,$2::jsonb)', [name, JSON.stringify(data)]);
}
async function share(kind: string, id: string, payload: unknown, version: number) {
  return db.query('select public.sync_public($1,$2,$3::jsonb,$4)', [
    kind,
    id,
    payload === null ? null : JSON.stringify(payload),
    version,
  ]);
}
async function sync(kind: string, payload: unknown) {
  const old = (
    await db.query<any>(
      'select revision from public.private_library_records where kind=$1 and entity_id=$2',
      [kind, personal],
    )
  ).rows[0];
  return db.query('select public.sync_private_library($1::jsonb,$2)', [
    JSON.stringify([
      { kind, entity_id: personal, payload, base_revision: Number(old?.revision || 0) },
    ]),
    '80000000-0000-4000-8000-000000000001',
  ]);
}
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
    '202611060005_simple_club.sql',
    '202611060006_club_memory.sql',
  ])
    await db.exec(readFileSync('supabase/migrations/' + file, 'utf8'));
  for (const [id, tg, role] of [
    [admin, 1, 'admin'],
    [alice, 2, 'member'],
    [bob, 3, 'member'],
  ] as const) {
    await db.query('insert into auth.users values($1)', [id]);
    await db.query(
      'insert into public.club_members(id,auth_user_id,telegram_id,role) values($1,$1,$2,$3)',
      [id, tg, role],
    );
    await db.query("insert into public.member_profiles(member_id,name) values($1,'Имя')", [id]);
    await db.query('insert into public.member_privacy_settings(member_id) values($1)', [id]);
  }
  await db.query(
    "insert into public.club_books(id,title,authors,default_pages,status) values($1,'Книга','Автор',300,'finished')",
    [book],
  );
  await db.query(
    "insert into public.meetings(id,title,starts_at,cancelled) values($1,'Будущая',now()+interval '3 days',false),($2,'Прошедшая',now()-interval '3 days',false),($3,'Отменённая',now()+interval '3 days',true)",
    [future, past, cancelled],
  );
}, 30000);
afterAll(async () => {
  await db?.close();
});
describe.sequential('Память клуба, вопросы и итоги', () => {
  it('вопросы доступны клубу, изменять можно только свои и нельзя подменить автора', async () => {
    await actor(alice);
    await act('meeting.question', {
      id: question,
      meeting_id: future,
      member_id: admin,
      text: 'Как вы поняли финал?',
      version: 1,
    });
    let rows = (await db.query<any>('select * from public.meeting_questions')).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].member_id).toBe(alice);
    await act('meeting.question', {
      id: question,
      meeting_id: future,
      text: 'Что означает финал?',
      version: 1,
    });
    expect((await db.query<any>('select * from public.meeting_questions')).rows[0].version).toBe(2);
    await expect(
      act('meeting.question', {
        id: question,
        meeting_id: future,
        text: 'Старая правка',
        version: 1,
      }),
    ).rejects.toThrow('уже изменён');
    await actor(bob);
    await expect(
      act('meeting.question', { id: question, meeting_id: future, text: 'Подмена', version: 2 }),
    ).rejects.toThrow('свой');
    await expect(act('meeting.question.delete', { id: question })).rejects.toThrow('свой');
    await expect(
      db.query("update public.meeting_questions set text='В обход RPC'"),
    ).rejects.toThrow();
  });
  it('только администратор отмечает обсуждённое; сбор вопросов закрывается после встречи/отмены', async () => {
    await actor(alice);
    await expect(
      act('meeting.question.answered', { id: question, version: 2, answered: true }),
    ).rejects.toThrow('администратор');
    for (const meeting_id of [past, cancelled])
      await expect(
        act('meeting.question', { id: reflection, meeting_id, text: 'Поздно', version: 1 }),
      ).rejects.toThrow('завершён');
    await expect(
      act('meeting.question', { id: reflection, meeting_id: future, text: '   ', version: 1 }),
    ).rejects.toThrow();
    await expect(
      act('meeting.question', {
        id: reflection,
        meeting_id: future,
        text: 'x'.repeat(2001),
        version: 1,
      }),
    ).rejects.toThrow();
    await actor(admin);
    await act('meeting.question.answered', { id: question, version: 2, answered: true });
    expect((await db.query<any>('select * from public.meeting_questions')).rows[0].answered).toBe(
      true,
    );
  });
  it('итоги сохраняются только после встречи, одна запись на участника, без подмены и потери новой версии', async () => {
    await actor(alice);
    await expect(
      act('meeting.reflection', { id: reflection, meeting_id: future, impression: 'Рано' }),
    ).rejects.toThrow('после окончания');
    await act('meeting.reflection', {
      id: reflection,
      meeting_id: past,
      favorite_thought: 'Память ненадёжна',
      debate: 'Спорили о герое',
      impression: 'Хочу перечитать',
      member_id: admin,
    });
    await act('meeting.reflection', {
      id: reflection,
      meeting_id: past,
      version: 1,
      favorite_thought: 'Мысль',
      debate: 'Спор',
      impression: 'Новое впечатление',
    });
    await expect(
      act('meeting.reflection', {
        id: reflection,
        meeting_id: past,
        version: 1,
        impression: 'Старое',
      }),
    ).rejects.toThrow('уже изменены');
    await actor(bob);
    await expect(
      act('meeting.reflection', { id: reflection, meeting_id: past, impression: 'Подмена' }),
    ).rejects.toThrow('Чужие');
    await expect(act('meeting.reflection.delete', { id: reflection })).rejects.toThrow('свои');
    const rows = (await db.query<any>('select * from public.meeting_reflections')).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      member_id: alice,
      version: 2,
      impression: 'Новое впечатление',
    });
  });
  it('анонимный, посторонний и отключённый участник не читают обсуждения и статистику', async () => {
    await db.exec('reset role;set role anon;');
    for (const table of [
      'meeting_questions',
      'meeting_reflections',
      'club_book_stats',
      'club_quotes',
    ])
      await expect(db.query('select * from public.' + table)).rejects.toThrow();
    await actor('10000000-0000-4000-8000-000000000099');
    for (const table of [
      'meeting_questions',
      'meeting_reflections',
      'club_book_stats',
      'club_quotes',
    ])
      expect((await db.query('select * from public.' + table)).rows).toHaveLength(0);
    await expect(
      act('meeting.question', { id: quote, meeting_id: future, text: 'Нет доступа' }),
    ).rejects.toThrow('доступа');
  });
  it('глава и исторические даты дополняют общий прогресс, личные заметки не раскрываются', async () => {
    await actor(alice);
    await sync('book', {
      id: personal,
      clubBookId: book,
      title: 'Книга',
      totalPages: 300,
      status: 'finished',
      notes: 'Секрет',
    });
    await sync('progress', {
      bookId: personal,
      pages: 300,
      chapter: 'Эпилог',
      startedOn: '2019-01-01',
      finishedOn: '2019-01-03',
    });
    await actor(bob);
    const row = (await db.query<any>('select * from public.visible_progress')).rows[0];
    expect(row).toMatchObject({ chapter: 'Эпилог', pages: 300, total_pages: 300 });
    expect(JSON.stringify(row)).not.toContain('Секрет');
    const stats = (await db.query<any>('select * from public.club_book_stats')).rows[0];
    expect(Number(stats.pace_count)).toBe(1);
    expect(Number(stats.average_days)).toBe(3);
    expect(Number(stats.pages_per_day)).toBe(100);
  });
  it('общий рейтинг учитывает только разрешённые оценки, а не скрытую оценку самого автора', async () => {
    const rating = (rating: number, explicit_share = false) => ({
      book_id: book,
      title: 'Книга',
      rating,
      text: 'Впечатление',
      explicit_share,
    });
    await actor(admin);
    await share('review', admin, rating(1), 1);
    expect((await db.query('select * from public.visible_reviews')).rows).toHaveLength(1);
    expect((await db.query('select * from public.club_reviews')).rows).toHaveLength(0);
    await actor(alice);
    await share('review', alice, rating(9, true), 1);
    await actor(bob);
    await share('review', bob, rating(7, true), 1);
    await actor(admin);
    const stats = (await db.query<any>('select * from public.club_book_stats')).rows[0];
    expect(Number(stats.average_rating)).toBe(8);
    expect(Number(stats.rating_count)).toBe(2);
    await actor(alice);
    await share('review', alice, null, 2);
    await actor(admin);
    expect(
      Number((await db.query<any>('select * from public.club_book_stats')).rows[0].average_rating),
    ).toBe(7);
  });
  it('не выдумывает скорость из даты импорта и отбрасывает некорректные даты', async () => {
    await actor(alice);
    await sync('progress', {
      bookId: personal,
      pages: 300,
      chapter: 'Конец',
      startedOn: '2020-02-30',
      finishedOn: '2019-01-03',
    });
    expect(
      Number((await db.query<any>('select * from public.club_book_stats')).rows[0].pace_count),
    ).toBe(0);
    await sync('progress', {
      bookId: personal,
      pages: 300,
      startedOn: '2020-01-03',
      finishedOn: '2020-01-01',
    });
    expect(
      Number((await db.query<any>('select * from public.club_book_stats')).rows[0].pace_count),
    ).toBe(0);
  });
  it('общая лента не раскрывает скрытую цитату автора; сохраняет источник и версии публикации', async () => {
    await actor(alice);
    const q = {
      book_id: book,
      title: 'Книга',
      text: 'Цитата',
      source_id: question,
      source_author: 'Автор источника',
    };
    await share('quote', quote, q, 1);
    expect((await db.query('select * from public.public_quotes')).rows).toHaveLength(1);
    expect((await db.query('select * from public.club_quotes')).rows).toHaveLength(0);
    await share('quote', quote, { ...q, explicit_share: true }, 2);
    await actor(bob);
    const row = (await db.query<any>('select * from public.club_quotes')).rows[0];
    expect(row).toMatchObject({ source_id: question, source_author: 'Автор источника' });
    await expect(
      db.query("select public.club_action_v5('meeting.question','{}')"),
    ).rejects.toThrow();
    await expect(
      db.query("select public.sync_public_v5('quote',$1,null,1)", [quote]),
    ).rejects.toThrow();
  });
  it('администратор модерирует удаление; записи не размножаются при повторном удалении', async () => {
    await actor(admin);
    for (let i = 0; i < 2; i++) {
      await act('meeting.question.delete', { id: question });
      await act('meeting.reflection.delete', { id: reflection });
    }
    expect((await db.query('select * from public.meeting_questions')).rows).toHaveLength(0);
    expect((await db.query('select * from public.meeting_reflections')).rows).toHaveLength(0);
  });
});
