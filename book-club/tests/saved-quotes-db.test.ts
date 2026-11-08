// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { getDB, LibraryDB, openLibrary } from '../src/db';
import {
  copyPublicQuote,
  saveBook,
  saveQuote,
  trashBook,
  restoreBook,
  deleteBook,
} from '../src/local';
import { createLibrarySynchronizer } from '../src/privateSync';
import { now, uid } from '../src/domain';
import type { Book } from '../src/domain';
import type { LibraryRecord, LibraryChange, LibraryReply } from '../src/privateTypes';

let pg: PGlite;
let first: LibraryDB, second: LibraryDB;
const author = '10000000-0000-4000-8000-000000000001';
const reader = '10000000-0000-4000-8000-000000000002';
const clubBook = uid(),
  original = uid();
async function actor(id: string) {
  await pg.exec(`reset role;set role authenticated;set request.jwt.claim.sub='${id}';`);
}
const synchronizer = (db: LibraryDB) =>
  createLibrarySynchronizer(db, {
    async pull() {
      await actor(reader);
      return (
        await pg.query<LibraryRecord>(
          'select kind,entity_id,payload,revision,device_id from public.private_library_records',
        )
      ).rows.map((r) => ({ ...r, revision: Number(r.revision) }));
    },
    async push(changes: LibraryChange[], device: string) {
      await actor(reader);
      return (
        await pg.query<{ result: LibraryReply[] }>(
          'select public.sync_private_library($1::jsonb,$2::uuid) result',
          [JSON.stringify(changes), device],
        )
      ).rows[0].result;
    },
  });
async function share(payload: unknown, version: number) {
  await actor(author);
  await pg.query("select public.sync_public('quote',$1,$2::jsonb,$3)", [
    original,
    payload === null ? null : JSON.stringify(payload),
    version,
  ]);
}
beforeAll(async () => {
  vi.stubGlobal('navigator', { onLine: true });
  first = openLibrary(uid());
  second = new LibraryDB('saved-second-' + uid());
  pg = new PGlite();
  await pg.exec(
    "create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;alter default privileges in schema public grant all on tables to anon,authenticated;",
  );
  for (const file of readdirSync('supabase/migrations')
    .filter((f) => f.endsWith('.sql'))
    .sort())
    await pg.exec(readFileSync('supabase/migrations/' + file, 'utf8'));
  for (const [id, telegram, name] of [
    [author, 1, 'Автор'],
    [reader, 2, 'Читатель'],
  ]) {
    await pg.query('insert into auth.users values($1)', [id]);
    await pg.query(
      "insert into public.club_members(id,auth_user_id,telegram_id,role) values($1,$1,$2,'member')",
      [id, telegram],
    );
    await pg.query('insert into public.member_profiles(member_id,name) values($1,$2)', [id, name]);
    await pg.query('insert into public.member_privacy_settings(member_id) values($1)', [id]);
  }
  await pg.query(
    "insert into public.club_books(id,title,authors) values($1,'Книга-источник','Писатель')",
    [clubBook],
  );
}, 30000);

it('корзина переносится между устройствами и на сервере скрывает прогресс, отзывы, цитаты и старые задания публикации', async () => {
  const shared = uid();
  await pg.exec('reset role');
  await pg.query("insert into public.club_books(id,title) values($1,'Книга для корзины')", [
    shared,
  ]);
  const book: Book = {
    id: uid(),
    clubBookId: shared,
    title: 'Книга для корзины',
    authors: 'Автор',
    description: '',
    genre: '',
    year: null,
    isbn: '',
    cover: '',
    totalPages: 300,
    status: 'reading',
    notes: 'Приватная заметка',
    publishReview: true,
    publishProgress: false,
    createdAt: now(),
    updatedAt: now(),
  };
  await saveBook(
    book,
    150,
    { bookId: book.id, text: 'Мой отзыв', rating: 9, spoilers: false, updatedAt: now() },
    true,
  );
  const quote = {
    id: uid(),
    bookId: book.id,
    text: 'Цитата в книге',
    page: 12,
    chapter: '',
    comment: '',
    favorite: true,
    published: true,
    deletedAt: null,
    sourceId: null,
    sourceAuthor: null,
    createdAt: now(),
    updatedAt: now(),
  };
  await saveQuote(quote, true);
  const syncA = synchronizer(first),
    syncB = synchronizer(second);
  await syncA.sync();
  await actor(reader);
  const qPayload = { book_id: shared, title: book.title, text: quote.text, explicit_share: true };
  await pg.query("select public.sync_public('quote',$1,$2::jsonb,1)", [
    quote.id,
    JSON.stringify(qPayload),
  ]);
  await pg.query("select public.sync_public('review',$1,$2::jsonb,1)", [
    book.id,
    JSON.stringify({
      book_id: shared,
      title: book.title,
      text: 'Мой отзыв',
      rating: 9,
      explicit_share: true,
    }),
  ]);
  expect(
    (await pg.query('select * from public.visible_progress where book_id=$1', [shared])).rows,
  ).toHaveLength(1);
  await trashBook(book.id);
  await syncA.sync();
  await syncB.sync();
  expect((await second.personal_books.get(book.id))?.deletedAt).toBeTruthy();
  expect((await second.personal_books.get(book.id))?.notes).toBe('Приватная заметка');
  expect((await second.quotes.get(quote.id))?.text).toBe(quote.text);
  expect((await second.reading_progress.get(book.id))?.pages).toBe(150);
  expect((await second.personal_reviews.get(book.id))?.text).toBe('Мой отзыв');
  await actor(reader);
  for (const table of ['visible_progress', 'visible_reviews', 'public_quotes'])
    expect(
      (await pg.query('select * from public.' + table + ' where book_id=$1', [shared])).rows,
    ).toHaveLength(0);
  await pg.query(
    "select public.sync_public(p_kind=>'quote',p_entity=>$1,p_payload=>$2::jsonb,p_version=>2)",
    [quote.id, JSON.stringify(qPayload)],
  );
  expect(
    (await pg.query('select * from public.public_quotes where id=$1', [quote.id])).rows,
  ).toHaveLength(0);
  await expect(
    pg.query("select public.sync_public_v11('quote',$1,$2::jsonb,3)", [
      quote.id,
      JSON.stringify(qPayload),
    ]),
  ).rejects.toThrow();
  await restoreBook(book.id);
  await syncA.sync();
  await syncB.sync();
  expect(await second.personal_books.get(book.id)).toMatchObject({
    deletedAt: null,
    publishReview: false,
    notes: book.notes,
  });
  expect(await second.quotes.get(quote.id)).toMatchObject({ favorite: true, published: false });
  expect((await second.personal_reviews.get(book.id))?.rating).toBe(9);
  await actor(reader);
  expect(
    (await pg.query('select * from public.visible_progress where book_id=$1', [shared])).rows,
  ).toHaveLength(1);
  expect(
    (await pg.query('select * from public.public_quotes where id=$1', [quote.id])).rows,
  ).toHaveLength(0);
  await deleteBook(book.id);
  await syncA.sync();
  await syncB.sync();
  expect(await second.personal_books.get(book.id)).toBeUndefined();
  expect(await second.quotes.get(quote.id)).toBeUndefined();
}, 30000);
afterAll(async () => {
  await first?.delete();
  await second?.delete();
  await pg?.close();
  vi.unstubAllGlobals();
});

it('личная копия переживает правку, снятие публикации, удаление автора и книги; загружается на новое устройство', async () => {
  const payload = {
    book_id: clubBook,
    title: 'Книга-источник',
    text: 'Исходный текст',
    page: 17,
    chapter: 'Глава 2',
    comment: 'Мысль автора',
    explicit_share: true,
  };
  await share(payload, 1);
  await actor(reader);
  const source = (await pg.query<any>('select * from public.club_quotes where id=$1', [original]))
    .rows[0];
  expect(source.text).toBe(payload.text);
  await copyPublicQuote(source, 'Автор');
  const copy = (await getDB().quotes.toArray())[0];
  expect(copy.id).not.toBe(original);
  expect(copy.bookId).not.toBe(clubBook);
  const firstSync = synchronizer(first);
  await firstSync.sync();
  expect((await first.settings.get('_librarySync'))?.value).toMatchObject({
    phase: 'idle',
    error: '',
  });
  await share({ ...payload, text: 'Автор изменил оригинал' }, 2);
  await firstSync.sync();
  expect((await first.quotes.get(copy.id))?.text).toBe('Исходный текст');
  await share(null, 3);
  await firstSync.sync();
  expect(await first.quotes.get(copy.id)).toMatchObject({
    text: 'Исходный текст',
    sourceId: original,
  });
  await share({ ...payload, text: 'Возвращённая публикация' }, 4);
  await pg.exec('reset role');
  await pg.query('delete from public.club_members where id=$1', [author]);
  await pg.query('delete from public.club_books where id=$1', [clubBook]);
  expect(
    (await pg.query('select * from public.public_quotes where id=$1', [original])).rows,
  ).toHaveLength(0);
  await firstSync.sync();
  await synchronizer(second).sync();
  expect((await second.settings.get('_librarySync'))?.value).toMatchObject({
    phase: 'idle',
    error: '',
  });
  expect(await second.quotes.get(copy.id)).toMatchObject({
    text: 'Исходный текст',
    page: 17,
    chapter: 'Глава 2',
    comment: 'Мысль автора',
    sourceId: original,
    sourceAuthor: 'Автор',
    published: false,
    deletedAt: null,
  });
  expect(await second.personal_books.get(copy.bookId)).toMatchObject({ title: 'Книга-источник' });
  // Даже при удалённом источнике свою копию можно редактировать и синхронизировать обратно.
  await second.quotes.update(copy.id, { comment: 'Мой комментарий', updatedAt: now() });
  await synchronizer(second).sync();
  await firstSync.sync();
  expect((await first.quotes.get(copy.id))?.comment).toBe('Мой комментарий');
  await actor(reader);
  expect((await pg.query('select * from public.club_quotes')).rows).toHaveLength(0);
}, 30000);
