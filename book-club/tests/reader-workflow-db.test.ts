// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { uid, now } from '../src/domain';
let db: PGlite;
const admin = '10000000-0000-4000-8000-000000000001',
  alice = '10000000-0000-4000-8000-000000000002',
  bob = '10000000-0000-4000-8000-000000000003',
  device = '90000000-0000-4000-8000-000000000001';
async function actor(id: string) {
  await db.exec(`reset role;set role authenticated;set request.jwt.claim.sub='${id}';`);
}
async function rows(sql: string, values: unknown[] = []) {
  return (await db.query<any>(sql, values)).rows;
}
async function act(name: string, value: unknown) {
  return (
    await rows('select public.club_action($1,$2::jsonb) result', [name, JSON.stringify(value)])
  )[0].result;
}
async function sync(kind: string, id: string, payload: unknown) {
  const old = (
    await rows(
      'select revision from public.private_library_records where kind=$1 and entity_id=$2',
      [kind, id],
    )
  )[0];
  return rows('select public.sync_private_library($1::jsonb,$2::uuid)', [
    JSON.stringify([{ kind, entity_id: id, payload, base_revision: Number(old?.revision || 0) }]),
    device,
  ]);
}
async function share(kind: string, id: string, payload: unknown, version = Date.now() * 1000) {
  return rows('select public.sync_public($1,$2,$3::jsonb,$4)', [
    kind,
    id,
    payload === null ? null : JSON.stringify(payload),
    version,
  ]);
}
async function reading() {
  const id = uid(),
    personal = uid();
  await actor(admin);
  await act('admin.book', {
    id,
    title: 'Книга ' + id,
    authors: 'Автор',
    totalPages: 300,
    status: 'reading',
  });
  const cycle = (
    await rows("select * from public.club_readings where book_id=$1 and status='active'", [id])
  )[0];
  await actor(alice);
  const book = {
    id: personal,
    clubBookId: id,
    title: 'Моё издание',
    authors: 'Автор',
    totalPages: 300,
    notes: 'Приватный текст',
    status: 'reading',
    publishReview: false,
    publishProgress: false,
    createdAt: now(),
    updatedAt: now(),
  };
  await sync('book', personal, book);
  await sync('progress', personal, { bookId: personal, pages: 0, updatedAt: now() });
  return { id, personal, cycle: cycle.id as string, book };
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    "create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;alter default privileges in schema public grant all on tables to anon,authenticated;",
  );
  for (const file of readdirSync('supabase/migrations')
    .filter((f) => f.endsWith('.sql'))
    .sort())
    await db.exec(readFileSync('supabase/migrations/' + file, 'utf8'));
  for (const [id, role, telegram] of [
    [admin, 'admin', 1],
    [alice, 'member', 2],
    [bob, 'member', 3],
  ] as const) {
    await db.query('insert into auth.users values($1)', [id]);
    await db.query(
      'insert into public.club_members(id,auth_user_id,telegram_id,role) values($1,$1,$2,$3)',
      [id, telegram, role],
    );
    await db.query('insert into public.member_profiles(member_id,name) values($1,$2)', [
      id,
      role === 'admin' ? 'Админ' : id === alice ? 'Алиса' : 'Борис',
    ]);
    await db.query('insert into public.member_privacy_settings(member_id) values($1)', [id]);
  }
});
afterAll(async () => {
  await db?.close();
});

it('новые заметки owner-only; публикация копирует только разрешённые поля и снимается при отключении', async () => {
  const { personal, id } = await reading(),
    entryId = uid();
  const entry = {
    id: entryId,
    bookId: personal,
    kind: 'note',
    text: 'Наблюдение',
    page: 12,
    chapter: 'Глава 1',
    published: false,
    deletedAt: null,
    createdAt: now(),
    updatedAt: now(),
  };
  await sync('entry', entryId, entry);
  await actor(admin);
  expect(
    await rows("select * from public.private_library_records where kind='entry' and entity_id=$1", [
      entryId,
    ]),
  ).toHaveLength(0);
  expect(await rows('select * from public.club_entries where id=$1', [entryId])).toHaveLength(0);
  await actor(alice);
  await sync('entry', entryId, { ...entry, published: true });
  await actor(bob);
  const published = (await rows('select * from public.club_entries where id=$1', [entryId]))[0];
  expect(published).toMatchObject({ book_id: id, text: 'Наблюдение', page: 12 });
  expect(JSON.stringify(published)).not.toContain('Приватный текст');
  await expect(
    rows(
      "insert into public.public_entries(id,member_id,title,kind,text) values($1,$2,'Книга','note','Подмена')",
      [uid(), bob],
    ),
  ).rejects.toThrow();
  await actor(alice);
  await sync('entry', entryId, { ...entry, published: false });
  await actor(bob);
  expect(await rows('select * from public.club_entries where id=$1', [entryId])).toHaveLength(0);
});

it('цитата без книги публикуется без фиктивной книги; старая очередь не возвращает удалённое', async () => {
  await actor(alice);
  const id = uid();
  await sync('quote', id, {
    id,
    bookId: null,
    text: 'Отдельная цитата',
    attribution: 'Источник',
    page: null,
    chapter: '',
    comment: '',
    favorite: false,
    published: true,
    deletedAt: null,
    sourceId: null,
    sourceAuthor: null,
    createdAt: now(),
    updatedAt: now(),
  });
  const v = Date.now() * 1000;
  await share('quote', id, { text: 'Подменённый текст' }, v);
  await actor(bob);
  expect((await rows('select * from public.club_quotes where id=$1', [id]))[0]).toMatchObject({
    text: 'Отдельная цитата',
    book_id: null,
    title: '',
    source_label: 'Источник',
  });
  await actor(alice);
  await sync('quote', id, null);
  await share('quote', id, { text: 'Старая очередь' }, v + 1);
  expect(await rows('select * from public.club_quotes where id=$1', [id])).toHaveLength(0);
});

it('отказ скрывает прогресс и запрещает новые публикации только во время активного чтения', async () => {
  const { id, personal, cycle } = await reading(),
    entry = uid();
  await act('reading.participation', { reading_id: cycle, choice: 'declined' });
  expect(await rows('select * from public.visible_progress where book_id=$1', [id])).toHaveLength(
    0,
  );
  expect(
    (
      await rows('select * from public.visible_reading_participation where reading_id=$1', [cycle])
    )[0].choice,
  ).toBe('declined');
  await sync('entry', entry, {
    id: entry,
    bookId: personal,
    kind: 'thought',
    text: 'Поздняя мысль',
    page: null,
    chapter: '',
    published: true,
    deletedAt: null,
    createdAt: now(),
    updatedAt: now(),
  });
  await expect(share('entry', entry, { explicit_share: true })).rejects.toThrow(/смените статус/);
  expect(await rows('select * from public.club_entries where id=$1', [entry])).toHaveLength(0);
  await actor(admin);
  await act('admin.book', {
    id,
    title: 'Книга ' + id,
    authors: 'Автор',
    totalPages: 300,
    status: 'finished',
  });
  await actor(alice);
  await share('entry', entry, { explicit_share: true });
  expect(await rows('select * from public.club_entries where id=$1', [entry])).toHaveLength(1);
});

it('отзыв становится публичным только после завершения или бросания, приватные заметки не уходят', async () => {
  const { personal, book } = await reading();
  await sync('book', personal, { ...book, publishReview: true });
  await sync('review', personal, {
    bookId: personal,
    rating: 4,
    text: 'Мой отзыв',
    spoilers: false,
    updatedAt: now(),
  });
  const v = Date.now() * 1000;
  await share('review', personal, { explicit_share: true }, v);
  expect(await rows('select * from public.club_reviews where id=$1', [personal])).toHaveLength(0);
  await sync('book', personal, { ...book, publishReview: true, status: 'abandoned' });
  await share('review', personal, { explicit_share: true }, v + 1);
  expect(
    (await rows('select * from public.club_reviews where id=$1', [personal]))[0],
  ).toMatchObject({ rating: 4, text: 'Мой отзыв' });
});
it('одна реакция переключается между лайком и дизлайком, комментарии закрываются вместе с публикацией', async () => {
  const { personal } = await reading(),
    entry = uid(),
    comment = uid();
  const payload = {
    id: entry,
    bookId: personal,
    kind: 'thought',
    text: 'Законченная мысль',
    page: null,
    chapter: '',
    published: true,
    deletedAt: null,
    createdAt: now(),
    updatedAt: now(),
  };
  await sync('entry', entry, payload);
  await actor(bob);
  await act('content.reaction', { target_kind: 'thought', target_id: entry, value: 1 });
  await act('content.reaction', { target_kind: 'thought', target_id: entry, value: -1 });
  expect(
    await rows('select value from public.content_reactions where target_id=$1', [entry]),
  ).toEqual([{ value: -1 }]);
  await act('content.comment', {
    id: comment,
    target_kind: 'thought',
    target_id: entry,
    text: 'А я думаю иначе',
  });
  await actor(alice);
  await act('content.reaction', { target_kind: 'comment', target_id: comment, value: 1 });
  await expect(
    act('content.comment', {
      id: comment,
      target_kind: 'thought',
      target_id: entry,
      text: 'Подмена автора',
    }),
  ).rejects.toThrow();
  await sync('entry', entry, { ...payload, published: false });
  await actor(bob);
  expect(await rows('select * from public.content_comments where id=$1', [comment])).toHaveLength(
    0,
  );
  expect(
    await rows('select * from public.content_reactions where target_id in ($1,$2)', [
      entry,
      comment,
    ]),
  ).toHaveLength(0);
  await expect(
    act('content.comment', {
      id: uid(),
      target_kind: 'thought',
      target_id: entry,
      text: 'В закрытое',
    }),
  ).rejects.toThrow();
});
it('отчёт считает только новые обновления прогресса, различает время суток и не раскрывает личные книги', async () => {
  const { id, personal, cycle, book } = await reading();
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  await actor(admin);
  await act('admin.reading', {
    id: cycle,
    book_id: id,
    starts_on: new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10),
    ends_on: null,
    position: 0,
    status: 'active',
  });
  await actor(alice);
  await sync('progress', personal, {
    bookId: personal,
    pages: 20,
    updatedAt: yesterday + 'T09:00:00.000Z',
  });
  await sync('progress', personal, {
    bookId: personal,
    pages: 30,
    updatedAt: yesterday + 'T18:00:00.000Z',
  });
  await sync('progress', personal, { bookId: personal, pages: 15, updatedAt: now() });
  await sync('book', personal, { ...book, totalPages: 600 });
  await sync('progress', personal, { bookId: personal, pages: 30, updatedAt: now() });
  const last = { bookId: personal, pages: 45, updatedAt: now() };
  await sync('progress', personal, last);
  await sync('progress', personal, last);
  const other = uid();
  await sync('book', other, { ...book, id: other, clubBookId: null, title: 'Личная тайна' });
  await sync('progress', other, { bookId: other, pages: 100, updatedAt: now() });
  await actor(bob);
  expect(await rows('select * from public.reading_activity where book_id=$1', [id])).toHaveLength(
    0,
  );
  await expect(act('admin.reading_report', { book_id: id })).rejects.toThrow(/администратор/);
  await actor(admin);
  const report = await act('admin.reading_report', { book_id: id });
  expect(report.activity).toMatchObject({ pages_logged: 45, updates: 3, corrections: 2 });
  expect(report.periods.find((p: any) => p.label.startsWith('День')).pages).toBe(20);
  expect(report.periods.find((p: any) => p.label.startsWith('Вечер')).pages).toBe(10);
  expect(JSON.stringify(report)).not.toContain('Личная тайна');
  expect(report.readers.find((p: any) => p.member_id === alice)).toMatchObject({
    pages: 45,
    total_pages: 600,
  });
});

it('ранее прочитавший исключается из гонки, завершение идемпотентно и история остаётся после нового цикла', async () => {
  const { id, personal, cycle, book } = await reading();
  await sync('book', personal, { ...book, status: 'finished', completedAt: now() });
  await sync('book', personal, {
    ...book,
    status: 'finished',
    completedAt: now(),
    notes: 'Правка заметок',
  });
  await actor(bob);
  await act('reading.participation', { reading_id: cycle, choice: 'already_read' });
  const second = uid();
  await sync('book', second, { ...book, id: second, status: 'finished', completedAt: now() });
  await sync('progress', second, { bookId: second, pages: 300, updatedAt: now() });
  await actor(admin);
  const report = await act('admin.reading_report', { book_id: id });
  expect(report.finishers).toHaveLength(1);
  expect(report.finishers[0].member_id).toBe(alice);
  expect(report.readers.find((p: any) => p.member_id === bob).choice).toBe('already_read');
  await act('admin.book', {
    id,
    title: 'Книга ' + id,
    authors: 'Автор',
    totalPages: 300,
    status: 'finished',
  });
  await act('admin.current_book', { book_id: id, active: true });
  const old = await act('admin.reading_report', { book_id: id, reading_id: cycle });
  expect(old.finishers[0].member_id).toBe(alice);
});
