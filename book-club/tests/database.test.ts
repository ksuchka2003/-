// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
let db: PGlite;
const admin = '10000000-0000-4000-8000-000000000001',
  alice = '10000000-0000-4000-8000-000000000002',
  bob = '10000000-0000-4000-8000-000000000003';
const book = '20000000-0000-4000-8000-000000000001',
  quote = '30000000-0000-4000-8000-000000000001',
  review = '40000000-0000-4000-8000-000000000001';
async function actor(id: string) {
  await db.exec(`reset role;set role authenticated;set request.jwt.claim.sub='${id}';`);
}
async function root() {
  await db.exec('reset role;');
}
async function action(name: string, data: unknown) {
  return db.query('select public.club_action($1,$2::jsonb)', [name, JSON.stringify(data)]);
}
async function sync(kind: string, id: string, payload: unknown, version = Date.now()) {
  return db.query('select public.sync_public($1,$2,$3::jsonb,$4)', [
    kind,
    id,
    payload === null ? null : JSON.stringify(payload),
    version,
  ]);
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`,
  );
  await db.exec(
    'alter default privileges in schema public grant all on tables to anon,authenticated;',
  );
  await db.exec(readFileSync('supabase/migrations/202610250001_club.sql', 'utf8'));
  for (const [id, telegram, role] of [
    [admin, 1, 'admin'],
    [alice, 2, 'member'],
    [bob, 3, 'member'],
  ] as const) {
    await db.query('insert into auth.users values($1)', [id]);
    await db.query(
      'insert into public.club_members(id,auth_user_id,telegram_id,role) values($1,$1,$2,$3)',
      [id, telegram, role],
    );
    await db.query("insert into public.member_profiles(member_id,name) values($1,'Имя')", [id]);
    await db.query('insert into public.member_privacy_settings(member_id) values($1)', [id]);
  }
  await actor(admin);
  await action('admin.book', {
    id: book,
    title: 'Дюна',
    authors: 'Фрэнк Герберт',
    totalPages: 600,
  });
}, 30000);
afterAll(async () => {
  await db?.close();
});
describe.sequential('PostgreSQL: миграция, RLS и защищённые операции', () => {
  it('закрывает доступ постороннему и не позволяет назначить роль', async () => {
    await actor('10000000-0000-4000-8000-000000000099');
    expect((await db.query('select * from public.club_books')).rows).toHaveLength(0);
    await expect(action('admin.book', { title: 'Чужая' })).rejects.toThrow();
    await actor(alice);
    await expect(
      db.exec("update public.club_members set role='admin' where telegram_id=2"),
    ).rejects.toThrow();
    await expect(action('admin.invite', { telegram_id: 4 })).rejects.toThrow();
  });
  it('не раскрывает Telegram ID других членов, но показывает профили', async () => {
    await actor(alice);
    expect((await db.query('select * from public.club_members')).rows).toHaveLength(1);
    expect((await db.query('select * from public.member_profiles')).rows).toHaveLength(3);
  });
  it('скрывает цитату по умолчанию и применяет глобальные настройки на сервере', async () => {
    await actor(alice);
    await sync(
      'quote',
      quote,
      {
        book_id: book,
        title: 'Дюна',
        text: 'Страх убивает разум',
        page: 10,
        chapter: '',
        comment: '',
      },
      1,
    );
    await actor(bob);
    expect((await db.query('select * from public.public_quotes')).rows).toHaveLength(0);
    await actor(alice);
    await sync('privacy', alice, { show_quotes: true, show_reviews: true }, 1);
    await actor(bob);
    expect((await db.query('select * from public.public_quotes')).rows).toHaveLength(1);
  });
  it('скрывает оценку независимо от текста отзыва и запрещает чтение исходной таблицы', async () => {
    await actor(alice);
    await sync(
      'review',
      review,
      { book_id: book, title: 'Дюна', text: 'Хорошая книга', rating: 9, spoilers: true },
      1,
    );
    await actor(bob);
    expect(
      (await db.query<{ rating: number | null }>('select * from public.visible_reviews')).rows[0]
        .rating,
    ).toBeNull();
    await expect(db.query('select * from public.public_reviews')).rejects.toThrow();
    await actor(alice);
    await sync('privacy', alice, { show_reviews: true, show_ratings: true, show_quotes: true }, 2);
    await actor(bob);
    expect(
      (await db.query<{ rating: number }>('select * from public.visible_reviews')).rows[0].rating,
    ).toBe(9);
  });
  it('делает лайки идемпотентными, блокирует подмену владельца и удаляет лайки каскадом', async () => {
    await actor(bob);
    await action('like', { quote_id: quote, liked: true });
    await action('like', { quote_id: quote, liked: true });
    expect((await db.query('select * from public.quote_likes')).rows).toHaveLength(1);
    await expect(
      sync('quote', quote, { book_id: book, title: 'Взлом', text: 'Чужая' }, 2),
    ).rejects.toThrow();
    await actor(alice);
    await sync('quote', quote, null, 3);
    await actor(bob);
    expect((await db.query('select * from public.quote_likes')).rows).toHaveLength(0);
  });
  it('не применяет старую повторную публикацию после удаления', async () => {
    await actor(alice);
    await sync('quote', quote, { book_id: book, title: 'Дюна', text: 'Старое содержимое' }, 2);
    expect((await db.query('select * from public.public_quotes')).rows).toHaveLength(0);
  });
  it('проверяет прогресс и отдельное разрешение для текущих книг', async () => {
    await actor(alice);
    await expect(
      sync(
        'progress',
        alice,
        { book_id: book, title: 'Дюна', status: 'reading', pages: 700, total_pages: 600 },
        1,
      ),
    ).rejects.toThrow();
    await sync(
      'progress',
      alice,
      { book_id: book, title: 'Дюна', status: 'reading', pages: 200, total_pages: 480 },
      2,
    );
    await sync('privacy', alice, { show_progress: true }, 3);
    await actor(bob);
    expect((await db.query('select * from public.visible_progress')).rows).toHaveLength(0);
    await actor(alice);
    await sync('privacy', alice, { show_progress: true, show_current: true }, 4);
    await actor(bob);
    expect((await db.query('select * from public.visible_progress')).rows).toHaveLength(1);
  });
  it('показывает книгу без страниц и оценку без приватного текста; запрещает запись в виды', async () => {
    await actor(alice);
    await sync('privacy', alice, { show_current: true, show_ratings: true }, 5);
    await actor(bob);
    expect(
      (await db.query<{ pages: null }>('select * from public.visible_progress')).rows[0].pages,
    ).toBeNull();
    const r = (
      await db.query<{ rating: number; text: string }>('select * from public.visible_reviews')
    ).rows[0];
    expect(r.rating).toBe(9);
    expect(r.text).toBe('');
    await expect(db.exec("update public.visible_reviews set title='Подмена'")).rejects.toThrow();
    await expect(db.exec("update public.visible_progress set title='Подмена'")).rejects.toThrow();
    await expect(db.query('select * from public.public_reading_progress')).rejects.toThrow();
  });
  it('одобряет заявку ровно один раз и определяет дубликат', async () => {
    const id = '50000000-0000-4000-8000-000000000001';
    const metadata = { title: 'Дюна', authors: 'Фрэнк Герберт', totalPages: 900 };
    await actor(alice);
    await action('proposal', { id, metadata, status: 'pending' });
    await expect(action('proposal', { id, metadata, status: 'approved' })).rejects.toThrow();
    await actor(admin);
    await action('admin.proposal', { id, approve: true, metadata });
    await action('admin.proposal', { id, approve: true, metadata });
    expect((await db.query('select * from public.club_books')).rows).toHaveLength(1);
  });
  it('поддерживает несколько главных книг и сохраняет историю', async () => {
    await actor(admin);
    const b2 = '20000000-0000-4000-8000-000000000002';
    await action('admin.book', {
      id: b2,
      title: 'Солярис',
      authors: 'Станислав Лем',
      totalPages: 300,
    });
    for (const [i, b] of [book, b2].entries())
      await action('admin.reading', {
        id: `60000000-0000-4000-8000-00000000000${i + 1}`,
        book_id: b,
        starts_on: '2026-10-25',
        ends_on: '2026-11-25',
        position: i,
        status: 'active',
      });
    expect(
      (await db.query("select * from public.club_readings where status='active'")).rows,
    ).toHaveLength(2);
  });
  it('создаёт встречи и расписание, принимает ответ и инвалидирует старые задания', async () => {
    const id = '70000000-0000-4000-8000-000000000001';
    const m = {
      id,
      title: 'Обсуждение',
      starts_at: new Date(Date.now() + 3 * 86400000).toISOString(),
      place: 'Библиотека',
      description: '',
      book_ids: [book],
      cancelled: false,
    };
    await actor(admin);
    await action('admin.meeting', m);
    expect((await db.query('select * from public.notification_jobs')).rows).toHaveLength(9);
    await actor(alice);
    await action('attendance', { meeting_id: id, response: 'yes' });
    await expect(action('admin.meeting', m)).rejects.toThrow();
    await actor(admin);
    await action('admin.meeting', { ...m, cancelled: true });
    expect(
      (await db.query("select * from public.notification_jobs where status='pending'")).rows,
    ).toHaveLength(3);
    await actor(alice);
    await expect(action('attendance', { meeting_id: id, response: 'yes' })).rejects.toThrow();
  });
  it('отключённый участник теряет доступ даже с действующим JWT', async () => {
    await actor(admin);
    await action('admin.member', { id: bob, active: false });
    await actor(bob);
    expect((await db.query('select * from public.member_profiles')).rows).toHaveLength(0);
    await expect(sync('quote', bob, null, 1)).rejects.toThrow();
    await root();
  });
});
