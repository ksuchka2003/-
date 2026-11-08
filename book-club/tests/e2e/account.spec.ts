import { openBookEditor, editOpenBook } from './helpers';
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import type { LibraryChange, LibraryRecord } from '../../src/privateTypes';
import type { Availability, Attendance } from '../../src/calendar';
import type { Meeting } from '../../src/domain';
import { clubDay } from '../../src/calendar';

const owner = '10000000-0000-4000-8000-000000000001';
function backend() {
  let revision = 0;
  const records = new Map<string, LibraryRecord>();
  let profile = {
    member_id: owner,
    name: 'Анна',
    bio: '',
    genres: '',
    joined_at: new Date().toISOString(),
  };
  const privacy = {
    member_id: owner,
    show_finished: false,
    show_current: false,
    show_progress: false,
    show_ratings: false,
    show_reviews: false,
    show_quotes: false,
  };
  const publications: any[] = [];
  const extra: Record<string, unknown[]> = {};
  const availability: Availability[] = [];
  const meetings: Meeting[] = [];
  const attendance: Attendance[] = [];
  const participants = [
    { member_id: owner, name: 'Анна' },
    { member_id: '10000000-0000-4000-8000-000000000002', name: 'Борис' },
  ];
  let failAvailability = false;
  async function connect(context: BrowserContext, failLogin = false) {
    await context.addInitScript(() => {
      window.Telegram = {
        WebApp: {
          initData: 'server-stub-init-data',
          colorScheme: 'light',
          ready() {},
          expand() {},
          onEvent() {},
          offEvent() {},
        },
      };
    });
    await context.route('https://telegram.org/**', (route) => route.abort());
    await context.route('https://bookclub.test.invalid/**', async (route) => {
      const request = route.request();
      const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      const url = new URL(request.url());
      let body: unknown = [];
      if (url.pathname.endsWith('/telegram-auth')) {
        if (failLogin)
          return route.fulfill({
            status: 403,
            headers,
            json: { error: 'Вы не включены в список участников клуба' },
          });
        body = {
          access_token: 'server-stub-session',
          expires_at: Date.now() / 1000 + 600,
          member: { id: owner, role: 'admin', telegramId: '42' },
        };
      } else if (url.pathname.endsWith('/club-api')) {
        const input = request.postDataJSON();
        if (input.action === 'private.sync') {
          body = input.data.changes.map((change: LibraryChange) => {
            const key = change.kind + ':' + change.entity_id;
            const old = records.get(key);
            if (old && JSON.stringify(old.payload) === JSON.stringify(change.payload))
              return { status: 'applied', record: old };
            if ((old?.revision || 0) !== change.base_revision)
              return { status: 'conflict', record: old };
            const record = {
              kind: change.kind,
              entity_id: change.entity_id,
              payload: change.payload,
              revision: ++revision,
              device_id: input.data.device,
            };
            records.set(key, record);
            return { status: 'applied', record };
          });
          if (
            input.data.changes.some(
              (c: LibraryChange) => c.kind === 'book' || c.kind === 'progress',
            )
          ) {
            const projected = (extra.visible_progress || []).filter(
              (p: any) => p.member_id !== owner,
            );
            for (const record of records.values()) {
              const b = record.payload as any;
              if (record.kind !== 'book' || !b?.clubBookId || b.deletedAt) continue;
              const p = records.get('progress:' + record.entity_id)?.payload as any;
              projected.push({
                id: record.entity_id,
                member_id: owner,
                book_id: b.clubBookId,
                title: b.title,
                status: b.status,
                pages: p?.pages || 0,
                total_pages: b.totalPages,
                chapter: p?.chapter || '',
                cover: b.coverData || b.cover || '',
                updated_at: new Date().toISOString(),
              });
            }
            extra.visible_progress = projected;
          }
        } else if (input.action.startsWith('meeting.question')) {
          const rows = (extra.meeting_questions ||= []) as any[];
          const index = rows.findIndex((q) => q.id === input.data.id);
          const old = rows[index];
          if (input.action === 'meeting.question.delete') {
            if (index >= 0) rows.splice(index, 1);
          } else if (input.action === 'meeting.question.answered') {
            rows[index] = { ...old, answered: input.data.answered, version: old.version + 1 };
          } else {
            const record = {
              ...input.data,
              member_id: owner,
              answered: old?.answered || false,
              version: (old?.version || 0) + 1,
              created_at: old?.created_at || new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };
            if (index >= 0) rows[index] = record;
            else rows.push(record);
          }
          body = { ok: true };
        } else if (input.action.startsWith('meeting.reflection')) {
          const rows = (extra.meeting_reflections ||= []) as any[];
          const index = rows.findIndex((q) =>
            input.action.endsWith('.delete')
              ? q.id === input.data.id
              : q.meeting_id === input.data.meeting_id && q.member_id === owner,
          );
          const old = rows[index];
          if (input.action.endsWith('.delete')) {
            if (index >= 0) rows.splice(index, 1);
          } else {
            const record = {
              ...input.data,
              member_id: owner,
              version: (old?.version || 0) + 1,
              created_at: old?.created_at || new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };
            if (index >= 0) rows[index] = record;
            else rows.push(record);
          }
          body = { ok: true };
        } else if (input.action === 'admin.current_book') {
          const b = (extra.club_books as any[])?.find((b) => b.id === input.data.book_id);
          if (b) b.status = input.data.active ? 'reading' : 'planned';
          const rs = (extra.club_readings ||= []) as any[];
          const active = rs.find((r) => r.book_id === input.data.book_id && r.status === 'active');
          if (input.data.active && !active)
            rs.push({
              id: crypto.randomUUID(),
              book_id: input.data.book_id,
              starts_on: clubDay(),
              ends_on: null,
              position: rs.length,
              status: 'active',
            });
          if (!input.data.active && active) active.status = 'cancelled';
          publications.push(input);
          body = { ok: true };
        } else if (input.action === 'availability') {
          if (failAvailability)
            return route.fulfill({
              status: 400,
              headers,
              json: { error: 'Не удалось сохранить время. Повторите' },
            });
          const index = availability.findIndex(
            (a) => a.day === input.data.day && a.member_id === owner,
          );
          if (index >= 0) availability.splice(index, 1);
          if (input.data.status) availability.push({ ...input.data, member_id: owner });
          body = { ok: true };
        } else if (input.action === 'admin.meeting') {
          const index = meetings.findIndex((m) => m.id === input.data.id);
          const old = meetings[index];
          const changed = old && old.starts_at !== input.data.starts_at;
          const record = {
            ...input.data,
            version: (old?.version || 0) + 1,
            schedule_version: (old?.schedule_version || 1) + (changed ? 1 : 0),
          };
          if (index >= 0) meetings[index] = record;
          else meetings.push(record);
          body = { ok: true };
        } else if (input.action === 'attendance') {
          const index = attendance.findIndex(
            (a) => a.meeting_id === input.data.meeting_id && a.member_id === owner,
          );
          if (index >= 0) attendance.splice(index, 1);
          attendance.push({ ...input.data, member_id: owner });
          body = { ok: true };
        } else if (input.action === 'book.search') {
          body = extra.book_search || [];
        } else if (input.action === 'like') {
          const rows = (extra.quote_likes ||= []) as any[];
          const index = rows.findIndex(
            (l) => l.quote_id === input.data.quote_id && l.member_id === owner,
          );
          if (index >= 0) rows.splice(index, 1);
          if (input.data.liked) rows.push({ quote_id: input.data.quote_id, member_id: owner });
          body = { ok: true };
        } else if (input.action === 'profile') {
          profile = { ...profile, ...input.data };
          body = { ok: true };
        } else {
          publications.push(input);
          body = { ok: true };
        }
      } else {
        const table = url.pathname.split('/').at(-1);
        body =
          table === 'meeting_availability'
            ? availability
            : table === 'meeting_participants'
              ? participants
              : table === 'meetings'
                ? meetings
                : table === 'meeting_attendance'
                  ? attendance
                  : table === 'private_library_records'
                    ? [...records.values()]
                    : table === 'member_profiles'
                      ? [profile, ...(extra.member_profiles || [])]
                      : table === 'member_privacy_settings'
                        ? [privacy]
                        : extra[table || ''] ||
                          extra[
                            (
                              {
                                club_quotes: 'public_quotes',
                                club_reviews: 'visible_reviews',
                              } as Record<string, string>
                            )[table || '']
                          ] ||
                          [];
      }
      await route.fulfill({ headers, json: body });
    });
  }
  return {
    records,
    publications,
    extra,
    connect,
    availability,
    attendance,
    meetings,
    participants,
    failAvailability: () => {
      failAvailability = true;
    },
  };
}
async function synced(page: Page) {
  await expect(page.locator('.connection-bar')).toContainText('Синхронизировано');
}
test('вход работает в мобильном WebView без AbortSignal.timeout и AbortSignal.any', async ({
  browser,
  baseURL,
}) => {
  const api = backend();
  const context = await browser.newContext({ baseURL });
  try {
    await api.connect(context);
    await context.addInitScript(() => {
      Object.defineProperty(AbortSignal, 'timeout', { value: undefined, configurable: true });
      Object.defineProperty(AbortSignal, 'any', { value: undefined, configurable: true });
    });
    const page = await context.newPage();
    await page.goto('/#/profile');
    await expect(page.getByRole('heading', { name: 'Анна', exact: true })).toBeVisible();
    await expect(page.getByText('Нет связи с клубом.', { exact: false })).not.toBeVisible();
    await expect(page.getByRole('link', { name: 'Управление клубом', exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
});
test('один Telegram-аккаунт на двух устройствах: книги, заметки, цитаты, профиль, офлайн и удаление', async ({
  browser,
  baseURL,
}) => {
  const api = backend();
  const first = await browser.newContext({ baseURL });
  const second = await browser.newContext({ baseURL });
  try {
    await api.connect(first);
    await api.connect(second);
    const a = await first.newPage();
    const b = await second.newPage();
    await a.goto('/#/books');
    await synced(a);
    await a.getByRole('button', { name: 'Добавить', exact: true }).click();
    const form = a.getByRole('dialog');
    await a.getByRole('button', { name: 'Добавить вручную', exact: true }).click();
    await form.getByLabel('Название', { exact: true }).fill('Синхронная книга');
    await form.getByText('Данные издания — необязательно', { exact: true }).click();
    await form.getByText('Моё чтение', { exact: true }).click();
    await form.getByLabel('Страниц в моём издании').fill('400');
    await form.getByText('Отзыв, оценка и заметки', { exact: true }).click();
    await form.getByLabel('Прочитано страниц').fill('100');
    await form.getByLabel('Приватные заметки').fill('Только для владельца');
    await form.getByRole('button', { name: 'Сохранить книгу' }).click();
    await expect.poll(() => api.records.size).toBeGreaterThanOrEqual(3);
    await synced(a);
    await b.goto('/#/books');
    await expect(b.getByRole('heading', { name: 'Синхронная книга' })).toBeVisible();
    await openBookEditor(b, 'Синхронная книга');
    await b.getByText('Отзыв, оценка и заметки', { exact: true }).click();
    await expect(b.getByLabel('Приватные заметки')).toHaveValue('Только для владельца');
    await b.getByRole('button', { name: 'Назад', exact: true }).click();
    await a.goto('/#/quotes');
    await a.getByRole('button', { name: 'Добавить', exact: true }).click();
    await a.getByLabel('Название книги', { exact: true }).fill('Синхронная');
    await a.getByRole('option', { name: /Синхронная книга/ }).click();
    await a.getByLabel('Текст цитаты').fill('Личная цитата между устройствами');
    await a.getByRole('button', { name: 'Сохранить цитату' }).click();
    await expect
      .poll(() => [...api.records.values()].filter((r) => r.kind === 'quote').length)
      .toBe(1);
    await b.goto('/#/quotes');
    await b.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(b.getByText('Личная цитата между устройствами', { exact: true })).toBeVisible();
    await a.goto('/#/profile');
    await a.getByRole('button', { name: 'Редактировать профиль' }).click();
    await a.getByLabel('О себе').fill('Описание с первого устройства');
    await a.getByRole('dialog').getByRole('button', { name: 'Сохранить', exact: true }).click();
    await b.goto('/#/profile');
    await b.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(b.getByText('Описание с первого устройства', { exact: true })).toBeVisible();
    await expect(b.getByRole('link', { name: 'Управление клубом' })).toBeVisible();
    await first.setOffline(true);
    await a.goto('/#/books');
    await openBookEditor(a, 'Синхронная книга');
    await a.getByLabel('Прочитано страниц').fill('200');
    await a.getByRole('button', { name: 'Сохранить книгу' }).click();
    await expect(a.getByText('50%', { exact: true })).toBeVisible();
    await expect(a.locator('.connection-bar')).toContainText('Нет сети');
    await first.setOffline(false);
    await expect
      .poll(() => [...api.records.values()].find((r) => r.kind === 'progress')?.payload?.pages)
      .toBe(200);
    await synced(a);
    await b.goto('/#/books');
    await b.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(b.getByText('50%', { exact: true })).toBeVisible();
    await openBookEditor(a, 'Синхронная книга');
    a.once('dialog', (d) => d.accept());
    await a.getByRole('dialog').getByRole('button', { name: 'В корзину', exact: true }).click();
    await expect
      .poll(() => [...api.records.values()].find((r) => r.kind === 'book')?.payload?.deletedAt)
      .toBeTruthy();
    await synced(a);
    await b.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(b.getByRole('heading', { name: 'Пока нет книг' })).toBeVisible();
    expect(api.publications).toEqual([]);
  } finally {
    await first.close();
    await second.close();
  }
});
test('книга из клуба открывается напрямую, быстрый прогресс и корзина с цитатами синхронизируются', async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  const api = backend(),
    clubId = '20000000-0000-4000-8000-000000000019';
  api.extra.club_books = [
    {
      id: clubId,
      title: 'Короткий путь',
      authors: 'Автор',
      description: '',
      genre: '',
      year: null,
      isbn: '',
      cover: '',
      default_pages: 300,
      status: 'reading',
    },
  ];
  await api.connect(context);
  await page.goto('/#/club/' + clubId);
  await page.getByRole('button', { name: 'В мои книги', exact: true }).click();
  await page.getByRole('link', { name: 'Уже на моей полке', exact: true }).click();
  await editOpenBook(page);
  let dialog = page.getByRole('dialog', { name: 'Моя книга', exact: true });
  await expect(dialog.getByLabel('Название', { exact: true })).toHaveValue('Короткий путь');
  await dialog.getByText('Отзыв, оценка и заметки', { exact: true }).click();
  await dialog.getByLabel('Приватные заметки').fill('Важная заметка');
  await dialog.getByRole('button', { name: 'Сохранить книгу', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.goto('/#/club/' + clubId);
  await page.getByRole('button', { name: 'Оставить впечатление', exact: true }).click();
  await page.getByLabel('Что осталось после книги?').fill('Незаконченный отзыв');
  await page.getByRole('dialog').getByRole('button', { name: 'Назад', exact: true }).click();
  await page.getByRole('button', { name: 'Оставить впечатление', exact: true }).click();
  await expect(page.getByLabel('Что осталось после книги?')).toHaveValue('Незаконченный отзыв');
  await page.getByRole('button', { name: 'Сохранить впечатление', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.goto('/#/');
  await page.getByRole('link', { name: 'Обновить мой прогресс', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Мой прогресс', exact: true });
  await expect(dialog.getByLabel('Приватные заметки')).toHaveCount(0);
  await dialog.getByLabel('Прочитано страниц').fill('150');
  await dialog.getByLabel('Текущая глава').fill('Глава 3');
  await page.setViewportSize({ width: 320, height: 760 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '../../work/quick-progress-mobile.png', fullPage: true });
  await dialog.getByRole('button', { name: 'Сохранить прогресс', exact: true }).click();
  await expect(page.getByText('50%', { exact: true })).toBeVisible();
  await expect
    .poll(() =>
      [...api.records.values()].some(
        (r) => r.kind === 'progress' && r.payload?.chapter === 'Глава 3',
      ),
    )
    .toBe(true);
  await page.goto('/#/quotes');
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await page.getByLabel('Название книги', { exact: true }).fill('Короткий путь');
  await page.getByLabel('Текст цитаты').fill('Эта цитата должна восстановиться');
  await page.getByRole('button', { name: 'Сохранить цитату', exact: true }).click();
  await expect.poll(() => [...api.records.values()].some((r) => r.kind === 'quote')).toBe(true);
  await page.goto('/#/books');
  await openBookEditor(page, 'Короткий путь');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'В корзину', exact: true }).click();
  await expect
    .poll(() => [...api.records.values()].some((r) => r.kind === 'book' && r.payload?.deletedAt))
    .toBe(true);
  await page.getByRole('button', { name: 'Корзина · 1', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '../../work/book-trash-mobile.png', fullPage: true });
  const second = await browser.newContext({ baseURL });
  try {
    await api.connect(second);
    const other = await second.newPage();
    await other.goto('/#/books');
    await expect(other.getByRole('button', { name: 'Корзина · 1', exact: true })).toBeVisible();
    await other.getByRole('button', { name: 'Корзина · 1', exact: true }).click();
    await expect(other.getByRole('heading', { name: 'Короткий путь', exact: true })).toBeVisible();
    await other.getByRole('button', { name: 'Восстановить книгу', exact: true }).click();
    await other.getByRole('button', { name: 'К библиотеке', exact: true }).click();
    await openBookEditor(other, 'Короткий путь');
    await other.getByText('Отзыв, оценка и заметки', { exact: true }).click();
    await expect(other.getByLabel('Приватные заметки')).toHaveValue('Важная заметка');
    await expect(other.getByLabel('Прочитано страниц')).toHaveValue('150');
    await expect(other.getByLabel('Текущая глава')).toHaveValue('Глава 3');
    await other.goto('/#/quotes');
    await expect(other.locator('blockquote')).toHaveText('Эта цитата должна восстановиться');
    expect(api.publications).toEqual([]);
  } finally {
    await second.close();
  }
});

test('UX: единый поиск открывает существующие книги и сохраняет UUID клуба для интернет-издания', async ({
  page,
  context,
}) => {
  const api = backend(),
    id = '20000000-0000-4000-8000-000000000031';
  api.extra.club_books = [
    {
      id,
      title: 'Дюна',
      authors: 'Фрэнк Герберт',
      description: '',
      genre: '',
      year: null,
      isbn: '',
      cover: '',
      default_pages: 600,
      status: 'reading',
    },
  ];
  api.extra.book_search = [
    {
      title: 'Дюна',
      authors: 'Фрэнк Герберт',
      description: '',
      genre: '',
      year: 1999,
      isbn: '',
      cover: '',
      totalPages: 480,
    },
  ];
  await api.connect(context);
  await page.goto('/#/books');
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  let form = page.getByRole('dialog', { name: 'Добавить книгу', exact: true });
  await expect(form.getByRole('textbox')).toHaveCount(1);
  await form.getByLabel('Найти книгу').fill('Дюна');
  await expect(form.getByRole('region', { name: 'В клубе', exact: true })).toBeVisible();
  await form.getByRole('region', { name: 'В интернете', exact: true }).getByRole('button').click();
  await expect(form.getByRole('heading', { name: 'Дюна', exact: true })).toBeVisible();
  await expect(form.getByLabel('Название', { exact: true })).not.toBeVisible();
  await form.getByRole('button', { name: 'Сохранить книгу', exact: true }).click();
  await expect(form).not.toBeVisible();
  await expect
    .poll(() => [...api.records.values()].find((r) => r.kind === 'book')?.payload?.clubBookId)
    .toBe(id);
  expect([...api.records.values()].find((r) => r.kind === 'book')?.payload?.totalPages).toBe(480);
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  form = page.getByRole('dialog', { name: 'Добавить книгу', exact: true });
  await form.getByRole('region', { name: 'Уже у меня', exact: true }).getByRole('button').click();
  const card = page.getByRole('dialog', { name: 'Карточка книги', exact: true });
  await expect(card.getByRole('button', { name: 'Добавить цитату', exact: true })).toBeVisible();
  await expect(card.getByLabel('Название', { exact: true })).toHaveCount(0);
  expect([...api.records.values()].filter((r) => r.kind === 'book' && r.payload)).toHaveLength(1);
});

test('UX: карточка создаёт цитату без повторного выбора книги и сохраняет мысли на втором устройстве', async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  const api = backend(),
    id = '20000000-0000-4000-8000-000000000032';
  api.extra.club_books = [
    {
      id,
      title: 'Удобная книга',
      authors: 'Автор',
      description: '',
      genre: '',
      year: null,
      isbn: '',
      cover: '',
      default_pages: 240,
      status: 'reading',
    },
  ];
  await api.connect(context);
  await page.goto('/#/books');
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await page.getByRole('region', { name: 'В клубе', exact: true }).getByRole('button').click();
  await page.getByRole('button', { name: 'Сохранить книгу', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page
    .locator('.personal-book-card')
    .getByRole('heading', { name: 'Удобная книга', exact: true })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Добавить цитату', exact: true })
    .click();
  await expect(page.getByLabel('Название книги', { exact: true })).toHaveCount(0);
  await page.getByLabel('Текст цитаты').fill('Цитата без лишних шагов');
  await page.getByRole('button', { name: 'Сохранить цитату', exact: true }).click();
  let card = page.getByRole('dialog', { name: 'Карточка книги', exact: true });
  await expect(card.locator('blockquote')).toHaveText('Цитата без лишних шагов');
  await card.getByRole('button', { name: 'Записать мысль', exact: true }).click();
  await page.getByLabel('Мой отзыв', { exact: true }).fill('Моё впечатление');
  await page.getByLabel('Приватные заметки').fill('Только для меня');
  await expect(page.getByLabel('Поделиться отзывом и оценкой в клубе')).not.toBeChecked();
  await page.getByRole('button', { name: 'Сохранить мысли', exact: true }).click();
  await expect(card.getByText('Только для меня', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 760 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '../../work/ux-personal-book.png', fullPage: true });
  await expect
    .poll(() =>
      [...api.records.values()].some(
        (r) => r.kind === 'book' && r.payload?.notes === 'Только для меня',
      ),
    )
    .toBe(true);
  const other = await browser.newContext({ baseURL });
  try {
    await api.connect(other);
    const second = await other.newPage();
    await second.goto('/#/books');
    await second
      .locator('.personal-book-card')
      .getByRole('heading', { name: 'Удобная книга', exact: true })
      .click();
    card = second.getByRole('dialog', { name: 'Карточка книги', exact: true });
    await expect(card.getByText('Моё впечатление', { exact: true })).toBeVisible();
    await expect(card.getByText('Только для меня', { exact: true })).toBeVisible();
    await expect(card.locator('blockquote')).toHaveText('Цитата без лишних шагов');
    expect(api.publications).toEqual([]);
  } finally {
    await other.close();
  }
});

test('UX: полка показывает одну панель счётчиков, сохраняет поиск и даёт сбросить пустой результат', async ({
  page,
  context,
}) => {
  const api = backend();
  for (const [i, status] of ['reading', 'finished', 'planned', 'paused'].entries()) {
    const id = '30000000-0000-4000-8000-00000000003' + i;
    api.records.set('book:' + id, {
      kind: 'book',
      entity_id: id,
      revision: i + 1,
      device_id: owner,
      payload: {
        id,
        clubBookId: null,
        title: 'Книга ' + status,
        authors: 'Автор',
        description: '',
        genre: '',
        year: null,
        isbn: '',
        cover: '',
        totalPages: 100,
        status,
        notes: '',
        publishProgress: false,
        publishReview: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });
  }
  await api.connect(context);
  await page.goto('/#/books');
  const tabs = page.getByRole('group', { name: 'Книги на полке', exact: true });
  await expect(tabs.getByRole('button', { name: 'Все 4', exact: true })).toBeVisible();
  await expect(tabs.getByRole('button')).toHaveCount(4);
  await expect(page.getByRole('group', { name: 'Фильтр статуса', exact: true })).toHaveCount(0);
  await tabs.getByRole('button', { name: 'Читаю 1', exact: true }).click();
  await expect(page.locator('.personal-book-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Фильтры книг', exact: true }).click();
  const filter = page.getByRole('dialog', { name: 'Фильтры книг', exact: true });
  await filter.getByRole('button', { name: 'Хочу прочитать', exact: true }).click();
  await filter.getByLabel('Сортировка').selectOption('title');
  await filter.getByRole('button', { name: 'Показать книги', exact: true }).click();
  await expect(page.locator('.personal-book-card')).toContainText('Книга planned');
  await page.getByLabel('Поиск моих книг').fill('planned');
  await page.goto('/#/profile');
  await page.goBack();
  await expect(page.getByLabel('Поиск моих книг')).toHaveValue('planned');
  await expect(page.locator('.personal-book-card')).toHaveCount(1);
  await page.setViewportSize({ width: 320, height: 760 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '../../work/ux-shelf-mobile.png', fullPage: true });
  await page.getByLabel('Поиск моих книг').fill('Нет такой книги');
  await page.getByRole('button', { name: 'Сбросить поиск и фильтры', exact: true }).click();
  await expect(page.locator('.personal-book-card')).toHaveCount(4);
});

test('ошибка авторизации видна, локальный режим включается только по выбору', async ({
  page,
  context,
}) => {
  await backend().connect(context, true);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Вход в книжный клуб' })).toBeVisible();
  await expect(page.getByText('Вы не включены в список участников клуба')).toBeVisible();
  await expect(page.locator('.bottom-nav')).not.toBeVisible();
  await page.getByRole('button', { name: 'Открыть локальную библиотеку' }).click();
  await page.goto('/#/books');
  await expect(page.getByRole('heading', { name: 'Пока нет книг' })).toBeVisible();
  await expect(page.locator('.connection-bar')).toContainText('Только на этом устройстве');
});

test('экран загрузки рассказывает о клубе и уступает место главной после входа', async ({
  page,
  context,
}) => {
  const api = backend();
  await api.connect(context);
  let release!: () => void;
  const hold = new Promise<void>((r) => (release = r));
  await context.route('**/functions/v1/telegram-auth', async (route) => {
    if (route.request().method() === 'POST') await hold;
    await route.fallback();
  });
  try {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Между строк', exact: true })).toBeVisible();
    await expect(page.getByText(/который зародился в Санкт-Петербурге/)).toBeVisible();
    await page.screenshot({ path: '../../work/club-intro-mobile.png', fullPage: true });
  } finally {
    release();
  }
  await expect(page.getByRole('heading', { name: 'Читаем сейчас', exact: true })).toBeVisible();
  await expect(page.locator('.club-intro')).toHaveCount(0);
});

test('администратор ищет книги и выбирает несколько главных галочками на узком экране', async ({
  page,
  context,
}) => {
  const api = backend(),
    a = '20000000-0000-4000-8000-000000000011',
    b = '20000000-0000-4000-8000-000000000012';
  api.extra.club_books = [
    {
      id: a,
      title: 'Длинное название книги для проверки аккуратной мобильной вёрстки',
      authors: 'Автор с длинным именем',
      cover: '',
      status: 'planned',
      default_pages: 200,
    },
    {
      id: b,
      title: 'Вторая книга',
      authors: 'Другой автор',
      cover: '',
      status: 'planned',
      default_pages: 300,
    },
  ];
  await api.connect(context);
  await page.setViewportSize({ width: 320, height: 760 });
  await page.goto('/#/admin');
  await page.getByRole('button', { name: 'Главные книги', exact: true }).click();
  await page.getByLabel('Поиск книг в управлении').fill('Длинное');
  await expect(page.locator('.current-book-choice')).toHaveCount(1);
  await page.getByRole('checkbox', { name: /Читаем сейчас: Длинное/ }).check();
  await expect(page.getByRole('checkbox', { name: /Читаем сейчас: Длинное/ })).toBeChecked();
  await page.getByLabel('Поиск книг в управлении').fill('');
  await page.getByRole('checkbox', { name: 'Читаем сейчас: Вторая книга', exact: true }).check();
  await expect(page.locator('.current-book-choice input:checked')).toHaveCount(2);
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.setViewportSize({ width: 320, height: 760 });
  await page.screenshot({ path: '../../work/admin-book-checkboxes.png', fullPage: true });
  await page.getByRole('checkbox', { name: 'Читаем сейчас: Вторая книга', exact: true }).uncheck();
  await expect(
    page.getByRole('checkbox', { name: 'Читаем сейчас: Вторая книга', exact: true }),
  ).not.toBeChecked();
  await page.getByRole('button', { name: 'Каталог', exact: true }).click();
  await page.getByLabel('Поиск книг в управлении').fill('Длинное');
  await expect(page.locator('.admin-book-row')).toHaveCount(1);
  await page.getByRole('button', { name: 'Изменить', exact: true }).click();
  const form = page.getByRole('dialog');
  await expect(form.getByLabel('ISBN', { exact: true })).toHaveCount(0);
  await expect(form.getByLabel('Обложка (HTTPS-ссылка)')).toHaveCount(0);
  expect(await form.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await form.getByRole('button', { name: 'Назад', exact: true }).click();
  expect(api.publications.filter((p) => p.action === 'admin.current_book')).toHaveLength(3);
});

test('главная открывается до завершения синхронизации личной библиотеки', async ({
  page,
  context,
}) => {
  const api = backend();
  await api.connect(context);
  let release!: () => void;
  const hold = new Promise<void>((r) => {
    release = r;
  });
  await context.route('**/functions/v1/club-api', async (route) => {
    if (
      route.request().method() === 'POST' &&
      route.request().postDataJSON().action === 'private.sync'
    )
      await hold;
    await route.fallback();
  });
  try {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Читаем сейчас', exact: true })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Следующая встреча', exact: true }),
    ).toBeVisible();
  } finally {
    release();
  }
});

test('поиск обложки сохраняет только картинку, ошибки поиска видны', async ({ page, context }) => {
  const api = backend();
  await api.connect(context);
  let fail = false;
  await context.route('**/functions/v1/club-api', async (route) => {
    if (
      route.request().method() === 'POST' &&
      route.request().postDataJSON().action === 'book.search'
    )
      return route.fulfill({
        status: fail ? 503 : 200,
        headers: { 'access-control-allow-origin': '*' },
        json: fail
          ? { error: 'Поиск временно недоступен' }
          : [
              {
                title: 'Другое издание',
                authors: 'Станислав Лем',
                cover: 'https://covers.example/solaris.jpg',
                totalPages: 999,
              },
            ],
      });
    await route.fallback();
  });
  await page.goto('/#/books');
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await page.getByRole('button', { name: 'Добавить вручную', exact: true }).click();
  await dialog.getByLabel('Название', { exact: true }).fill('Солярис');
  await dialog.getByRole('button', { name: 'Из интернета', exact: true }).click();
  await dialog.getByRole('button', { name: 'Найти обложки', exact: true }).click();
  await dialog
    .getByRole('button', { name: 'Выбрать: Другое издание, Станислав Лем', exact: true })
    .click();
  await expect(dialog.getByLabel('Название', { exact: true })).toHaveValue('Солярис');
  await dialog.getByRole('button', { name: 'Сохранить книгу', exact: true }).click();
  await expect
    .poll(() => [...api.records.values()].find((r) => r.kind === 'book')?.payload?.cover)
    .toBe('https://covers.example/solaris.jpg');
  expect([...api.records.values()].find((r) => r.kind === 'book')?.payload?.totalPages).toBe(0);
  await openBookEditor(page, 'Солярис');
  await dialog.getByRole('button', { name: 'Из интернета', exact: true }).click();
  fail = true;
  await dialog.getByLabel('Поиск обложки').fill('Неизвестное издание');
  await dialog.getByRole('button', { name: 'Найти обложки', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Поиск временно недоступен');
  await expect(dialog.getByLabel('Ссылка на картинку')).toHaveCount(0);
});

test('встреча администратора видна на главной, содержит место и ссылку без голосования о посещении', async ({
  page,
  context,
}) => {
  const api = backend();
  await api.connect(context);
  await page.goto('/#/meetings');
  await expect(page.getByRole('button', { name: 'Календарь', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Создать встречу', exact: true }).click();
  await page.getByLabel('Название встречи').fill('Обсуждаем финал');
  const date = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  await page.getByLabel('Дата и время · МСК').fill(date + 'T18:00');
  await page.getByLabel('Место', { exact: true }).fill('Кафе на углу');
  await page.getByLabel('Ссылка на место или созвон').fill('https://maps.example/place');
  await page.getByLabel('Описание', { exact: true }).fill('Приносите любимые цитаты');
  await page.getByRole('dialog').getByRole('button', { name: 'Создать встречу' }).click();
  await expect.poll(() => api.meetings.length).toBe(1);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Обсуждаем финал' })).toBeVisible();
  await expect(page.getByText('Приносите любимые цитаты', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Открыть место или созвон' })).toHaveAttribute(
    'href',
    'https://maps.example/place',
  );
  await expect(page.getByRole('button', { name: 'Ответить на приглашение' })).toHaveCount(0);
  await expect(page.getByText('Сможете прийти на встречу?')).toHaveCount(0);
  expect(api.attendance).toHaveLength(0);
  await page.setViewportSize({ width: 320, height: 760 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '../../work/simple-meeting-mobile.png', fullPage: true });
  await page.evaluate(() => (document.documentElement.dataset.theme = 'dark'));
  await page.screenshot({ path: '../../work/simple-meeting-dark.png', fullPage: true });
});

test('прогресс текущей книги открывает публикации только выбранного участника и книги', async ({
  page,
  context,
}) => {
  const api = backend();
  const id = '20000000-0000-4000-8000-000000000001',
    reader = '10000000-0000-4000-8000-000000000002';
  api.extra.club_books = [
    {
      id,
      title: 'Солярис',
      authors: 'Станислав Лем',
      description: '',
      genre: '',
      year: 1961,
      isbn: '',
      cover: '',
      default_pages: 300,
      status: 'reading',
    },
  ];
  api.extra.member_profiles = [
    {
      member_id: reader,
      name: 'Борис',
      avatar_url: null,
      bio: '',
      genres: '',
      joined_at: new Date().toISOString(),
    },
  ];
  api.extra.visible_progress = [
    {
      id: '30000000-0000-4000-8000-000000000001',
      book_id: id,
      member_id: reader,
      title: 'Солярис',
      status: 'finished',
      pages: 300,
      total_pages: 300,
      updated_at: new Date().toISOString(),
    },
  ];
  api.extra.public_quotes = [
    {
      id: '40000000-0000-4000-8000-000000000001',
      book_id: id,
      member_id: reader,
      title: 'Солярис',
      text: 'Цитата к обсуждаемой книге',
      page: 10,
      chapter: '',
      comment: 'Мой комментарий',
      updated_at: new Date().toISOString(),
    },
    {
      id: '40000000-0000-4000-8000-000000000002',
      book_id: '20000000-0000-4000-8000-000000000002',
      member_id: reader,
      title: 'Другая книга',
      text: 'Цитата к другой книге',
      updated_at: new Date().toISOString(),
    },
  ];
  api.extra.visible_reviews = [
    {
      id: '50000000-0000-4000-8000-000000000001',
      book_id: id,
      member_id: reader,
      title: 'Солярис',
      text: 'Хочется обсудить океан',
      rating: 9,
      spoilers: false,
      updated_at: new Date().toISOString(),
    },
  ];
  api.extra.club_reading_awards = [
    { id: 'award-first', book_id: id, member_id: reader, kind: 'first' },
  ];
  await api.connect(context);
  await page.goto('/#/club');
  await page.getByRole('button', { name: 'Открыть прогресс: Солярис' }).click();
  await expect(page.getByText('300 / 300 стр. · 100%', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Первый финиш: Солярис', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 760 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '../../work/club-readers-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Чтение Борис: Солярис' }).click();
  await expect(page.getByText('Цитата к обсуждаемой книге', { exact: true })).toBeVisible();
  await expect(page.getByText('Цитата к другой книге', { exact: true })).not.toBeVisible();
  await page.getByRole('button', { name: 'Мысли по прочитанному', exact: true }).click();
  await expect(page.getByText('Хочется обсудить океан', { exact: true })).toBeVisible();
});
test('цитата личной книги приватна по умолчанию, делится отдельно и отзывается', async ({
  page,
  context,
}) => {
  const api = backend();
  await api.connect(context);
  await page.goto('/#/quotes');
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await page.getByLabel('Название книги', { exact: true }).fill('Личная книга');
  await page.getByLabel('Текст цитаты').fill('Приватная цитата');
  await expect(page.getByLabel('Поделиться цитатой с клубом')).not.toBeChecked();
  await page.getByRole('button', { name: 'Сохранить цитату' }).click();
  await expect.poll(() => api.records.size).toBeGreaterThan(0);
  expect(api.publications).toHaveLength(0);
  await page.getByRole('button', { name: 'Редактировать цитату', exact: true }).click();
  await page.getByLabel('Поделиться цитатой с клубом').check();
  await page.getByRole('button', { name: 'Сохранить цитату' }).click();
  await expect
    .poll(
      () => api.publications.filter((p) => p.action === 'sync' && p.data.kind === 'quote').length,
    )
    .toBe(1);
  expect(api.publications[0].data.payload).toMatchObject({
    book_id: null,
    explicit_share: true,
    text: 'Приватная цитата',
  });
  await page.getByRole('button', { name: 'Редактировать цитату', exact: true }).click();
  await page.getByLabel('Поделиться цитатой с клубом').uncheck();
  await page.getByRole('button', { name: 'Сохранить цитату' }).click();
  await expect
    .poll(
      () =>
        api.publications.filter(
          (p) => p.action === 'sync' && p.data.kind === 'quote' && p.data.payload === null,
        ).length,
    )
    .toBe(1);
});

test('вопросы к встрече и итоги сохраняются на сервере и видны на втором устройстве', async ({
  browser,
  baseURL,
}) => {
  const api = backend();
  const upcoming = '40000000-0000-4000-8000-000000000001',
    past = '40000000-0000-4000-8000-000000000002';
  api.meetings.push(
    {
      id: upcoming,
      title: 'Будущая встреча',
      starts_at: new Date(Date.now() + 3 * 86400000).toISOString(),
      place: 'Кафе',
      description: 'Поговорим о книге',
      cancelled: false,
      version: 1,
      duration_minutes: 120,
    },
    {
      id: past,
      title: 'Прошедшая встреча',
      starts_at: new Date(Date.now() - 3 * 86400000).toISOString(),
      place: 'Клуб',
      description: '',
      cancelled: false,
      version: 1,
      duration_minutes: 120,
    },
  );
  const first = await browser.newContext({ baseURL }),
    second = await browser.newContext({ baseURL });
  try {
    await api.connect(first);
    await api.connect(second);
    const a = await first.newPage(),
      b = await second.newPage();
    await a.goto('/#/meetings');
    await expect(a.getByText(/До встречи/)).toBeVisible();
    await a.getByRole('button', { name: 'Вопросы к встрече', exact: true }).click();
    let dialog = a.getByRole('dialog');
    await dialog.getByLabel('Что хочется обсудить?').fill('Можно ли доверять рассказчику?');
    await dialog.getByRole('button', { name: 'Добавить вопрос', exact: true }).click();
    await expect(
      dialog
        .locator('.discussion-note')
        .getByText('Можно ли доверять рассказчику?', { exact: true }),
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Отметить обсуждённым', exact: true }).click();
    await expect(dialog.getByText('Обсудили', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Назад', exact: true }).click();
    await a.getByRole('button', { name: 'Прошедшие и отменённые', exact: true }).click();
    await a.getByRole('button', { name: 'Итоги встречи', exact: true }).click();
    dialog = a.getByRole('dialog');
    await dialog
      .getByLabel('Любимые мысли', { exact: true })
      .fill('Человек меняется вместе с памятью');
    await dialog
      .getByLabel('Спорные моменты', { exact: true })
      .fill('Обсуждали надёжность рассказчика');
    await dialog
      .getByLabel('Впечатление от встречи', { exact: true })
      .fill('Хочется перечитать финал');
    await dialog.getByRole('button', { name: 'Поделиться итогами', exact: true }).click();
    await expect(
      dialog.locator('.discussion-note').getByText('Хочется перечитать финал', { exact: true }),
    ).toBeVisible();
    await b.goto('/#/meetings');
    await b.getByRole('button', { name: 'Прошедшие и отменённые', exact: true }).click();
    await b.getByRole('button', { name: /^Итоги встречи/ }).click();
    await expect(
      b
        .getByRole('dialog')
        .locator('.discussion-note')
        .getByText('Человек меняется вместе с памятью', { exact: true }),
    ).toBeVisible();
    await b.screenshot({ path: '../../work/meeting-reflections.png', fullPage: true });
    expect(api.extra.meeting_reflections).toHaveLength(1);
  } finally {
    await first.close();
    await second.close();
  }
});
test('все книги: поиск, фильтр прочитанного, рейтинг, популярные цитаты и впечатление о давней книге', async ({
  page,
  context,
}) => {
  const api = backend();
  const reading = '20000000-0000-4000-8000-000000000001',
    past = '20000000-0000-4000-8000-000000000002',
    planned = '20000000-0000-4000-8000-000000000003',
    reader = '10000000-0000-4000-8000-000000000002',
    quote = '70000000-0000-4000-8000-000000000001';
  const meta = {
    authors: 'Автор',
    description: '',
    genre: '',
    year: 2019,
    isbn: '',
    cover: '',
    default_pages: 300,
  };
  api.extra.club_books = [
    { ...meta, id: reading, title: 'Текущая книга', status: 'reading' },
    { ...meta, id: past, title: 'Давняя книга', status: 'finished' },
    { ...meta, id: planned, title: 'Будущая книга', status: 'planned' },
  ];
  api.extra.club_book_stats = [
    {
      book_id: past,
      average_rating: 8,
      rating_count: 2,
      finished_readers: 2,
      pace_count: 1,
      average_days: 3,
      pages_per_day: 100,
    },
  ];
  api.extra.member_profiles = [
    {
      member_id: reader,
      name: 'Борис',
      avatar_url: null,
      bio: '',
      genres: '',
      joined_at: new Date().toISOString(),
    },
  ];
  api.extra.club_quotes = [
    {
      id: quote,
      member_id: reader,
      book_id: past,
      title: 'Давняя книга',
      text: 'Самая любимая цитата',
      page: 15,
      chapter: '',
      comment: '',
      updated_at: '2019-01-01T12:00:00Z',
    },
    {
      id: '70000000-0000-4000-8000-000000000002',
      member_id: reader,
      book_id: past,
      title: 'Давняя книга',
      text: 'Самая новая цитата',
      page: 20,
      chapter: '',
      comment: '',
      updated_at: new Date().toISOString(),
    },
  ];
  api.extra.quote_likes = [
    { quote_id: quote, member_id: reader },
    { quote_id: quote, member_id: owner },
  ];
  api.extra.club_reviews = [
    {
      id: reader,
      member_id: reader,
      book_id: past,
      title: 'Давняя книга',
      rating: 8,
      text: 'Спорный герой',
      spoilers: false,
      updated_at: new Date().toISOString(),
    },
  ];
  await api.connect(context);
  await page.goto('/#/club');
  await page.getByRole('button', { name: /^Все книги/ }).click();
  await expect(page.getByRole('tab', { name: /^Все.*3/ })).toBeVisible();
  await page.getByRole('tab', { name: /^Прочитано.*1/ }).click();
  await expect(page.getByRole('heading', { name: 'Давняя книга', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Будущая книга', exact: true })).not.toBeVisible();
  await page.getByRole('tab', { name: /^Все.*3/ }).click();
  await page.getByLabel('Поиск книг клуба').fill('Будущая');
  await expect(page.getByRole('heading', { name: 'Будущая книга', exact: true })).toBeVisible();
  await page.getByLabel('Поиск книг клуба').fill('');
  await page.getByRole('heading', { name: 'Давняя книга', exact: true }).click();
  await expect(page.getByLabel('Средняя оценка: 4 из 5', { exact: true })).toBeVisible();
  await expect(page.getByText('100 стр./день', { exact: true })).toBeVisible();
  await expect(page.locator('blockquote').first()).toHaveText('Самая любимая цитата');
  await page.setViewportSize({ width: 320, height: 760 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '../../work/book-memory-mobile.png', fullPage: true });
  await page.evaluate(() => (document.documentElement.dataset.theme = 'dark'));
  await expect
    .poll(() =>
      page
        .getByRole('button', { name: 'Все цитаты', exact: true })
        .evaluate((el) => getComputedStyle(el).backgroundColor),
    )
    .toBe('rgb(38, 45, 39)');
  await page.screenshot({ path: '../../work/book-memory-dark.png', fullPage: true });
  await page.evaluate(() => (document.documentElement.dataset.theme = 'light'));
  await page.getByRole('button', { name: 'Оставить впечатление', exact: true }).click();
  await page.getByLabel('Что осталось после книги?').fill('Мой взгляд спустя годы');
  await page.getByRole('slider', { name: 'Моя оценка', exact: true }).press('End');
  await page.getByRole('slider', { name: 'Моя оценка', exact: true }).press('ArrowLeft');
  await page.getByLabel('Я прочитал(а) эту книгу').check();
  await page.getByRole('button', { name: 'Сохранить впечатление', exact: true }).click();
  await expect
    .poll(() =>
      api.publications.some(
        (p) =>
          p.action === 'sync' &&
          p.data.kind === 'review' &&
          p.data.payload?.text === 'Мой взгляд спустя годы',
      ),
    )
    .toBe(true);
  await page.goto('/#/books');
  await expect(page.getByRole('button', { name: 'Прочитано 1', exact: true })).toBeVisible();
  await page.screenshot({ path: '../../work/personal-counts-mobile.png', fullPage: true });
  await openBookEditor(page, 'Давняя книга');
  await page.getByLabel('Текущая глава').fill('Эпилог');
  await page.getByText('Когда читал(а) — необязательно', { exact: true }).click();
  await page.getByLabel('Начал(а) читать').fill('2019-01-01');
  await page.getByLabel('Закончил(а) читать').fill('2019-01-03');
  await page.getByRole('button', { name: 'Сохранить книгу', exact: true }).click();
  await expect
    .poll(() =>
      [...api.records.values()].some(
        (r) =>
          r.kind === 'progress' &&
          r.payload?.chapter === 'Эпилог' &&
          r.payload?.startedOn === '2019-01-01',
      ),
    )
    .toBe(true);
});
test('цитаты: понравившиеся и сохранённые отделены от своих, есть поиск по книге и публикация галочкой', async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  const api = backend(),
    reader = '10000000-0000-4000-8000-000000000002',
    quote = '70000000-0000-4000-8000-000000000001';
  api.extra.member_profiles = [
    {
      member_id: reader,
      name: 'Борис',
      avatar_url: null,
      bio: '',
      genres: '',
      joined_at: new Date().toISOString(),
    },
  ];
  api.extra.club_quotes = [
    {
      id: quote,
      member_id: reader,
      book_id: null,
      title: 'Книга-источник',
      text: 'Цитата другого участника',
      page: 10,
      chapter: 'Глава 2',
      comment: '',
      updated_at: new Date().toISOString(),
    },
  ];
  api.extra.quote_likes = [{ quote_id: quote, member_id: owner }];
  await api.connect(context);
  await page.goto('/#/quotes');
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await page.getByLabel('Название книги', { exact: true }).fill('Моя книга');
  await page.getByLabel('Текст цитаты').fill('Собственная мысль');
  await page.getByRole('button', { name: 'Сохранить цитату', exact: true }).click();
  await page.getByLabel('Опубликовать в клубе', { exact: true }).check();
  await expect
    .poll(() =>
      api.publications.some(
        (p) =>
          p.action === 'sync' &&
          p.data.kind === 'quote' &&
          p.data.payload?.text === 'Собственная мысль',
      ),
    )
    .toBe(true);
  await page.getByRole('button', { name: 'Мои лайки', exact: true }).click();
  await expect(page.getByText('Цитата другого участника', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Сохранить себе', exact: true }).click();
  await page.getByRole('button', { name: 'Сохранено себе', exact: true }).click();
  await expect(page.getByText('Цитата другого участника', { exact: true })).toBeVisible();
  await expect(page.getByText('Собственная мысль', { exact: true })).not.toBeVisible();
  await expect(page.getByLabel('Фильтр по книге')).toHaveCount(0);
  await page.getByLabel('Поиск цитат').fill('Книга-источник');
  await expect(page.getByText('Цитата другого участника', { exact: true })).toBeVisible();
  await expect(page.getByText('Сохранено от Борис', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Нравится цитата', exact: true })).toContainText(
    '1',
  );
  await page.getByLabel('Поиск цитат').fill('');
  await page.getByRole('button', { name: 'Мои', exact: true }).click();
  await expect(page.getByText('Собственная мысль', { exact: true })).toBeVisible();
  await expect(page.getByText('Цитата другого участника', { exact: true })).not.toBeVisible();
  await page.setViewportSize({ width: 320, height: 760 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '../../work/quotes-organized.png', fullPage: true });
  await expect
    .poll(() =>
      [...api.records.values()].some((r) => r.kind === 'quote' && r.payload?.sourceId === quote),
    )
    .toBe(true);
  // Автор убрал публикацию и профиль: личная копия продолжает жить на обоих устройствах.
  api.extra.club_quotes = [];
  api.extra.quote_likes = [];
  api.extra.member_profiles = [];
  await page.reload();
  await page.getByRole('button', { name: 'Сохранено себе', exact: true }).click();
  await expect(page.getByText('Цитата другого участника', { exact: true })).toBeVisible();
  await expect(page.getByText('Сохранено от Борис', { exact: true })).toBeVisible();
  const second = await browser.newContext({ baseURL });
  try {
    await api.connect(second);
    const other = await second.newPage();
    await other.goto('/#/quotes');
    await other.getByRole('button', { name: 'Сохранено себе', exact: true }).click();
    await expect(other.getByText('Цитата другого участника', { exact: true })).toBeVisible();
    await expect(other.getByText('Книга-источник', { exact: false })).toBeVisible();
    await expect(other.getByText('Сохранено от Борис', { exact: true })).toBeVisible();
    await expect(other.getByRole('button', { name: 'Нравится цитата', exact: true })).toHaveCount(
      0,
    );
  } finally {
    await second.close();
  }
});

test('подсказки цитаты выбирают личную или клубную книгу без дубликатов, поиск над вкладками', async ({
  page,
  context,
}) => {
  const api = backend(),
    id = '20000000-0000-4000-8000-000000000001';
  api.extra.club_books = [
    {
      id,
      title: 'Солярис',
      authors: 'Станислав Лем',
      description: '',
      genre: '',
      year: null,
      isbn: '',
      cover: '',
      default_pages: 300,
      status: 'reading',
    },
  ];
  await api.connect(context);
  await page.goto('/#/quotes');
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await page.getByRole('combobox', { name: 'Название книги', exact: true }).fill('Сол');
  await page.getByRole('option', { name: /Солярис.*Книги клуба/ }).click();
  await page.getByLabel('Текст цитаты').fill('Цитата из клуба');
  await page.getByRole('button', { name: 'Сохранить цитату', exact: true }).click();
  await expect
    .poll(
      () =>
        [...api.records.values()].filter((r) => r.kind === 'book' && r.payload?.clubBookId === id)
          .length,
    )
    .toBe(1);
  expect(
    await page.evaluate(() => {
      const input = document.querySelector('[aria-label="Поиск цитат"]')!,
        tabs = document.querySelector('main .tabs')!;
      return !!(input.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING);
    }),
  ).toBe(true);
  await expect(page.getByLabel('Фильтр по книге')).toHaveCount(0);
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await page.getByRole('combobox', { name: 'Название книги', exact: true }).fill('Сол');
  await expect(page.getByRole('listbox').getByRole('option')).toHaveCount(1);
  await expect(page.getByRole('listbox').getByRole('option')).toContainText('Мои книги');
  await page.getByRole('combobox', { name: 'Название книги', exact: true }).press('Enter');
  await page.getByLabel('Текст цитаты').fill('Вторая цитата');
  await page.getByRole('button', { name: 'Сохранить цитату', exact: true }).click();
  await expect
    .poll(() => [...api.records.values()].filter((r) => r.kind === 'quote' && r.payload).length)
    .toBe(2);
  expect([...api.records.values()].filter((r) => r.kind === 'book' && r.payload)).toHaveLength(1);
  await page.setViewportSize({ width: 320, height: 760 });
  await page.getByLabel('Поиск цитат').fill('Солярис');
  await expect(page.getByText('Вторая цитата', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '../../work/quote-search-above-tabs.png', fullPage: true });
});

test('личная обложка и звёзды синхронизируются; обложка видна в прогрессе, назад возвращает поиск клуба', async ({
  browser,
  baseURL,
}) => {
  const api = backend(),
    id = '20000000-0000-4000-8000-000000000001';
  api.extra.club_books = [
    {
      id,
      title: 'Солярис',
      authors: 'Станислав Лем',
      description: '',
      genre: '',
      year: null,
      isbn: '',
      cover: '',
      default_pages: 300,
      status: 'reading',
    },
  ];
  const first = await browser.newContext({ baseURL, viewport: { width: 320, height: 760 } }),
    second = await browser.newContext({ baseURL, viewport: { width: 320, height: 760 } });
  try {
    await api.connect(first);
    await api.connect(second);
    const a = await first.newPage(),
      b = await second.newPage();
    await a.goto('/#/club');
    await a.getByRole('button', { name: /^Все книги/ }).click();
    await a.getByLabel('Поиск книг клуба').fill('Соля');
    await a.screenshot({ path: '../../work/club-compact-counts.png', fullPage: true });
    const filters = a.getByRole('tablist', { name: 'Книги клуба по статусу' });
    await expect(filters.getByRole('tab')).toHaveCount(3);
    await filters.getByRole('tab', { name: /^Прочитано/ }).click();
    await expect(filters.getByRole('tab', { name: /^Прочитано/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await filters.getByRole('tab', { name: /^Все/ }).click();
    await expect(a.getByLabel('Какие книги показать')).toHaveCount(0);
    await a.getByRole('heading', { name: 'Солярис', exact: true }).click();
    await a.getByRole('button', { name: /В мои книги/ }).click();
    await a.getByRole('button', { name: 'Назад', exact: true }).click();
    await expect(a.getByLabel('Поиск книг клуба')).toHaveValue('Соля');
    await a.goto('/#/books');
    await openBookEditor(a, 'Солярис');
    const png = await a.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 1800;
      c.height = 2600;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#7a3e31';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.fillStyle = 'white';
      ctx.font = '150px Georgia';
      ctx.fillText('МОЙ СОЛЯРИС', 100, 600);
      return c.toDataURL().split(',')[1];
    });
    await a.getByLabel('Выбрать обложку', { exact: true }).setInputFiles({
      name: 'my-cover.png',
      mimeType: 'image/png',
      buffer: Buffer.from(png, 'base64'),
    });
    await expect(a.locator('.cover-picker img')).toHaveAttribute(
      'src',
      /^data:image\/jpeg;base64,/,
    );
    await a.getByText('Отзыв, оценка и заметки', { exact: true }).click();
    await a.getByRole('slider', { name: 'Моя оценка', exact: true }).press('End');
    await a.getByRole('slider', { name: 'Моя оценка', exact: true }).press('ArrowLeft');
    await expect(a.getByRole('slider')).toHaveAttribute('aria-valuenow', '4.5');
    await a.screenshot({ path: '../../work/personal-cover-stars.png', fullPage: true });
    await a.getByRole('button', { name: 'Сохранить книгу', exact: true }).click();
    await expect
      .poll(() =>
        [...api.records.values()].some(
          (r) =>
            r.kind === 'book' && String(r.payload?.coverData).startsWith('data:image/jpeg;base64,'),
        ),
      )
      .toBe(true);
    expect(
      [...api.records.values()].find((r) => r.kind === 'book')!.payload!.coverData!.toString()
        .length,
    ).toBeLessThanOrEqual(60000);
    await expect
      .poll(() => [...api.records.values()].find((r) => r.kind === 'review')?.payload?.rating)
      .toBe(9);
    await b.goto('/#/club');
    await b.getByRole('button', { name: 'Открыть прогресс: Солярис', exact: true }).click();
    const reader = b.getByRole('button', { name: 'Чтение Анна: Солярис', exact: true });
    await expect(reader.locator('.cover img')).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
    expect((api.extra.club_books[0] as any).cover).toBe('');
    await b.screenshot({ path: '../../work/reader-personal-cover.png', fullPage: true });
    await b.goto('/#/books');
    await openBookEditor(b, 'Солярис');
    await expect(b.locator('.cover-picker img')).toHaveAttribute(
      'src',
      /^data:image\/jpeg;base64,/,
    );
    await b.getByText('Отзыв, оценка и заметки', { exact: true }).click();
    await expect(b.getByRole('slider')).toHaveAttribute('aria-valuenow', '4.5');
    await b.getByRole('dialog').getByRole('button', { name: 'Назад', exact: true }).click();
    await expect(b.getByRole('heading', { name: /^Мои книги/ })).toBeVisible();
    await openBookEditor(b, 'Солярис');
    await b.getByRole('button', { name: 'Вернуть обложку книги', exact: true }).click();
    await expect(b.locator('.cover-picker img')).toHaveCount(0);
    await b.getByRole('button', { name: 'Сохранить книгу', exact: true }).click();
    await expect
      .poll(() => [...api.records.values()].find((r) => r.kind === 'book')?.payload?.coverData)
      .toBeUndefined();
  } finally {
    await first.close();
    await second.close();
  }
});
