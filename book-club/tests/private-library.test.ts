// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, afterEach, afterAll, it, expect, vi } from 'vitest';
import { LibraryDB, openLibrary } from '../src/db';
import { importBackup } from '../src/backup';
import { createLibrarySynchronizer } from '../src/privateSync';
import type { LibraryRecord, LibraryChange, LibraryReply } from '../src/privateTypes';
import { now, uid, type Book } from '../src/domain';
let pg: PGlite;
let a: LibraryDB, b: LibraryDB;
const alice = '10000000-0000-4000-8000-000000000001',
  bob = '10000000-0000-4000-8000-000000000002';
const makeBook = (): Book => ({
  id: uid(),
  clubBookId: null,
  title: 'Дюна',
  authors: 'Фрэнк Герберт',
  description: '',
  genre: '',
  year: 1965,
  isbn: '',
  cover: '',
  totalPages: 480,
  status: 'reading',
  notes: 'Личная заметка',
  publishProgress: false,
  publishReview: false,
  createdAt: now(),
  updatedAt: now(),
});
async function role(id = alice) {
  await pg.exec(`reset role;set role authenticated;set request.jwt.claim.sub='${id}';`);
}
async function pull() {
  return (
    await pg.query<LibraryRecord>(
      'select kind,entity_id,payload,revision,device_id from public.private_library_records',
    )
  ).rows.map((r) => ({ ...r, revision: Number(r.revision) }));
}
async function push(changes: LibraryChange[], device: string) {
  return (
    await pg.query<{ result: LibraryReply[] }>(
      'select public.sync_private_library($1::jsonb,$2::uuid) result',
      [JSON.stringify(changes), device],
    )
  ).rows[0].result;
}
const engine = (db: LibraryDB) => createLibrarySynchronizer(db, { pull, push });
const makeQuote = (bookId: string) => ({
  id: uid(),
  bookId,
  text: 'Личная цитата',
  page: null,
  chapter: '',
  comment: '',
  favorite: false,
  sourceId: null,
  sourceAuthor: null,
  published: false,
  deletedAt: null,
  createdAt: now(),
  updatedAt: now(),
});
beforeAll(async () => {
  vi.stubGlobal('navigator', { onLine: true });
  pg = new PGlite();
  await pg.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`,
  );
  await pg.exec(readFileSync('supabase/migrations/202610250001_club.sql', 'utf8'));
  await pg.exec(readFileSync('supabase/migrations/202610250002_private_library.sql', 'utf8'));
  for (const [id, tg, role] of [
    [alice, 42, 'member'],
    [bob, 43, 'admin'],
  ]) {
    await pg.query('insert into auth.users values($1)', [id]);
    await pg.query(
      'insert into public.club_members(id,auth_user_id,telegram_id,role) values($1,$1,$2,$3)',
      [id, tg, role],
    );
    await pg.query('insert into public.member_privacy_settings(member_id) values($1)', [id]);
    await pg.query("insert into public.member_profiles(member_id,name) values($1,'Анна')", [id]);
  }
}, 30000);
beforeEach(async () => {
  a = new LibraryDB(`device-a-${uid()}`);
  b = new LibraryDB(`device-b-${uid()}`);
  await pg.exec('reset role;delete from public.private_library_records;');
  await role();
  vi.stubGlobal('navigator', { onLine: true });
});
afterEach(async () => {
  await a.delete();
  await b.delete();
});
afterAll(async () => {
  await pg.close();
  vi.unstubAllGlobals();
});
it('переносит книги, приватные заметки, прогресс, отзывы, цитаты, избранное и корзину между устройствами', async () => {
  const book = makeBook();
  const quoteId = uid();
  await a.personal_books.put(book);
  await a.reading_progress.put({ bookId: book.id, pages: 200, updatedAt: now() });
  await a.personal_reviews.put({
    bookId: book.id,
    rating: 9,
    text: 'Личный отзыв',
    spoilers: false,
    updatedAt: now(),
  });
  await a.quotes.put({
    id: quoteId,
    bookId: book.id,
    text: 'Цитата',
    page: 10,
    chapter: '',
    comment: 'Приватный комментарий',
    favorite: true,
    deletedAt: now(),
    sourceId: null,
    sourceAuthor: null,
    published: false,
    createdAt: now(),
    updatedAt: now(),
  });
  await engine(a).sync();
  await engine(b).sync();
  expect(await b.personal_books.get(book.id)).toEqual(book);
  expect((await b.reading_progress.get(book.id))?.pages).toBe(200);
  expect((await b.personal_reviews.get(book.id))?.text).toBe('Личный отзыв');
  expect((await b.quotes.get(quoteId))?.favorite).toBe(true);
  expect((await b.quotes.get(quoteId))?.deletedAt).toBeTruthy();
  expect((await pull()).length).toBe(4);
});
it('объединяет независимые правки разных полей', async () => {
  const book = makeBook();
  await a.personal_books.put(book);
  const ea = engine(a),
    eb = engine(b);
  await ea.sync();
  await eb.sync();
  await a.personal_books.update(book.id, { notes: 'Заметка с телефона', updatedAt: now() });
  await b.personal_books.update(book.id, { title: 'Дюна — моё издание', updatedAt: now() });
  await ea.sync();
  await eb.sync();
  await ea.sync();
  expect((await a.personal_books.get(book.id))?.title).toBe('Дюна — моё издание');
  expect((await b.personal_books.get(book.id))?.notes).toBe('Заметка с телефона');
  expect(await b.private_conflicts.count()).toBe(0);
});
it('сохраняет обе версии при конфликте и применяет явный выбор пользователя', async () => {
  const book = makeBook();
  await a.personal_books.put(book);
  const ea = engine(a),
    eb = engine(b);
  await ea.sync();
  await eb.sync();
  await a.personal_books.update(book.id, { notes: 'Версия А' });
  await b.personal_books.update(book.id, { notes: 'Версия Б' });
  await ea.sync();
  await eb.sync();
  expect((await b.personal_books.get(book.id))?.notes).toBe('Версия Б');
  expect(await b.private_conflicts.count()).toBe(1);
  const conflict = (await b.private_conflicts.toArray())[0];
  await eb.resolve(conflict.key, 'local');
  await ea.sync();
  expect((await a.personal_books.get(book.id))?.notes).toBe('Версия Б');
  expect(await b.private_conflicts.count()).toBe(0);
});
it('синхронизирует удаление и не восстанавливает запись при повторе', async () => {
  const book = makeBook();
  await a.personal_books.put(book);
  await a.reading_progress.put({ bookId: book.id, pages: 100, updatedAt: now() });
  const ea = engine(a),
    eb = engine(b);
  await ea.sync();
  await eb.sync();
  await a.personal_books.delete(book.id);
  await a.reading_progress.delete(book.id);
  await ea.sync();
  await eb.sync();
  await eb.sync();
  await ea.sync();
  expect(await b.personal_books.count()).toBe(0);
  expect(await b.reading_progress.count()).toBe(0);
  expect((await pull()).every((r) => r.payload === null)).toBe(true);
});
it('полная замена учитывает облачные книги, которые ещё не успели загрузиться на устройство', async () => {
  const book = makeBook(),
    quote = makeQuote(book.id);
  await a.personal_books.put(book);
  await a.quotes.put(quote);
  await engine(a).sync();
  const replacement = openLibrary(uid());
  try {
    await importBackup(
      JSON.stringify({
        format: 'bookclub',
        version: 1,
        exportedAt: now(),
        books: [],
        progress: [],
        reviews: [],
        quotes: [],
        settings: [],
      }),
      'replace',
      await pull(),
    );
    await engine(replacement).sync();
    expect((await pull()).every((r) => r.payload === null)).toBe(true);
    expect(await replacement.personal_books.count()).toBe(0);
  } finally {
    await replacement.delete();
  }
});
it('удаление книги на другом устройстве не стирает новую офлайн-цитату без выбора', async () => {
  const book = makeBook();
  await a.personal_books.put(book);
  const ea = engine(a),
    eb = engine(b);
  await ea.sync();
  await eb.sync();
  const quote = makeQuote(book.id);
  await b.quotes.put(quote);
  await a.personal_books.delete(book.id);
  await ea.sync();
  await eb.sync();
  expect(await b.quotes.get(quote.id)).toEqual(quote);
  expect(await b.personal_books.get(book.id)).toEqual(book);
  const conflict = (await b.private_conflicts.toArray()).find((r) => r.kind === 'book')!;
  expect(conflict.related).toHaveLength(1);
  await eb.resolve(conflict.key, 'local');
  await ea.sync();
  expect(await a.personal_books.get(book.id)).toEqual(book);
  expect(await a.quotes.get(quote.id)).toEqual(quote);
});
it('локальное удаление одновременно с чужой правкой цитаты сохраняет облачную семью до выбора', async () => {
  const book = makeBook(),
    quote = makeQuote(book.id);
  await a.personal_books.put(book);
  await a.quotes.put(quote);
  const ea = engine(a),
    eb = engine(b);
  await ea.sync();
  await eb.sync();
  await a.quotes.update(quote.id, { text: 'Новая версия цитаты' });
  await ea.sync();
  await b.personal_books.delete(book.id);
  await b.quotes.delete(quote.id);
  await eb.sync();
  const conflict = (await b.private_conflicts.toArray()).find((r) => r.kind === 'book')!;
  expect(conflict.related?.[0].payload?.text).toBe('Новая версия цитаты');
  await eb.resolve(conflict.key, 'cloud');
  expect((await b.quotes.get(quote.id))?.text).toBe('Новая версия цитаты');
  expect((await b.personal_books.get(book.id))?.title).toBe(book.title);
});
it('повтор создания с потерянным подтверждением не воскрешает позднее удалённую книгу', async () => {
  const book = makeBook();
  await a.personal_books.put(book);
  const lost = createLibrarySynchronizer(a, {
    pull,
    push: async (c, d) => {
      await push(c, d);
      throw new Error('Потерян ответ');
    },
  });
  await lost.sync();
  const eb = engine(b);
  await eb.sync();
  await b.personal_books.delete(book.id);
  await eb.sync();
  await engine(a).sync();
  expect(await a.private_conflicts.count()).toBe(1);
  expect((await pull()).find((r) => r.kind === 'book')?.payload).toBeNull();
});
it('оставляет более новую локальную правку, сделанную во время отправки', async () => {
  const book = makeBook();
  await a.personal_books.put(book);
  let first = true;
  const ea = createLibrarySynchronizer(a, {
    pull,
    push: async (changes, device) => {
      const result = await push(changes, device);
      if (first) {
        first = false;
        await a.personal_books.update(book.id, { notes: 'Новая правка во время отправки' });
      }
      return result;
    },
  });
  await ea.sync();
  expect((await a.settings.get('_librarySync'))?.value).toMatchObject({ phase: 'syncing' });
  await ea.sync();
  await engine(b).sync();
  expect((await b.personal_books.get(book.id))?.notes).toBe('Новая правка во время отправки');
});
it('сохраняет офлайн и повторяет отправку после сетевой ошибки', async () => {
  const book = makeBook();
  await a.personal_books.put(book);
  vi.stubGlobal('navigator', { onLine: false });
  const ea = engine(a);
  await ea.sync();
  expect(await pull()).toHaveLength(0);
  vi.stubGlobal('navigator', { onLine: true });
  let fail = true;
  const retry = createLibrarySynchronizer(a, {
    pull,
    push: async (c, d) => {
      if (fail) {
        fail = false;
        throw new Error('Нет сети');
      }
      return push(c, d);
    },
  });
  await retry.sync();
  expect(await a.personal_books.count()).toBe(1);
  await retry.sync();
  await engine(b).sync();
  expect(await b.personal_books.count()).toBe(1);
});
it('повторяет согласование публичных копий после сетевого сбоя, даже когда личные данные уже получены', async () => {
  const book = makeBook();
  await a.personal_books.put(book);
  await engine(a).sync();
  const reconcile = vi
    .fn()
    .mockRejectedValueOnce(new Error('Нет сети'))
    .mockResolvedValue(undefined);
  const eb = createLibrarySynchronizer(b, { pull, push }, reconcile);
  await eb.sync();
  expect(await b.personal_books.get(book.id)).toEqual(book);
  expect((await b.settings.get('_librarySync'))?.value).toMatchObject({ phase: 'error' });
  expect((await b.settings.get('_reconcilePublic'))?.value).toBe(true);
  await eb.sync();
  expect(reconcile).toHaveBeenCalledTimes(2);
  expect(await b.settings.get('_reconcilePublic')).toBeUndefined();
  expect((await b.settings.get('_librarySync'))?.value).toMatchObject({ phase: 'idle' });
});
it('не раскрывает приватную библиотеку другому участнику или администратору и не позволяет прямую запись', async () => {
  const book = makeBook();
  await a.personal_books.put(book);
  await engine(a).sync();
  await role(bob);
  expect(await pull()).toHaveLength(0);
  await expect(pg.exec("update public.private_library_records set payload='{}'")).rejects.toThrow();
  await pg.exec('reset role;set role anon;');
  await expect(pull()).rejects.toThrow();
});
it('проверяет пакет и UUID владельца на сервере, откатывая весь некорректный пакет', async () => {
  const book = makeBook();
  await expect(
    push(
      [
        { kind: 'book', entity_id: book.id, payload: book, base_revision: 0 },
        { kind: 'book', entity_id: uid(), payload: book, base_revision: 0 },
      ],
      uid(),
    ),
  ).rejects.toThrow();
  expect(await pull()).toHaveLength(0);
  await a.personal_books.put(book);
  await engine(a).sync();
  await pg.exec('reset role;');
  await pg.query('update public.club_members set active=false where id=$1', [alice]);
  await role();
  expect(await pull()).toHaveLength(0);
  await expect(push([], uid())).rejects.toThrow();
  await pg.exec('reset role;');
  await pg.query('update public.club_members set active=true where id=$1', [alice]);
});
it('синхронизирует профиль и независимые настройки приватности в общей учётной записи', async () => {
  await pg.query("select public.club_action('profile',$1::jsonb)", [
    JSON.stringify({ name: 'Анна', bio: 'Обновление с телефона', genres: 'Фантастика' }),
  ]);
  await pg.query('select public.sync_privacy_settings($1::jsonb,$2)', [
    JSON.stringify({ show_quotes: true }),
    10,
  ]);
  await pg.query('select public.sync_privacy_settings($1::jsonb,$2)', [
    JSON.stringify({ show_reviews: true }),
    11,
  ]);
  const profile = (
    await pg.query<{ bio: string }>('select * from public.member_profiles where member_id=$1', [
      alice,
    ])
  ).rows[0];
  expect(profile.bio).toBe('Обновление с телефона');
  const privacy = (
    await pg.query<{ show_quotes: boolean; show_reviews: boolean }>(
      'select * from public.member_privacy_settings',
    )
  ).rows[0];
  expect(privacy.show_quotes && privacy.show_reviews).toBe(true);
});
it('первоначальный администратор определяется сервером, включая уже существующего участника', async () => {
  await expect(pg.query('select public.resolve_telegram_member(42,true)')).rejects.toThrow();
  await pg.exec('reset role;set role service_role;');
  const result = (
    await pg.query<{ member: { id: string; role: string } }>(
      'select public.resolve_telegram_member(42,true) member',
    )
  ).rows[0].member;
  expect(result.id).toBe(alice);
  expect(result.role).toBe('admin');
  await pg.exec('reset role;');
  await pg.query("update public.club_members set role='member' where id=$1", [alice]);
});
