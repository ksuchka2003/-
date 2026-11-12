import {
  openBookEditor,
  editOpenBook,
  writeEntry,
  expectEntry,
  openActions,
  choosePaper,
} from './helpers';
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
          const entries = (extra.club_entries || []).filter((p: any) => p.member_id !== owner);
          for (const record of records.values()) {
            const e = record.payload as any;
            if (record.kind !== 'entry' || !e?.published || e.deletedAt) continue;
            const book = records.get('book:' + e.bookId)?.payload as any;
            if (!book || book.deletedAt) continue;
            entries.push({
              id: e.id,
              member_id: owner,
              book_id: book.clubBookId,
              title: book.title,
              kind: e.kind,
              text: e.text,
              page: e.page,
              chapter: e.chapter,
              created_at: e.createdAt,
              updated_at: e.updatedAt,
            });
          }
          extra.club_entries = entries;
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
        } else if (input.action === 'reading.participation') {
          const values = (extra.visible_reading_participation ||= []) as any[];
          const old = values.findIndex(
            (p) => p.reading_id === input.data.reading_id && p.member_id === owner,
          );
          const reading = (extra.club_readings as any[])?.find(
            (r) => r.id === input.data.reading_id,
          );
          const value = {
            ...input.data,
            book_id: reading?.book_id,
            member_id: owner,
            updated_at: new Date().toISOString(),
          };
          if (old >= 0) values[old] = value;
          else values.push(value);
          body = value;
        } else if (input.action === 'content.reaction') {
          const values = (extra.content_reactions ||= []) as any[];
          const { target_kind, target_id, value } = input.data;
          const old = values.findIndex(
            (r) =>
              r.target_kind === target_kind && r.target_id === target_id && r.member_id === owner,
          );
          if (old >= 0) values.splice(old, 1);
          if (value !== null) values.push({ target_kind, target_id, member_id: owner, value });
          if (target_kind === 'quote') {
            const likes = (extra.quote_likes ||= []) as any[],
              index = likes.findIndex((l) => l.quote_id === target_id && l.member_id === owner);
            if (index >= 0) likes.splice(index, 1);
            if (value === 1) likes.push({ quote_id: target_id, member_id: owner });
          }
          body = { ok: true };
        } else if (
          input.action === 'content.comment' ||
          input.action === 'content.comment.delete'
        ) {
          const values = (extra.content_comments ||= []) as any[],
            old = values.findIndex((c) => c.id === input.data.id);
          if (input.action.endsWith('.delete')) {
            if (old >= 0) values.splice(old, 1);
          } else {
            const row = {
              ...input.data,
              member_id: owner,
              created_at: values[old]?.created_at || new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };
            if (old >= 0) values[old] = row;
            else values.push(row);
          }
          body = { ok: true };
        } else if (input.action === 'admin.reading_report') {
          body = extra.report?.[0] || {};
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
        if (table === 'content_reactions' && !extra.content_reactions)
          extra.content_reactions = (extra.quote_likes || []).map((l: any) => ({
            target_kind: 'quote',
            target_id: l.quote_id,
            member_id: l.member_id,
            value: 1,
          }));
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
test('управление: короткое меню, отдельные разделы и журнал без длинной ленты', async ({
  page,
  context,
}) => {
  const api = backend();
  api.extra.notification_jobs = Array.from({ length: 24 }, (_, i) => ({
    id: crypto.randomUUID(),
    kind: 'selected_book',
    status: i === 0 ? 'failed' : 'sent',
    last_error: i === 0 ? 'Telegram: service temporarily unavailable' : null,
    run_at: new Date().toISOString(),
  }));
  let jobReads = 0;
  page.on('request', (request) => {
    if (request.url().includes('/notification_jobs')) jobReads++;
  });
  await api.connect(context);
  await page.goto('/#/admin');
  const menu = page.getByRole('navigation', { name: 'Разделы управления' });
  await expect(menu.getByRole('link')).toHaveCount(6);
  await expect(page.locator('.management-page .tabs')).toHaveCount(0);
  expect(jobReads).toBe(0);
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.setViewportSize({ width: 320, height: 760 });
  await page.screenshot({ path: '../../work/admin-home-friendly.png', fullPage: true });
  await menu.getByRole('link', { name: /Уведомления/ }).click();
  await expect(page.locator('.delivery-row')).toHaveCount(10);
  expect(jobReads).toBeGreaterThan(0);
  await expect(
    page.getByText('Telegram: service temporarily unavailable', { exact: true }),
  ).not.toBeVisible();
  expect(api.publications).toEqual([]);
  await page.getByRole('button', { name: 'С ошибкой', exact: true }).click();
  await expect(page.locator('.delivery-row')).toHaveCount(1);
  await page.getByText('Причина ошибки', { exact: true }).click();
  await expect(
    page.getByText('Telegram: service temporarily unavailable', { exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'К управлению клубом', exact: true }).click();
  await menu.getByRole('link', { name: /Предложения книг/ }).click();
  await expect(page.getByText('Новых предложений нет', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Предложения книг', exact: true })).toBeVisible();
});

test('управление: короткая форма книги сохраняет ввод при отказе сервера и отмене закрытия', async ({
  page,
  context,
}) => {
  const api = backend();
  await api.connect(context);
  let fail = true;
  await context.route('**/functions/v1/club-api', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const input = route.request().postDataJSON();
    if (input.action === 'admin.book') {
      if (fail)
        return route.fulfill({
          status: 400,
          json: { error: 'Не удалось сохранить книгу. Повторите попытку.' },
          headers: { 'access-control-allow-origin': '*' },
        });
      api.extra.club_books = [{ ...input.data, default_pages: input.data.totalPages }];
    }
    await route.fallback();
  });
  await page.goto('/#/admin?section=books');
  await page.getByRole('button', { name: 'Добавить книгу', exact: true }).click();
  await expect(page.getByLabel('Поиск книги в интернете')).toBeVisible();
  await expect(page.getByLabel('Название', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Добавить вручную', exact: true }).click();
  await page.getByLabel('Название', { exact: true }).fill('Книга для клуба');
  await page.getByLabel('Автор', { exact: true }).fill('Автор книги');
  await expect(page.getByLabel('Страниц по умолчанию')).not.toBeVisible();
  await page.getByText('Данные издания — необязательно', { exact: true }).click();
  await page.getByLabel('Страниц по умолчанию').fill('350');
  await choosePaper(page, 'Клубный статус', 'finished');
  await page.getByRole('button', { name: 'Сохранить книгу', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Не удалось сохранить книгу');
  await expect(page.getByLabel('Название', { exact: true })).toHaveValue('Книга для клуба');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('dialog').getByRole('button', { name: 'Назад', exact: true }).click();
  await expect(page.getByLabel('Название', { exact: true })).toHaveValue('Книга для клуба');
  fail = false;
  await page.getByRole('button', { name: 'Сохранить книгу', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Изменить книгу: Книга для клуба', exact: true }),
  ).toBeVisible();
  expect((api.extra.club_books[0] as any).default_pages).toBe(350);
  expect(api.records.size).toBe(0);
});

test('управление: одобрение и отклонение предложения разделены, причина требуется только для отказа', async ({
  page,
  context,
}) => {
  const api = backend();
  api.extra.book_proposals = [1, 2].map((n) => ({
    id: crypto.randomUUID(),
    member_id: owner,
    status: 'pending',
    reason: '',
    metadata: {
      title: 'Предложение ' + n,
      authors: 'Автор',
      description: '',
      genre: '',
      year: null,
      isbn: '',
      cover: '',
      totalPages: 200,
    },
  }));
  await api.connect(context);
  await context.route('**/functions/v1/club-api', async (route) => {
    if (route.request().method() === 'POST') {
      const input = route.request().postDataJSON();
      if (input.action === 'admin.proposal') {
        const proposal = (api.extra.book_proposals as any[]).find((p) => p.id === input.data.id);
        proposal.status = input.data.approve ? 'approved' : 'rejected';
      }
    }
    await route.fallback();
  });
  await page.goto('/#/admin?section=proposals');
  await page.getByRole('button', { name: 'Рассмотреть: Предложение 1', exact: true }).click();
  await expect(page.getByLabel('Причина отклонения')).toHaveCount(0);
  await expect(page.getByLabel('Название', { exact: true })).not.toBeVisible();
  await page.getByRole('button', { name: 'Добавить в каталог', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: 'Рассмотреть: Предложение 2', exact: true }).click();
  await page.getByRole('button', { name: 'Отклонить', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Отклонить предложение', exact: true }),
  ).toBeDisabled();
  await page.getByLabel('Причина отклонения').fill('Уже обсуждали эту книгу');
  await page.getByRole('button', { name: 'Отклонить предложение', exact: true }).click();
  await expect(page.getByText('Новых предложений нет', { exact: true })).toBeVisible();
  const actions = api.publications.filter((p) => p.action === 'admin.proposal');
  expect(actions.map((p) => p.data.approve)).toEqual([true, false]);
  expect(actions[1].data.reason).toBe('Уже обсуждали эту книгу');
});

test('управление: поиск участников, закрытие и восстановление доступа, приглашение без ID', async ({
  page,
  context,
}) => {
  const api = backend();
  const boris = crypto.randomUUID();
  api.extra.visible_club_members = [
    { id: owner, name: 'Анна', username: null, role: 'admin', active: true },
    { id: boris, name: 'Борис', username: 'boris', role: 'member', active: true },
  ];
  await api.connect(context);
  await context.route('**/functions/v1/club-api', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const input = route.request().postDataJSON();
    if (input.action === 'admin.member')
      (api.extra.visible_club_members as any[]).find((m) => m.id === input.data.id).active =
        input.data.active;
    if (input.action === 'admin.telegram' || input.action === 'admin.invitation')
      return route.fulfill({
        json:
          input.action === 'admin.telegram'
            ? { username: 'bookclub_test_bot' }
            : { token: 'test-invitation-token' },
        headers: { 'access-control-allow-origin': '*' },
      });
    await route.fallback();
  });
  await page.goto('/#/admin?section=members');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByLabel('Поиск участников в управлении').fill('@boris');
  await page.getByRole('button', { name: 'Участник: Борис', exact: true }).click();
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: 'Закрыть доступ', exact: true }).click();
  expect(api.publications.filter((p) => p.action === 'admin.member')).toHaveLength(0);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Закрыть доступ', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: 'Доступ закрыт', exact: true }).click();
  await page.getByRole('button', { name: 'Участник: Борис', exact: true }).click();
  await page.getByRole('button', { name: 'Восстановить доступ', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(
    api.publications.filter((p) => p.action === 'admin.member').map((p) => p.data.active),
  ).toEqual([false, true]);
  await page.getByRole('button', { name: 'Пригласить участника', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('textbox')).toHaveCount(0);
  await page.getByRole('button', { name: 'Создать приглашение', exact: true }).click();
  await expect(page.getByLabel('Ссылка приглашения')).toHaveValue(
    'https://t.me/bookclub_test_bot?start=join_test-invitation-token',
  );
  await page.setViewportSize({ width: 320, height: 760 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '../../work/admin-invitation-friendly.png', fullPage: true });
});

test('управление: встреча сохраняет связанные книги после медленной загрузки, отмена требует подтверждения', async ({
  page,
  context,
}) => {
  const api = backend();
  const meetingId = crypto.randomUUID(),
    bookId = crypto.randomUUID();
  api.meetings.push({
    id: meetingId,
    title: 'Встреча клуба',
    starts_at: new Date(Date.now() + 3 * 86400000).toISOString(),
    place: 'Кафе',
    venue_url: '',
    description: '',
    duration_minutes: 120,
    cancelled: false,
    version: 1,
  });
  api.extra.club_books = [
    {
      id: bookId,
      title: 'Книга встречи',
      authors: 'Автор',
      status: 'reading',
      cover: '',
      default_pages: 300,
    },
  ];
  api.extra.meeting_books = [{ meeting_id: meetingId, book_id: bookId }];
  await api.connect(context);
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  await context.route('**/rest/v1/meeting_books*', async (route) => {
    await hold;
    await route.fallback();
  });
  try {
    await page.goto('/#/admin?section=meetings');
    await page
      .getByRole('button', { name: 'Изменить встречу: Встреча клуба', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Сохранить встречу', exact: true }),
    ).toBeDisabled();
    release();
    await expect(
      page.getByRole('button', { name: 'Сохранить встречу', exact: true }),
    ).toBeEnabled();
    await page.getByText('Ссылка, книги и длительность', { exact: true }).click();
    await page.getByLabel('Найти книгу встречи').fill('Книга');
    await expect(page.getByRole('checkbox', { name: 'Книга встречи', exact: true })).toBeChecked();
    await page.getByLabel('Место', { exact: true }).fill('Другое кафе');
    await page.getByRole('button', { name: 'Сохранить встречу', exact: true }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    expect((api.meetings[0] as any).book_ids).toEqual([bookId]);
    await page
      .getByRole('button', { name: 'Изменить встречу: Встреча клуба', exact: true })
      .click();
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.getByRole('button', { name: 'Отменить встречу', exact: true }).click();
    expect(api.meetings[0].cancelled).toBe(false);
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Отменить встречу', exact: true }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    expect(api.meetings[0].cancelled).toBe(true);
    await page.getByRole('button', { name: 'Прошедшие', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Изменить встречу: Встреча клуба', exact: true }),
    ).toBeVisible();
  } finally {
    release();
  }
});
test('мобильный UX: раздел и фильтры цитат сохраняются при возврате и перезагрузке', async ({
  page,
  context,
}) => {
  const api = backend(),
    book = crypto.randomUUID(),
    quote = crypto.randomUUID(),
    date = new Date().toISOString();
  api.records.set('book:' + book, {
    kind: 'book',
    entity_id: book,
    revision: 1,
    device_id: owner,
    payload: {
      id: book,
      title: 'Книга',
      authors: 'Автор',
      clubBookId: null,
      description: '',
      genre: '',
      year: null,
      isbn: '',
      cover: '',
      totalPages: 200,
      status: 'reading',
      notes: '',
      publishProgress: false,
      publishReview: false,
      createdAt: date,
      updatedAt: date,
    },
  });
  api.records.set('quote:' + quote, {
    kind: 'quote',
    entity_id: quote,
    revision: 2,
    device_id: owner,
    payload: {
      id: quote,
      bookId: book,
      text: 'Цитата для проверки фильтров',
      page: 12,
      chapter: '',
      comment: '',
      favorite: true,
      deletedAt: null,
      sourceId: null,
      sourceAuthor: null,
      published: false,
      createdAt: date,
      updatedAt: date,
    },
  });
  await api.connect(context);
  await page.goto('/#/quotes');
  const section = page.getByLabel('Раздел цитат', { exact: true });
  await section.click();
  const choiceSheet = page.getByRole('dialog', { name: 'Раздел цитат', exact: true });
  await expect(choiceSheet.locator('[data-option-value]')).toHaveCount(5);
  await choiceSheet.getByRole('button', { name: 'Назад', exact: true }).click();
  await expect(page.locator('main .tabs')).toHaveCount(0);
  await page.getByLabel('Поиск цитат').fill('проверки');
  await page.getByRole('button', { name: 'Фильтры цитат', exact: true }).click();
  await page.getByLabel('Только избранное', { exact: true }).check();
  await choosePaper(page, 'Сортировка цитат', 'likes');
  await page.getByRole('button', { name: 'Показать цитаты', exact: true }).click();
  await expect(page.locator('blockquote')).toHaveText('Цитата для проверки фильтров');
  await page.goto('/#/profile');
  await page.goBack();
  await expect(page.getByLabel('Поиск цитат')).toHaveValue('проверки');
  await page.reload();
  await expect(page.getByText('Избранное · Больше лайков', { exact: true })).toBeVisible();
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 760 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.setViewportSize({ width: 320, height: 760 });
  await page.screenshot({ path: '../../work/quotes-compact-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Очистить поиск', exact: true }).click();
  await expect(page.getByLabel('Поиск цитат')).toHaveValue('');
  await expect(page.getByLabel('Поиск цитат')).toBeFocused();
  await choosePaper(page, 'Раздел цитат', 'trash');
  await expect(page.getByText('Корзина пуста', { exact: true })).toBeVisible();
  expect(page.url()).not.toContain('favorite=');
  await choosePaper(page, 'Раздел цитат', 'saved');
  await expect(page.getByText('Сохранённых цитат пока нет', { exact: true })).toBeVisible();
  expect(api.publications).toEqual([]);
});

test('мобильный UX: длинное описание не закрывает действия книги, прогресс сохраняется при малой высоте', async ({
  page,
  context,
}) => {
  const api = backend(),
    book = crypto.randomUUID();
  const description = 'Очень подробное описание книги. '.repeat(120);
  api.extra.club_books = [
    {
      id: book,
      title: 'Книга клуба',
      authors: 'Автор',
      description,
      genre: '',
      year: null,
      isbn: '',
      cover: '',
      status: 'reading',
      default_pages: 300,
    },
  ];
  await api.connect(context);
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/#/club/' + book);
  await expect(page.getByText(description, { exact: true })).not.toBeVisible();
  const add = page.getByRole('button', { name: 'В мои книги', exact: true });
  await expect(add).toBeInViewport();
  await add.click();
  await page.getByRole('button', { name: 'Сохранить книгу', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: 'Настроить моё издание', exact: true }),
  ).not.toBeVisible();
  await page.goto('/#/club/' + book);
  const progress = page.getByRole('link', { name: 'Обновить мой прогресс', exact: true });
  await expect(progress).toBeVisible();
  for (const action of await page
    .locator('.book-detail-actions > a, .book-detail-actions > button')
    .all()) {
    const bounds = (await action.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(16);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(304);
  }
  const tabs = page.locator('.book-section-nav button');
  await expect(tabs).toHaveCount(6);
  for (const tab of await tabs.all()) {
    const bounds = (await tab.boundingBox())!;
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(304);
  }
  await page.screenshot({ path: '../../work/book-detail-mobile-compact.png', fullPage: true });
  await progress.click();
  await page.setViewportSize({ width: 320, height: 420 });
  const dialog = page.getByRole('dialog', { name: 'Мой прогресс', exact: true });
  await expect(
    dialog.getByRole('button', { name: 'Сохранить прогресс', exact: true }),
  ).toBeInViewport();
  await dialog.getByLabel('Прочитано страниц').fill('120');
  await dialog.getByRole('button', { name: 'Сохранить прогресс', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText('40%', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

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
    await form.getByLabel('Прочитано страниц').fill('100');
    await form.getByRole('button', { name: 'Сохранить книгу' }).click();
    await writeEntry(a, 'Синхронная книга', 'Только для владельца');
    await expect.poll(() => api.records.size).toBeGreaterThanOrEqual(3);
    await synced(a);
    await b.goto('/#/books');
    await expect(b.getByRole('heading', { name: 'Синхронная книга' })).toBeVisible();
    await openBookEditor(b, 'Синхронная книга');

    await b.getByRole('button', { name: 'Назад', exact: true }).click();
    await expectEntry(b, 'Синхронная книга', 'Только для владельца');
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
  let dialog = page.getByRole('dialog', { name: 'Настроить моё издание', exact: true });
  await expect(dialog.getByLabel('Название', { exact: true })).toHaveValue('Короткий путь');
  await dialog.getByRole('button', { name: 'Сохранить книгу', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.goto('/#/books');
  await writeEntry(page, 'Короткий путь', 'Важная заметка');
  await page.goto('/#/club/' + clubId);
  await page.getByRole('button', { name: 'Оставить впечатление', exact: true }).click();
  await page.getByLabel('Законченная мысль').fill('Незаконченный отзыв');
  await page.getByRole('dialog').getByRole('button', { name: 'Назад', exact: true }).click();
  await page.getByRole('button', { name: 'Оставить впечатление', exact: true }).click();
  await expect(page.getByLabel('Законченная мысль')).toHaveValue('Незаконченный отзыв');
  await page.getByRole('button', { name: 'Сохранить мысль', exact: true }).click();
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

    await expect(other.getByLabel('Прочитано страниц')).toHaveValue('150');
    await expect(other.getByLabel('Текущая глава')).toHaveValue('Глава 3');
    await other.getByRole('dialog').getByRole('button', { name: 'Назад', exact: true }).click();
    await expectEntry(other, 'Короткий путь', 'Важная заметка');
    await other.goto('/#/quotes');
    await expect(other.locator('blockquote')).toHaveText('Эта цитата должна восстановиться');
    expect(api.publications).toEqual([]);
  } finally {
    await second.close();
  }
});

test('UX: каталог сохраняет UUID клуба и позволяет настроить личное издание', async ({
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
  await form.getByLabel('Найти в книгах клуба').fill('Дюна');
  await expect(form.getByRole('region', { name: 'В клубе', exact: true })).toBeVisible();
  await form.getByRole('region', { name: 'В клубе', exact: true }).getByRole('button').click();
  await expect(form.getByLabel('Название', { exact: true })).toHaveValue('Дюна');
  await form.getByLabel('Страниц в моём издании').fill('480');
  await form.getByRole('button', { name: 'Сохранить книгу', exact: true }).click();
  await expect(form).not.toBeVisible();
  await expect
    .poll(() => [...api.records.values()].find((r) => r.kind === 'book')?.payload?.clubBookId)
    .toBe(id);
  expect([...api.records.values()].find((r) => r.kind === 'book')?.payload?.totalPages).toBe(480);
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  form = page.getByRole('dialog', { name: 'Добавить книгу', exact: true });
  await form.getByLabel('Найти в книгах клуба').fill('Дюна');
  await form.getByRole('region', { name: 'Уже у меня', exact: true }).getByRole('button').click();
  const card = page.getByRole('dialog', { name: 'Моя книга', exact: true });
  await card.getByRole('button', { name: /^Цитаты/ }).click();
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
    .getByRole('button', { name: /^Цитаты/ })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Добавить цитату', exact: true })
    .click();
  await expect(page.getByLabel('Название книги', { exact: true })).toHaveCount(0);
  await page.getByLabel('Текст цитаты').fill('Цитата без лишних шагов');
  await page.getByRole('button', { name: 'Сохранить цитату', exact: true }).click();
  let card = page.getByRole('dialog', { name: 'Моя книга', exact: true });
  await card.getByRole('button', { name: /^Цитаты/ }).click();
  await expect(card.locator('blockquote')).toHaveText('Цитата без лишних шагов');
  await card.getByRole('button', { name: /^Мысли/ }).click();
  await card.getByRole('button', { name: 'Добавить мысль', exact: true }).click();
  await page.getByLabel('Законченная мысль').fill('Моё впечатление');
  await expect(page.getByLabel('Поделиться мыслью с клубом')).not.toBeChecked();
  await page.getByRole('button', { name: 'Сохранить мысль', exact: true }).click();
  await card.getByRole('button', { name: 'Назад', exact: true }).click();
  await writeEntry(page, 'Удобная книга', 'Только для меня');
  await page
    .locator('.personal-book-card')
    .getByRole('heading', { name: 'Удобная книга', exact: true })
    .click();
  await page.setViewportSize({ width: 320, height: 760 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '../../work/ux-personal-book.png', fullPage: true });
  await expect
    .poll(() =>
      [...api.records.values()].some(
        (r) => r.kind === 'entry' && r.payload?.text === 'Только для меня',
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
    card = second.getByRole('dialog', { name: 'Моя книга', exact: true });
    await expect(card.getByText('Только для меня', { exact: true })).toBeVisible();
    await card.getByRole('button', { name: /^Мысли/ }).click();
    await expect(card.getByText('Моё впечатление', { exact: true })).toBeVisible();
    await card.getByRole('button', { name: /^Цитаты/ }).click();
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
  const board = page.getByRole('region', { name: 'Статистика моей библиотеки', exact: true });
  await expect(board).toContainText('В коллекции4');
  await expect(board.getByRole('button')).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Фильтр статуса', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Фильтры книг', exact: true }).click();
  await page
    .getByRole('group', { name: 'Фильтр статуса', exact: true })
    .getByRole('button', { name: 'Читаю', exact: true })
    .click();
  await page.getByRole('button', { name: 'Показать книги', exact: true }).click();
  await expect(page.locator('.personal-book-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Фильтры книг', exact: true }).click();
  const filter = page.getByRole('dialog', { name: 'Фильтры книг', exact: true });
  await filter.getByRole('button', { name: 'Хочу прочитать', exact: true }).click();
  await choosePaper(page, 'Сортировка', 'title');
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
    await expect(page.getByRole('heading', { name: 'Книжный клуб', exact: true })).toBeVisible();
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
  await page
    .getByRole('navigation', { name: 'Разделы управления' })
    .getByRole('link', { name: /Книги клуба/ })
    .click();
  await page.getByRole('button', { name: 'Читаем сейчас', exact: true }).click();
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
  await page.getByRole('button', { name: /^Изменить книгу:/ }).click();
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
  await dialog.getByRole('button', { name: 'Сменить обложку', exact: true }).click();
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
  await dialog.getByRole('button', { name: 'Сменить обложку', exact: true }).click();
  fail = true;
  await dialog.getByLabel('Поиск обложки').fill('Неизвестное издание');
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
  await page.getByText('Ссылка, книги и длительность', { exact: true }).click();
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
  await page.evaluate(() => (window.Telegram!.WebApp.colorScheme = 'dark'));
  await page.emulateMedia({ colorScheme: 'dark' });
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
  await choosePaper(page, 'Записи участника', 'reviews');
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
  await openActions(page, 'Действия с цитатой');
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
  await openActions(page, 'Действия с цитатой');
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
    await a.getByRole('button', { name: 'Прошедшие', exact: true }).click();
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
    await b.getByRole('button', { name: 'Прошедшие', exact: true }).click();
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
  await expect(page.getByText('100 стр./день', { exact: true })).not.toBeVisible();
  await page.getByRole('button', { name: 'Цитаты', exact: true }).click();
  await expect(page.locator('blockquote').first()).toHaveText('Самая любимая цитата');
  await page.setViewportSize({ width: 320, height: 760 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '../../work/book-memory-mobile.png', fullPage: true });
  await page.evaluate(() => (window.Telegram!.WebApp.colorScheme = 'dark'));
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect
    .poll(() => page.locator('body').evaluate((el) => getComputedStyle(el).backgroundColor))
    .toBe('rgb(33, 30, 28)');
  await page.screenshot({ path: '../../work/book-memory-dark.png', fullPage: true });
  await page.evaluate(() => (window.Telegram!.WebApp.colorScheme = 'light'));
  await page.emulateMedia({ colorScheme: 'light' });
  await page.getByRole('button', { name: 'Оставить впечатление', exact: true }).click();
  await page.getByLabel('Законченная мысль').fill('Мой взгляд спустя годы');
  await page.getByLabel('Поделиться мыслью с клубом').check();
  await page.getByRole('button', { name: 'Сохранить мысль', exact: true }).click();
  await expect
    .poll(() => api.extra.club_entries?.some((e: any) => e.text === 'Мой взгляд спустя годы'))
    .toBe(true);
  await page.goto('/#/books');
  await page.getByRole('button', { name: 'Изменить статус: Давняя книга', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Прочитано', exact: true }).click();
  await page
    .locator('.personal-book-card')
    .getByRole('heading', { name: 'Давняя книга', exact: true })
    .click();
  await page.getByRole('dialog').getByRole('button', { name: 'Отзыв', exact: true }).click();
  await page.getByRole('button', { name: 'Написать отзыв', exact: true }).click();
  await page.getByLabel('Мой отзыв', { exact: true }).fill('Мой отзыв спустя годы');
  await page.getByRole('slider', { name: 'Моя оценка', exact: true }).press('End');
  await page.getByRole('slider', { name: 'Моя оценка', exact: true }).press('ArrowLeft');
  await page.getByLabel('Поделиться отзывом и оценкой в клубе').check();
  await page.getByRole('button', { name: 'Сохранить отзыв', exact: true }).click();
  await expect
    .poll(() =>
      api.publications.some(
        (p) =>
          p.action === 'sync' &&
          p.data.kind === 'review' &&
          p.data.payload?.text === 'Мой отзыв спустя годы',
      ),
    )
    .toBe(true);
  await page.goto('/#/books');
  await expect(
    page.getByRole('region', { name: 'Статистика моей библиотеки', exact: true }),
  ).toContainText('Прочитано1');
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
  await choosePaper(page, 'Раздел цитат', 'liked');
  await expect(page.getByText('Цитата другого участника', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Сохранить себе', exact: true }).click();
  await choosePaper(page, 'Раздел цитат', 'saved');
  await expect(page.getByText('Цитата другого участника', { exact: true })).toBeVisible();
  await expect(page.getByText('Собственная мысль', { exact: true })).not.toBeVisible();
  await expect(page.getByLabel('Фильтр по книге')).toHaveCount(0);
  await page.getByLabel('Поиск цитат').fill('Книга-источник');
  await expect(page.getByText('Цитата другого участника', { exact: true })).toBeVisible();
  await expect(page.getByText('Сохранено от Борис', { exact: true })).not.toBeVisible();
  await page.locator('.source-disclosure summary').click();
  await expect(page.getByText('Сохранено от Борис', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Нравится цитата', exact: true })).toContainText(
    '1',
  );
  await page.getByLabel('Поиск цитат').fill('');
  await choosePaper(page, 'Раздел цитат', 'mine');
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
  await choosePaper(page, 'Раздел цитат', 'saved');
  await expect(page.getByText('Цитата другого участника', { exact: true })).toBeVisible();
  await expect(page.getByText('Сохранено от Борис', { exact: true })).not.toBeVisible();
  await page.locator('.source-disclosure summary').click();
  await expect(page.getByText('Сохранено от Борис', { exact: true })).toBeVisible();
  const second = await browser.newContext({ baseURL });
  try {
    await api.connect(second);
    const other = await second.newPage();
    await other.goto('/#/quotes');
    await choosePaper(other, 'Раздел цитат', 'saved');
    await expect(other.getByText('Цитата другого участника', { exact: true })).toBeVisible();
    await other.locator('.source-disclosure summary').click();
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
        tabs = document.querySelector('main .quote-navigation')!;
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
    await a.getByRole('button', { name: 'Сохранить книгу', exact: true }).click();
    await expect(a.getByRole('dialog', { name: 'Моя книга', exact: true })).toBeVisible();
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
    await a.getByRole('button', { name: 'Сохранить книгу', exact: true }).click();
    await a.getByRole('button', { name: 'Изменить статус: Солярис', exact: true }).click();
    await a.getByRole('dialog').getByRole('button', { name: 'Прочитано', exact: true }).click();
    await a
      .locator('.personal-book-card')
      .getByRole('heading', { name: 'Солярис', exact: true })
      .click();
    await a.getByRole('dialog').getByRole('button', { name: 'Отзыв', exact: true }).click();
    await a.getByRole('button', { name: 'Написать отзыв', exact: true }).click();
    await a.getByRole('slider', { name: 'Моя оценка', exact: true }).press('End');
    await a.getByRole('slider', { name: 'Моя оценка', exact: true }).press('ArrowLeft');
    await expect(a.getByRole('slider')).toHaveAttribute('aria-valuenow', '4.5');
    await a.screenshot({ path: '../../work/personal-cover-stars.png', fullPage: true });
    await a.getByRole('button', { name: 'Сохранить отзыв', exact: true }).click();
    await a.getByRole('dialog').getByRole('button', { name: 'Назад', exact: true }).click();
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

test('чтение клуба: отказ, просмотр чужих записей, смена решения и настройка своего издания', async ({
  page,
  context,
}) => {
  const api = backend(),
    book = '20000000-0000-4000-8000-000000000061',
    reading = '40000000-0000-4000-8000-000000000061';
  api.extra.club_books = [
    {
      id: book,
      title: 'Новая клубная',
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
  api.extra.club_readings = [
    {
      id: reading,
      book_id: book,
      starts_on: clubDay(),
      ends_on: null,
      position: 0,
      status: 'active',
    },
  ];
  await api.connect(context);
  await page.goto('/#/');
  await page.getByRole('button', { name: 'Не буду читать', exact: true }).click();
  await expect
    .poll(() => (api.extra.visible_reading_participation?.[0] as any)?.choice)
    .toBe('declined');
  expect([...api.records.values()].filter((r) => r.kind === 'book')).toHaveLength(0);
  await page.getByText('Прогресс участников', { exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Чтение Анна: Новая клубная', exact: true }),
  ).toContainText('Не будет читать');
  await page.getByRole('button', { name: 'Изменить решение', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Буду читать', exact: true }).click();
  const edition = page.getByRole('dialog', { name: 'Настроить моё издание', exact: true });
  await expect(edition).toBeVisible();
  await edition.getByLabel('Страниц в моём издании').fill('480');
  await edition.getByRole('button', { name: 'Сохранить книгу', exact: true }).click();
  const card = page.getByRole('dialog', { name: 'Моя книга', exact: true });
  await expect(card.getByRole('link', { name: 'Клубная книга →', exact: true })).toHaveAttribute(
    'href',
    '#/club/' + book,
  );
  await card.getByRole('button', { name: 'Добавить заметку', exact: true }).click();
  await page.getByLabel('Текст заметки').fill('Личное наблюдение');
  await expect(page.getByLabel('Поделиться заметкой с клубом')).not.toBeChecked();
  await page.getByRole('button', { name: 'Сохранить заметку', exact: true }).click();
  await card.getByRole('button', { name: /^Мысли/ }).click();
  await card.getByRole('button', { name: 'Добавить мысль', exact: true }).click();
  await page.getByLabel('Законченная мысль').fill('У меня есть соображения');
  await page.getByLabel('Поделиться мыслью с клубом').check();
  await page.getByRole('button', { name: 'Сохранить мысль', exact: true }).click();
  await expect.poll(() => api.extra.club_entries?.length).toBe(1);
  expect((api.extra.club_entries[0] as any).text).toBe('У меня есть соображения');
  await expect(card.getByText('В клубе', { exact: false })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 640 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '../../work/reader-thought-mobile.png', fullPage: true });
});

test('публикации: переключение лайка на дизлайк и отдельные комментарии с реакциями', async ({
  page,
  context,
}) => {
  const api = backend(),
    quote = '50000000-0000-4000-8000-000000000062';
  api.extra.public_quotes = [
    {
      id: quote,
      member_id: '10000000-0000-4000-8000-000000000002',
      book_id: null,
      title: '',
      text: 'Фраза вне книги',
      page: null,
      chapter: '',
      comment: '',
      updated_at: new Date().toISOString(),
    },
  ];
  await api.connect(context);
  await page.goto('/#/quotes?tab=club');
  const post = page.locator('.quote-card').filter({ hasText: 'Фраза вне книги' });
  await post.getByRole('button', { name: 'Нравится цитата', exact: true }).click();
  await expect(post.getByRole('button', { name: 'Нравится цитата', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await post.getByRole('button', { name: 'Не нравится цитата', exact: true }).click();
  expect(api.extra.content_reactions).toHaveLength(1);
  expect((api.extra.content_reactions[0] as any).value).toBe(-1);
  await post.getByRole('button', { name: 'Комментарии', exact: true }).click();
  const discussion = page.getByRole('dialog', { name: 'Комментарии', exact: true });
  await discussion.getByLabel('Ваш комментарий').fill('Первая реплика');
  await discussion.getByRole('button', { name: 'Отправить комментарий', exact: true }).click();
  await expect(discussion.locator('.content-comment')).toHaveCount(1);
  await discussion.getByLabel('Ваш комментарий').fill('Вторая реплика');
  await discussion.getByRole('button', { name: 'Отправить комментарий', exact: true }).click();
  await expect(discussion.locator('.content-comment')).toHaveCount(2);
  await discussion
    .locator('.content-comment')
    .first()
    .getByRole('button', { name: 'Не нравится комментарий', exact: true })
    .click();
  await expect(
    discussion
      .locator('.content-comment')
      .first()
      .getByRole('button', { name: 'Не нравится комментарий', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await discussion.getByRole('button', { name: 'Назад', exact: true }).click();
  await post.getByRole('button', { name: 'Сохранить себе', exact: true }).click();
  await expect
    .poll(() => [...api.records.values()].filter((r) => r.kind === 'quote' && r.payload).length)
    .toBe(1);
  expect([...api.records.values()].find((r) => r.kind === 'quote')?.payload?.bookId).toBeNull();
  await page.setViewportSize({ width: 320, height: 640 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('ручная книга предлагает связь с клубом и сохраняет личное число страниц', async ({
  page,
  context,
}) => {
  const api = backend(),
    id = '20000000-0000-4000-8000-000000000063';
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
      status: 'planned',
    },
  ];
  await api.connect(context);
  await page.goto('/#/books');
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await page.getByRole('button', { name: 'Добавить вручную', exact: true }).click();
  await page.getByLabel('Название', { exact: true }).fill('Дюна');
  await expect(page.locator('.similar-books')).toContainText('Дюна');
  await page.getByLabel('Страниц в моём издании').fill('480');
  await page.getByRole('button', { name: 'Сохранить книгу', exact: true }).click();
  const duplicate = page.getByRole('dialog', { name: 'Похожая книга есть в клубе', exact: true });
  await expect(duplicate).toContainText('не появятся');
  await duplicate.getByRole('button', { name: /Читать клубную книгу/ }).click();
  await expect(duplicate).not.toBeVisible();
  await expect
    .poll(() => [...api.records.values()].find((r) => r.kind === 'book')?.payload?.clubBookId)
    .toBe(id);
  expect([...api.records.values()].find((r) => r.kind === 'book')?.payload?.totalPages).toBe(480);
});

test('полки, перемещение и карточки книг; личная палитра сохраняется', async ({
  page,
  context,
}) => {
  const api = backend();
  await api.connect(context);
  await page.goto('/#/books');
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await page.getByRole('button', { name: 'Добавить вручную', exact: true }).click();
  await page.getByLabel('Название', { exact: true }).fill('Книга на полке');
  await page.getByRole('button', { name: 'Сохранить книгу', exact: true }).click();
  await openActions(page, 'Настройки библиотеки');
  await page.getByRole('button', { name: 'Мои полки', exact: true }).click();
  const manager = page.getByRole('dialog', { name: 'Мои полки', exact: true });
  for (const name of ['Любимое', 'На лето']) {
    await manager.getByLabel('Новая полка').fill(name);
    await manager.getByRole('button', { name: 'Создать полку', exact: true }).click();
    await expect(manager.getByLabel('Новая полка')).toHaveValue('');
  }
  await manager.getByRole('button', { name: 'Назад', exact: true }).click();
  await page
    .locator('.personal-book-card')
    .getByRole('heading', { name: 'Книга на полке', exact: true })
    .click();
  await page.getByRole('button', { name: 'На полки', exact: true }).click();
  await page.getByLabel('Любимое', { exact: true }).check();
  await page.getByRole('button', { name: 'Сохранить полки', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Назад', exact: true }).click();
  await choosePaper(page, 'Полка', { label: 'Любимое' });
  await expect(page.locator('.personal-book-card')).toHaveCount(1);
  await openActions(page.locator('.personal-book-card'), 'Действия с книгой в списке');
  await page.getByRole('button', { name: 'Переместить на полку', exact: true }).click();
  await page.getByText('Переместить с текущей полки', { exact: true }).click();
  await choosePaper(page, 'Куда переместить', { label: 'На лето' });
  await page.getByRole('button', { name: 'Переместить книгу', exact: true }).click();
  await expect(page.locator('.personal-book-card')).toHaveCount(0);
  await choosePaper(page, 'Полка', { label: 'На лето' });
  await openActions(page, 'Настройки библиотеки');
  await page.getByRole('button', { name: 'Вид библиотеки', exact: true }).click();
  await expect(page.locator('.book-grid')).toBeVisible();
  await page.setViewportSize({ width: 320, height: 640 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '../../work/reader-shelves-grid.png', fullPage: true });
  await page.goto('/#/profile');
  await choosePaper(page, 'Палитра', 'sea');
  await choosePaper(page, 'Тема', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'sea');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect
    .poll(
      () =>
        [...api.records.values()].find((r) => r.kind === 'setting' && r.entity_id === 'palette')
          ?.payload?.value,
    )
    .toBe('sea');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'sea');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('администратор открывает отчёт по книге и скачивает его', async ({ page, context }) => {
  const api = backend(),
    id = '20000000-0000-4000-8000-000000000065';
  const book = {
    id,
    title: 'Отчётная книга',
    authors: 'Автор',
    description: '',
    genre: '',
    year: null,
    isbn: '',
    cover: '',
    default_pages: 200,
    status: 'finished',
  };
  api.extra.club_books = [book];
  api.extra.report = [
    {
      book,
      reading: null,
      cycles: [],
      generated_at: new Date().toISOString(),
      timezone: 'Europe/Moscow',
      readers: [
        {
          member_id: owner,
          name: 'Анна',
          choice: 'reading',
          status: 'finished',
          pages: 200,
          total_pages: 200,
          percent: 100,
          completed_at: new Date().toISOString(),
        },
      ],
      finishers: [{ member_id: owner, name: 'Анна', completed_at: new Date().toISOString() }],
      activity: { pages_logged: 150, updates: 3, corrections: 1, baselines: 1 },
      periods: [{ label: 'Вечер · 18–24', pages: 150, updates: 3 }],
      weekdays: [{ label: 'Пт', pages: 150, updates: 3 }],
      timeline: [],
      member_activity: [
        {
          member_id: owner,
          name: 'Анна',
          date: '2026-11-09',
          period: 'Вечер · 18–24',
          pages: 150,
          updates: 3,
        },
      ],
      top_liked: [],
      top_disliked: [],
    },
  ];
  await api.connect(context);
  await page.goto('/#/admin?section=reports');
  await choosePaper(page, 'Книга', id);
  await expect(page.getByRole('heading', { name: 'Отчётная книга', exact: true })).toBeVisible();
  await expect(page.getByText('150', { exact: true })).toBeVisible();
  await page.getByText('Журнал обновлений участников', { exact: true }).click();
  await expect(page.getByText('150 стр. · обновлений: 3', { exact: true })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать отчёт', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('book-club-report.html');
  await page.setViewportSize({ width: 320, height: 640 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '../../work/reader-admin-report.png', fullPage: true });
});

test('редакционный дизайн: локальные кириллические шрифты, сетка обложек и карточка без пересечений', async ({
  page,
  context,
}) => {
  const api = backend(),
    id = '20000000-0000-4000-8000-000000000071',
    fonts: string[] = [];
  const base = {
    description: '',
    genre: '',
    year: null,
    isbn: '',
    cover: '',
    default_pages: 300,
    status: 'planned',
  };
  api.extra.club_books = [
    {
      ...base,
      id,
      title: 'Очень длинное название книги для узкого экрана',
      authors: 'Автор с длинным именем',
    },
    {
      ...base,
      id: '20000000-0000-4000-8000-000000000072',
      title: 'Вторая книга',
      authors: 'Другой автор',
    },
    {
      ...base,
      id: '20000000-0000-4000-8000-000000000073',
      title: 'Третья книга',
      authors: 'Автор',
    },
  ];
  page.on('request', (r) => {
    if (r.resourceType() === 'font') fonts.push(r.url());
  });
  await api.connect(context);
  await context.addInitScript(() => {
    window.Telegram!.WebApp.contentSafeAreaInset = { top: 32, bottom: 24 };
  });
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/#/club?tab=all');
  await expect(page.locator('.club-catalog .cover')).toHaveCount(3);
  await page.evaluate(() => document.fonts.ready);
  expect(
    await page.evaluate(() =>
      document.fonts.check('500 32px "Cormorant Garamond"', 'Книжный клуб'),
    ),
  ).toBe(true);
  expect(
    await page
      .getByRole('heading', { name: 'Клуб', exact: true })
      .evaluate((el) => getComputedStyle(el).fontFamily),
  ).toContain('Cormorant');
  expect(fonts.length).toBeGreaterThan(0);
  expect(fonts.every((url) => new URL(url).hostname === '127.0.0.1')).toBe(true);
  const cover = page.locator('.club-catalog .cover').first();
  const box = (await cover.boundingBox())!;
  expect(box.height / box.width).toBeCloseTo(1.5, 1);
  expect(
    await page
      .locator('.mobile-header')
      .evaluate((el) => parseFloat(getComputedStyle(el).paddingTop)),
  ).toBeGreaterThanOrEqual(50);
  expect(
    await page
      .locator('.bottom-nav')
      .evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom)),
  ).toBeGreaterThanOrEqual(31);
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.goto('/#/club/' + id);
    const jacket = (await page.locator('.book-detail-compact > .cover').boundingBox())!;
    const heading = (await page.locator('.book-detail-heading').boundingBox())!;
    expect(jacket.x + jacket.width).toBeLessThanOrEqual(heading.x);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.goto('/#/club?tab=all');
  }
});

test('редакционный дизайн: контраст текста и основной кнопки во всех палитрах и темах', async ({
  page,
  context,
}) => {
  const api = backend();
  await api.connect(context);
  await page.goto('/#/profile');
  const contrast = async () =>
    page.getByRole('link', { name: 'Управление клубом', exact: true }).evaluate((el) => {
      const luminance = (value: string) => {
        const rgb = value
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map(Number)
          .map((n) => {
            const v = n / 255;
            return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
          });
        return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
      };
      const ratio = (a: string, b: string) => {
        const x = luminance(a),
          y = luminance(b);
        return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
      };
      const button = getComputedStyle(el),
        body = getComputedStyle(document.body);
      return {
        button: ratio(
          button.color,
          button.backgroundColor === 'rgba(0, 0, 0, 0)'
            ? getComputedStyle(el, '::before').backgroundColor
            : button.backgroundColor,
        ),
        body: ratio(body.color, body.backgroundColor),
      };
    });
  const paperColors = new Set<string>();
  for (const palette of ['library', 'forest', 'beer', 'coffee', 'sea']) {
    await choosePaper(page, 'Палитра', palette);
    await expect(page.locator('html')).toHaveAttribute('data-palette', palette);
    for (const theme of ['light', 'dark']) {
      await choosePaper(page, 'Тема', theme);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      paperColors.add(
        await page
          .locator('.profile-corner-paper')
          .evaluate((el) => getComputedStyle(el).backgroundColor),
      );
      const drawn = await page
        .locator('.paper-frame-motif > g')
        .evaluateAll((nodes) =>
          nodes
            .filter((el) => getComputedStyle(el).display !== 'none')
            .map((el) => el.getAttribute('data-art')),
        );
      expect(drawn).toEqual([palette]);
      if (theme === 'dark')
        expect(
          await page
            .locator('.paper-frame-corner')
            .evaluateAll((nodes) => nodes.every((el) => getComputedStyle(el).display === 'none')),
        ).toBe(true);
      await expect
        .poll(async () => (await contrast()).body, { message: palette + ' ' + theme + ' body' })
        .toBeGreaterThanOrEqual(4.5);
      await expect
        .poll(async () => (await contrast()).button, { message: palette + ' ' + theme + ' button' })
        .toBeGreaterThanOrEqual(4.5);
    }
  }
  expect(paperColors.size).toBe(10);
});

test('восемь сюжетов используются без повторов и не перекрывают заголовки или кнопки', async ({
  page,
  context,
}) => {
  const api = backend();
  await api.connect(context);
  const scenes: Record<string, string> = {
    '/': 'reader',
    '/club': 'carrying',
    '/members': 'discussion',
    '/books': 'headphones',
    '/quotes': 'writing',
    '/meetings': 'conversation',
    '/profile': 'coffee',
  };
  for (const width of [320, 390]) {
    const seen = new Set<string>();
    await page.setViewportSize({ width, height: 844 });
    for (const route of ['/', '/club', '/members', '/books', '/quotes', '/meetings', '/profile']) {
      await page.goto('/#' + route);
      const picture = page.locator('main .reader-illustration');
      await expect(picture).toHaveCount(1);
      await expect(picture).toBeVisible();
      await expect(picture).toHaveAttribute('data-reader-scene', scenes[route]);
      expect(seen.has(scenes[route])).toBe(false);
      seen.add(scenes[route]);
      await page.evaluate(() => document.fonts.ready);
      await expect
        .poll(() =>
          page.locator('.reader-illustration img').evaluateAll((images) =>
            images.every((node) => {
              const img = node as HTMLImageElement;
              return (
                img.complete &&
                img.naturalWidth === 1254 &&
                img.naturalHeight === 1254 &&
                new URL(img.src).origin === location.origin
              );
            }),
          ),
        )
        .toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      expect(
        await page
          .locator('.paper-fragment, .reader-illustration')
          .evaluateAll((nodes) =>
            nodes.every(
              (node) =>
                node.getAttribute('aria-hidden') === 'true' &&
                getComputedStyle(node).pointerEvents === 'none',
            ),
          ),
      ).toBe(true);
      const art = page.locator('.page-heading > .heading-collage');
      if (await art.count()) {
        const picture = (await art.boundingBox())!;
        const title = (await page.locator('.page-heading h1').boundingBox())!;
        expect(title.x + title.width).toBeLessThanOrEqual(picture.x);
      }
      const marginReader = page.locator('.page-heading > .heading-reader:visible');
      if (await marginReader.count()) {
        const picture = (await marginReader.boundingBox())!;
        const title = (await page.locator('.page-heading h1').boundingBox())!;
        expect(title.x + title.width).toBeLessThanOrEqual(picture.x);
      }
      if (['/books', '/quotes'].includes(route)) {
        await page.getByRole('button', { name: 'Добавить', exact: true }).click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await page.getByRole('dialog').getByRole('button', { name: 'Назад', exact: true }).click();
        await expect(page.getByRole('dialog')).not.toBeVisible();
      }
    }
    await page.getByRole('button', { name: 'Ещё', exact: true }).click();
    const more = page.getByRole('dialog', { name: 'Разделы клуба', exact: true });
    await expect(more.locator('.reader-illustration')).toHaveCount(1);
    await expect(more.locator('.reader-illustration')).toHaveAttribute(
      'data-reader-scene',
      'boardgames',
    );
    seen.add('boardgames');
    expect(seen.size).toBe(8);
    await more.getByRole('button', { name: 'Назад', exact: true }).click();
  }
});

test('плоский интерфейс без рамок и текстур сохраняет читателей и сетку обложек', async ({
  page,
  context,
}) => {
  const api = backend();
  api.extra.club_books = Array.from({ length: 8 }, (_, i) => ({
    id: `20000000-0000-4000-8000-00000000008${i}`,
    title: `Книга ${i + 1}`,
    authors: 'Автор',
    description: '',
    genre: '',
    year: null,
    isbn: '',
    cover: '',
    default_pages: 300,
    status: 'planned',
  }));
  await api.connect(context);
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    for (const route of ['/', '/club?tab=all', '/profile']) {
      await page.goto('/#' + route);
      await expect(
        page.locator('.creative-insert, .scrapbook-image, .book-edition-mark'),
      ).toHaveCount(0);
      await expect(page.locator('body')).not.toContainText(/между\s+строк/i);
      expect(
        await page.locator('body').evaluate((el) => getComputedStyle(el).backgroundImage),
      ).toBe('none');
      await expect(page.locator('.reader-illustration:visible').first()).toBeVisible();
      expect(
        await page
          .locator(
            'button, input, select, textarea, .panel, .cover, .quote-card, .action-menu-panel',
          )
          .evaluateAll((nodes) =>
            nodes.every((el) => {
              const s = getComputedStyle(el);
              return (
                s.boxShadow === 'none' &&
                s.borderRadius === '0px' &&
                s.borderTopWidth === '0px' &&
                s.borderRightWidth === '0px' &&
                s.borderBottomWidth === '0px' &&
                s.borderLeftWidth === '0px' &&
                s.backgroundImage === 'none'
              );
            }),
          ),
      ).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      if (route.startsWith('/club')) {
        await expect(page.locator('.club-catalog .book-card')).toHaveCount(8);
        const cover = (await page.locator('.club-catalog .cover').first().boundingBox())!;
        expect(cover.height / cover.width).toBeCloseTo(1.5, 1);
        await expect(
          page.locator(
            '.club-catalog .jacket-paper, .club-catalog .jacket-tape, .club-catalog .jacket-motif',
          ),
        ).toHaveCount(0);
      }
    }
  }
});

test('спокойный интерфейс: второстепенные действия открываются по запросу, Escape закрывает только меню', async ({
  page,
  context,
}) => {
  const api = backend();
  await api.connect(context);
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/#/books');
  await expect(page.getByRole('button', { name: 'Мои полки', exact: true })).not.toBeVisible();
  await openActions(page, 'Настройки библиотеки');
  const libraryMenu = page.locator('.action-menu[open] .action-menu-panel');
  const box = (await libraryMenu.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(12);
  expect(box.x + box.width).toBeLessThanOrEqual(308);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Мои полки', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Настройки библиотеки' })).toBeFocused();
  await expect(libraryMenu).not.toBeVisible();
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await page.getByRole('button', { name: 'Добавить вручную', exact: true }).click();
  await page.getByLabel('Название', { exact: true }).fill('Моя спокойная книга');
  await page.getByLabel('Страниц в моём издании').fill('200');
  await page.getByRole('button', { name: 'Сохранить книгу', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.locator('.personal-book-card').getByRole('heading').click();
  const book = page.getByRole('dialog', { name: 'Моя книга', exact: true });
  await expect(
    book.getByRole('button', { name: 'Издание и обложка', exact: true }),
  ).not.toBeVisible();
  await openActions(book, 'Действия с книгой');
  await page.keyboard.press('Escape');
  await expect(book).toBeVisible();
  await expect(book.getByRole('button', { name: 'Действия с книгой' })).toBeFocused();
  await openActions(book, 'Действия с книгой');
  await book.getByRole('button', { name: 'Издание и обложка', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Издание и обложка', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('разделы книги перелистываются горизонтальным свайпом, вертикальный жест, край и мышь не переключают раздел', async ({
  page,
  context,
}) => {
  const api = backend(),
    id = '20000000-0000-4000-8000-000000000097';
  api.extra.club_books = [
    {
      id,
      title: 'Книга для жестов',
      authors: 'Автор',
      description: '',
      genre: '',
      year: null,
      isbn: '',
      cover: '',
      status: 'planned',
      default_pages: 200,
    },
  ];
  await api.connect(context);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/club/' + id);
  const content = page.locator('.book-swipe-content');
  const gesture = async (from: [number, number], to: [number, number], pointerType = 'touch') => {
    await content.dispatchEvent('pointerdown', {
      pointerType,
      pointerId: 1,
      isPrimary: true,
      clientX: from[0],
      clientY: from[1],
    });
    await content.dispatchEvent('pointerup', {
      pointerType,
      pointerId: 1,
      isPrimary: true,
      clientX: to[0],
      clientY: to[1],
    });
  };
  const active = page.locator('.book-section-nav button.active');
  await expect(active).toHaveText('О книге');
  await gesture([280, 450], [100, 455]);
  await expect(active).toHaveText('Цитаты');
  await gesture([200, 350], [205, 600]);
  await expect(active).toHaveText('Цитаты');
  await gesture([12, 350], [180, 355]);
  await expect(active).toHaveText('Цитаты');
  await gesture([280, 450], [100, 455], 'mouse');
  await expect(active).toHaveText('Цитаты');
  await gesture([100, 450], [280, 455]);
  await expect(active).toHaveText('О книге');
  await page.getByRole('button', { name: 'В мои книги', exact: true }).click();
  await page.getByRole('button', { name: 'Сохранить книгу', exact: true }).click();
  const personal = page.getByRole('dialog', { name: 'Моя книга', exact: true });
  await expect(personal).toBeVisible();
  await expect(personal.locator('.book-section-nav button.active')).toHaveText('Заметки');
  await gesture([280, 450], [100, 455]);
  await expect(personal.locator('.book-section-nav button.active')).toHaveText('Мысли');
  await gesture([200, 350], [205, 600]);
  await expect(personal.locator('.book-section-nav button.active')).toHaveText('Мысли');
});

test('клуб переключает карточки и список, сохраняет вид, поиск и переход к книге', async ({
  page,
  context,
}) => {
  const api = backend();
  const first = '20000000-0000-4000-8000-000000000091';
  api.extra.club_books = ['Первая книга', 'Вторая книга'].map((title, i) => ({
    id: i ? '20000000-0000-4000-8000-000000000092' : first,
    title,
    authors: 'Автор',
    description: 'Аннотация',
    genre: 'Роман',
    year: 2020,
    isbn: '',
    cover: '',
    default_pages: 300,
    status: 'planned',
  }));
  await api.connect(context);
  await page.goto('/#/club?tab=all');
  await expect(
    page.getByRole('button', { name: 'Вид клуба: Список', exact: true }),
  ).not.toBeVisible();
  await openActions(page, 'Настройки каталога клуба');
  await expect(
    page.getByRole('button', { name: 'Вид клуба: Карточки', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Вид клуба: Список', exact: true }).click();
  await expect(page.locator('.club-catalog')).toHaveClass(/catalog-list/);
  await expect(
    page.locator(
      '.club-catalog .jacket-paper, .club-catalog .jacket-tape, .club-catalog .jacket-motif',
    ),
  ).toHaveCount(0);
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const cover = (await page.locator('.club-catalog .cover').first().boundingBox())!;
    expect(cover.height / cover.width).toBeCloseTo(1.5, 1);
  }
  await page.getByLabel('Поиск книг клуба').fill('Первая');
  await page.getByRole('heading', { name: 'Первая книга', exact: true }).click();
  await expect(page.locator('.book-overview')).toContainText('Аннотация');
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await expect(page.getByLabel('Поиск книг клуба')).toHaveValue('Первая');
  await page.reload();
  await expect(page.locator('.club-catalog')).toHaveClass(/catalog-list/);
  await openActions(page, 'Настройки каталога клуба');
  await page.getByRole('button', { name: 'Вид клуба: Карточки', exact: true }).click();
  await expect(page.locator('.club-catalog')).toHaveClass(/catalog-grid/);
});

test('бумажный выбор в фильтрах закрывает только верхнее окно и возвращает фокус', async ({
  page,
  context,
}) => {
  const api = backend();
  await api.connect(context);
  await page.goto('/#/quotes?tab=club');
  await page.getByRole('button', { name: 'Фильтры цитат', exact: true }).click();
  const filters = page.getByRole('dialog', { name: 'Фильтры цитат', exact: true });
  const trigger = filters.getByRole('button', { name: 'Сортировка цитат', exact: true });
  await trigger.click();
  const choices = page.getByRole('dialog', { name: 'Сортировка цитат', exact: true });
  await expect(choices.getByRole('button', { name: 'Сначала новые', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.keyboard.press('Escape');
  await expect(choices).not.toBeVisible();
  await expect(filters).toBeVisible();
  await expect(trigger).toBeFocused();
  await choosePaper(page, 'Сортировка цитат', 'likes');
  await filters.getByRole('button', { name: 'Показать цитаты', exact: true }).click();
  expect(page.url()).toContain('sort=likes');
  await expect(filters).not.toBeVisible();
});

test('книга открывает полки видимой кнопкой, первая полка создаётся и назначается там же', async ({
  page,
  context,
}) => {
  const api = backend();
  await api.connect(context);
  await page.goto('/#/books');
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await page.getByRole('button', { name: 'Добавить вручную', exact: true }).click();
  await page.getByLabel('Название', { exact: true }).fill('На моей полке');
  await page.getByRole('button', { name: 'Сохранить книгу', exact: true }).click();
  await page
    .locator('.personal-book-card')
    .getByRole('heading', { name: 'На моей полке', exact: true })
    .click();
  const book = page.getByRole('dialog', { name: 'Моя книга', exact: true });
  await expect(book.getByRole('button', { name: 'На полки', exact: true })).toBeVisible();
  await book.getByRole('button', { name: 'На полки', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Полки книги', exact: true });
  await picker.getByLabel('Новая полка', { exact: true }).fill('Мои любимые');
  await picker.getByRole('button', { name: 'Создать полку', exact: true }).click();
  await expect(picker.getByLabel('Мои любимые', { exact: true })).toBeChecked();
  await picker.getByRole('button', { name: 'Сохранить полки', exact: true }).click();
  await book.getByRole('button', { name: 'Назад', exact: true }).click();
  await choosePaper(page, 'Полка', { label: 'Мои любимые' });
  await expect(page.locator('.personal-book-card')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('.personal-book-card').getByRole('heading')).toHaveText(
    'На моей полке',
  );
});
