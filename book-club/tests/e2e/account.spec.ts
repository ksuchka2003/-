import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import type { LibraryChange, LibraryRecord } from '../../src/privateTypes';

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
  const publications: unknown[] = [];
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
          table === 'private_library_records'
            ? [...records.values()]
            : table === 'member_profiles'
              ? [profile]
              : table === 'member_privacy_settings'
                ? [privacy]
                : [];
      }
      await route.fulfill({ headers, json: body });
    });
  }
  return { records, publications, connect };
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
    await form.getByLabel('Название', { exact: true }).fill('Синхронная книга');
    await form.getByLabel('Страниц в моём издании').fill('400');
    await form.getByLabel('Прочитано страниц').fill('100');
    await form.getByLabel('Приватные заметки').fill('Только для владельца');
    await form.getByRole('button', { name: 'Сохранить книгу' }).click();
    await expect.poll(() => api.records.size).toBeGreaterThanOrEqual(3);
    await synced(a);
    await b.goto('/#/books');
    await expect(b.getByRole('heading', { name: 'Синхронная книга' })).toBeVisible();
    await b.getByRole('heading', { name: 'Синхронная книга' }).click();
    await expect(b.getByLabel('Приватные заметки')).toHaveValue('Только для владельца');
    await b.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await a.goto('/#/quotes');
    await a.getByRole('button', { name: 'Добавить', exact: true }).click();
    await a.getByLabel('Книга', { exact: true }).selectOption({ label: 'Синхронная книга' });
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
    await a.getByRole('heading', { name: 'Синхронная книга' }).click();
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
    await a.getByRole('heading', { name: 'Синхронная книга' }).click();
    a.once('dialog', (d) => d.accept());
    await a.getByRole('dialog').getByRole('button', { name: 'Удалить', exact: true }).click();
    await expect
      .poll(() => [...api.records.values()].find((r) => r.kind === 'book')?.payload)
      .toBeNull();
    await synced(a);
    await b.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(b.getByRole('heading', { name: 'Пока нет книг' })).toBeVisible();
    expect(api.publications).toEqual([]);
  } finally {
    await first.close();
    await second.close();
  }
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
