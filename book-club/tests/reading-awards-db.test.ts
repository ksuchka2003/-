// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
let db: PGlite;
const admin = '10000000-0000-4000-8000-000000000001',
  alice = '10000000-0000-4000-8000-000000000002',
  bob = '10000000-0000-4000-8000-000000000003',
  book = '20000000-0000-4000-8000-000000000001';
const personal = (id: string) => id.replace('10000000', '30000000');
const rows = async (sql: string, args: unknown[] = []) => (await db.query<any>(sql, args)).rows;
async function actor(id: string) {
  await db.exec(`reset role;set role authenticated;set request.jwt.claim.sub='${id}';`);
}
async function status(id: string, value: string, notes = '') {
  await actor(id);
  const previous = (
    await rows(
      "select revision from public.private_library_records where kind='book' and entity_id=$1",
      [personal(id)],
    )
  )[0];
  const payload = {
    id: personal(id),
    clubBookId: book,
    title: 'Клубная книга',
    authors: 'Автор',
    description: '',
    genre: '',
    year: null,
    isbn: '',
    cover: '',
    totalPages: 100,
    status: value,
    notes,
    publishReview: false,
    publishProgress: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completed_at: '1900-01-01',
  };
  await db.query('select public.sync_private_library($1::jsonb,$2)', [
    JSON.stringify([
      {
        kind: 'book',
        entity_id: personal(id),
        payload,
        base_revision: Number(previous?.revision || 0),
      },
    ]),
    '80000000-0000-4000-8000-000000000001',
  ]);
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    "create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;alter default privileges in schema public grant all on tables to anon,authenticated;",
  );
  for (const file of readdirSync('supabase/migrations')
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    await db.exec(readFileSync('supabase/migrations/' + file, 'utf8'));
    if (file === '202611060010_simple_book_selection.sql') {
      for (const [id, tg, role] of [
        [admin, 1, 'admin'],
        [alice, 2, 'member'],
        [bob, 3, 'member'],
      ]) {
        await db.query('insert into auth.users values($1)', [id]);
        await db.query(
          'insert into public.club_members(id,auth_user_id,telegram_id,role) values($1,$1,$2,$3)',
          [id, tg, role],
        );
      }
      await db.query(
        "insert into public.club_books(id,title,status) values($1,'Клубная книга','reading')",
        [book],
      );
      await status(alice, 'finished');
      await db.exec('reset role;');
    }
  }
}, 30000);
afterAll(async () => {
  await db?.close();
});
describe.sequential('Награды текущего чтения', () => {
  it('не выдумывает награды за старые прочтения и не реагирует на правку старой записи', async () => {
    await actor(alice);
    expect(await rows('select * from public.club_reading_awards')).toHaveLength(0);
    await status(alice, 'finished', 'Исправленная заметка');
    expect(await rows('select * from public.club_reading_awards')).toHaveLength(0);
  });
  it('первый новый финиш даёт медаль, время фиксируется сервером', async () => {
    await status(alice, 'reading');
    await status(alice, 'finished');
    expect(await rows('select member_id,kind from public.club_reading_awards')).toEqual([
      { member_id: alice, kind: 'first' },
    ]);
    await db.exec('reset role;');
    const finish = (await rows('select completed_at from private.reading_finishes'))[0]
      .completed_at;
    expect(new Date(finish).getFullYear()).toBeGreaterThan(2020);
    await status(alice, 'finished', 'Изменённая заметка');
    await db.exec('reset role;');
    expect(
      (await rows('select completed_at from private.reading_finishes'))[0].completed_at,
    ).toEqual(finish);
  });
  it('не выдаёт последнему 💩, пока кто-то не закончил; после всех финишей даёт её последнему', async () => {
    await status(bob, 'finished');
    expect(
      (await rows('select * from public.club_reading_awards')).every((a) => a.kind !== 'last'),
    ).toBe(true);
    await status(admin, 'finished');
    expect(
      (await rows("select member_id from public.club_reading_awards where kind='last'"))[0]
        .member_id,
    ).toBe(admin);
  });
  it('исправление ошибочного статуса отзывает финиш, новый финиш получает новое место', async () => {
    await status(bob, 'reading');
    expect(await rows("select * from public.club_reading_awards where kind='last'")).toHaveLength(
      0,
    );
    await status(bob, 'finished');
    expect(
      (await rows("select member_id from public.club_reading_awards where kind='last'"))[0]
        .member_id,
    ).toBe(bob);
  });
  it('новое чтение сбрасывает награды; старые статусы не выигрывают автоматически', async () => {
    await actor(admin);
    await db.query("select public.club_action('admin.current_book',$1::jsonb)", [
      JSON.stringify({ book_id: book, active: false }),
    ]);
    expect(await rows('select * from public.club_reading_awards')).toHaveLength(0);
    await db.query("select public.club_action('admin.current_book',$1::jsonb)", [
      JSON.stringify({ book_id: book, active: true }),
    ]);
    await status(alice, 'finished', 'Просто правка');
    expect(await rows('select * from public.club_reading_awards')).toHaveLength(0);
    await status(bob, 'reading');
    await status(bob, 'finished');
    expect(await rows('select member_id,kind from public.club_reading_awards')).toEqual([
      { member_id: bob, kind: 'first' },
    ]);
  });
  it('чужие приватные записи и назначение наград недоступны клиенту; анонимный доступ закрыт', async () => {
    await actor(alice);
    await expect(db.exec('select * from private.reading_finishes')).rejects.toThrow(
      'permission denied',
    );
    await expect(db.exec("update public.club_reading_awards set kind='first'")).rejects.toThrow(
      /permission denied|cannot update view/,
    );
    await db.exec('reset role;set role anon;');
    await expect(db.exec('select * from public.club_reading_awards')).rejects.toThrow(
      'permission denied',
    );
    await db.exec('reset role;');
  });
});
