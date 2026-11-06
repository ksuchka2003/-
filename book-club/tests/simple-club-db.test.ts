// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
let db: PGlite;
const admin = '10000000-0000-4000-8000-000000000001',
  alice = '10000000-0000-4000-8000-000000000002',
  book = '20000000-0000-4000-8000-000000000001',
  personal = '30000000-0000-4000-8000-000000000001',
  other = '30000000-0000-4000-8000-000000000002',
  quote = '40000000-0000-4000-8000-000000000001',
  device = '50000000-0000-4000-8000-000000000001',
  meeting = '60000000-0000-4000-8000-000000000001';
async function actor(id: string) {
  await db.exec(`reset role;set role authenticated;set request.jwt.claim.sub='${id}';`);
}
async function act(name: string, data: unknown) {
  return db.query('select public.club_action($1,$2::jsonb)', [name, JSON.stringify(data)]);
}
async function sync(kind: string, id: string, payload: unknown) {
  const rows = (
    await db.query<{ revision: number }>(
      'select revision from public.private_library_records where kind=$1 and entity_id=$2',
      [kind, id],
    )
  ).rows;
  return db.query('select public.sync_private_library($1::jsonb,$2)', [
    JSON.stringify([
      { kind, entity_id: id, payload, base_revision: Number(rows[0]?.revision || 0) },
    ]),
    device,
  ]);
}
async function share(kind: string, id: string, payload: unknown, version: number) {
  return db.query('select public.sync_public($1,$2,$3::jsonb,$4)', [
    kind,
    id,
    payload === null ? null : JSON.stringify(payload),
    version,
  ]);
}
const data = {
  id: personal,
  title: 'Книга',
  authors: 'Автор',
  clubBookId: book,
  totalPages: 300,
  status: 'reading',
  notes: 'Секретная заметка',
  publishProgress: false,
  publishReview: false,
};
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
    await db.query('insert into public.member_privacy_settings(member_id) values($1)', [id]);
  }
  await actor(admin);
  await act('admin.book', {
    id: book,
    title: 'Книга',
    authors: 'Автор',
    totalPages: 300,
    status: 'reading',
  });
}, 30000);
afterAll(async () => {
  await db?.close();
});
describe.sequential('Упрощённый клуб: приватность, прогресс, встречи', () => {
  it('публикует только прогресс клубной книги независимо от старых флагов, сохраняя приватное хранилище', async () => {
    await actor(admin);
    await sync('book', personal, data);
    await sync('progress', personal, { bookId: personal, pages: 100 });
    await sync('review', personal, { bookId: personal, text: 'Приватный отзыв', rating: 8 });
    await sync('book', other, { ...data, id: other, clubBookId: null, title: 'Личная книга' });
    await actor(alice);
    const rows = (await db.query<any>('select * from public.visible_progress')).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      book_id: book,
      pages: 100,
      total_pages: 300,
      status: 'reading',
    });
    expect(JSON.stringify(rows)).not.toContain('Секретная');
    expect((await db.query('select * from public.private_library_records')).rows).toHaveLength(0);
    expect((await db.query('select * from public.visible_reviews')).rows).toHaveLength(0);
  });
  it('не даёт старой очереди скрыть обязательный прогресс или подменить чужого читателя', async () => {
    await actor(admin);
    const shared = (await db.query<any>('select * from public.visible_progress')).rows[0].id;
    await share('progress', shared, null, 9);
    await share('progress', personal, null, 10);
    await actor(alice);
    expect((await db.query<any>('select * from public.visible_progress')).rows[0].pages).toBe(100);
    await share('progress', personal, { member_id: admin, book_id: book, pages: 999 }, 11);
    expect((await db.query<any>('select * from public.visible_progress')).rows[0].pages).toBe(100);
    await actor(admin);
    await sync('progress', personal, { bookId: personal, pages: 200 });
    await actor(alice);
    expect((await db.query<any>('select * from public.visible_progress')).rows[0].pages).toBe(200);
  });
  it('делится одной личной цитатой без общего каталога, скрывает остальные и не размножает лайки', async () => {
    await actor(admin);
    const q = {
      book_id: null,
      title: 'Личная книга',
      text: 'Публичная цитата',
      comment: 'Комментарий',
      explicit_share: false,
    };
    await share('quote', quote, q, 1);
    await actor(alice);
    expect((await db.query('select * from public.public_quotes')).rows).toHaveLength(0);
    await actor(admin);
    await share('quote', quote, { ...q, explicit_share: true }, 2);
    await actor(alice);
    expect((await db.query('select * from public.public_quotes')).rows).toHaveLength(1);
    await act('like', { quote_id: quote, liked: true });
    await act('like', { quote_id: quote, liked: true });
    expect((await db.query('select * from public.quote_likes')).rows).toHaveLength(1);
    await actor(admin);
    await share('quote', quote, null, 3);
    await share('quote', quote, { ...q, explicit_share: true }, 2);
    await actor(alice);
    expect((await db.query('select * from public.public_quotes')).rows).toHaveLength(0);
    expect((await db.query('select * from public.quote_likes')).rows).toHaveLength(0);
  });
  it('отзыв доступен только после отдельного согласия; закрывает базовую таблицу и анонимный доступ', async () => {
    await actor(admin);
    const r = { book_id: book, title: 'Книга', text: 'Обсудим финал', rating: 8, spoilers: true };
    await share('review', personal, r, 1);
    await actor(alice);
    expect((await db.query('select * from public.visible_reviews')).rows).toHaveLength(0);
    await actor(admin);
    await share('review', personal, { ...r, explicit_share: true }, 2);
    await actor(alice);
    expect((await db.query<any>('select * from public.visible_reviews')).rows[0]).toMatchObject({
      text: 'Обсудим финал',
      rating: 8,
      spoilers: true,
    });
    await expect(db.query('select * from public.public_reviews')).rejects.toThrow();
    await db.exec('reset role;set role anon;');
    await expect(db.query('select * from public.visible_progress')).rejects.toThrow();
    await actor('10000000-0000-4000-8000-000000000099');
    expect((await db.query('select * from public.visible_progress')).rows).toHaveLength(0);
  });
  it('создаёт встречи только администратором, без блокировок календаря, с ссылкой и напоминанием за сутки', async () => {
    const starts = new Date(Math.floor((Date.now() + 3 * 86400000) / 1000) * 1000).toISOString();
    await db.exec(
      `reset role;insert into public.meeting_availability(member_id,day,status) values('${alice}',('${starts}'::timestamptz at time zone 'Europe/Moscow')::date,'busy');`,
    );
    const value = {
      id: meeting,
      title: 'Встреча',
      starts_at: starts,
      venue_url: 'https://maps.example/place',
      place: 'Библиотека',
      description: 'Обсуждаем книгу',
      version: 1,
    };
    await actor(alice);
    await expect(act('admin.meeting', value)).rejects.toThrow('администратор');
    await expect(act('availability', { day: '2030-01-01', status: 'free' })).rejects.toThrow(
      'больше не используется',
    );
    await expect(db.query('select * from public.meeting_availability')).rejects.toThrow();
    await actor(admin);
    await act('admin.meeting', value);
    expect((await db.query<any>('select * from public.meetings')).rows[0].venue_url).toBe(
      value.venue_url,
    );
    const jobs = (await db.query<any>('select * from public.notification_jobs')).rows;
    expect(jobs.filter((j) => j.kind === '24h')).toHaveLength(2);
    expect(jobs.filter((j) => j.kind === 'new')).toHaveLength(2);
    expect(jobs.some((j) => j.kind === '1h')).toBe(false);
    expect(Date.parse(jobs.find((j) => j.kind === '24h').run_at)).toBe(
      Date.parse(starts) - 86400000,
    );
    await expect(
      act('admin.meeting', { ...value, version: 1, venue_url: 'javascript:alert(1)' }),
    ).rejects.toThrow();
    await expect(db.query("select public.club_action_v4('admin.meeting','{}')")).rejects.toThrow();
    await expect(
      db.query("select public.sync_public_v1('quote',$1,null,1)", [quote]),
    ).rejects.toThrow();
  });
  it('удаляет общий прогресс после удаления личной книги с сохранением остальных записей', async () => {
    await actor(admin);
    const all = (await db.query<any>('select * from public.private_library_records')).rows.filter(
      (r) => r.entity_id === personal,
    );
    await db.query('select public.sync_private_library($1::jsonb,$2)', [
      JSON.stringify(
        all.map((r) => ({
          kind: r.kind,
          entity_id: r.entity_id,
          payload: null,
          base_revision: Number(r.revision),
        })),
      ),
      device,
    ]);
    await actor(alice);
    expect((await db.query('select * from public.visible_progress')).rows).toHaveLength(0);
  });
});
