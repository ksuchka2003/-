import { test, expect, type Page } from '@playwright/test';
async function addBook(page: Page) {
  await page.goto('/#/books');
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Название', { exact: true }).fill('Дюна');
  await dialog.getByLabel('Автор', { exact: true }).fill('Фрэнк Герберт');
  await dialog.getByLabel('Страниц в моём издании').fill('480');
  await dialog.getByLabel('Прочитано страниц').fill('200');
  await dialog.getByLabel('Личный статус').selectOption('reading');
  await dialog.getByRole('button', { name: 'Сохранить книгу' }).click();
  await expect(dialog).not.toBeVisible();
}
test.beforeEach(async ({ page }) => {
  await page.route('https://telegram.org/**', (route) => route.abort());
});
test('узкий экран: поиск ISBN по Enter, форма без переполнения и меню разделов', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.route('https://www.googleapis.com/books/**', (r) =>
    r.fulfill({
      json: {
        items: [
          {
            volumeInfo: {
              title: 'Найденное издание',
              authors: ['Автор'],
              pageCount: 280,
              industryIdentifiers: [{ type: 'ISBN_10', identifier: '536700198X' }],
            },
          },
        ],
      },
    }),
  );
  await page.route('https://openlibrary.org/**', (r) => r.fulfill({ json: {} }));
  await page.goto('/#/books');
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const lookup = dialog.getByLabel('Поиск книги по названию, автору или ISBN');
  await lookup.fill('536700198Х');
  await lookup.press('Enter');
  await expect(dialog.locator('.lookup-results button')).toHaveCount(1);
  await dialog.locator('.lookup-results button').click();
  await expect(dialog.getByLabel('Название', { exact: true })).toHaveValue('Найденное издание');
  await expect(dialog.getByLabel('ISBN', { exact: true })).toHaveValue('536700198X');
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await dialog.getByRole('button', { name: 'Сохранить книгу' }).click();
  await page.getByRole('button', { name: 'Ещё', exact: true }).click();
  await page.getByRole('dialog').getByRole('link', { name: 'Участники', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Участники', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Мои книги' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('книга: добавление, редактирование, сохранение после перезагрузки, удаление', async ({
  page,
}) => {
  await addBook(page);
  await expect(page.getByRole('heading', { name: 'Дюна', exact: true })).toBeVisible();
  await expect(page.getByText('42%', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('heading', { name: 'Дюна', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Приватные заметки').fill('Личная мысль');
  await dialog.getByLabel('Прочитано страниц').fill('240');
  await dialog.getByRole('button', { name: 'Сохранить книгу' }).click();
  await expect(page.getByText('50%', { exact: true })).toBeVisible();
  await page.getByRole('heading', { name: 'Дюна', exact: true }).click();
  await expect(dialog.getByLabel('Приватные заметки')).toHaveValue('Личная мысль');
  page.once('dialog', (d) => d.accept());
  await dialog.getByRole('button', { name: 'Удалить', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Пока нет книг' })).toBeVisible();
});
test('цитаты: создание, избранное, корзина и восстановление', async ({ page }) => {
  await addBook(page);
  await page.goto('/#/quotes');
  await expect(page.getByRole('heading', { name: 'Цитаты', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Книга', { exact: true }).selectOption({ label: 'Дюна' });
  await dialog.getByLabel('Текст цитаты').fill('Страх убивает разум');
  await dialog.getByLabel('Страница', { exact: true }).fill('15');
  await dialog.getByRole('button', { name: 'Сохранить цитату' }).click();
  await expect(page.getByText('Страх убивает разум', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'В избранное', exact: true }).click();
  await page.getByRole('button', { name: 'Избранное', exact: true }).click();
  await expect(page.getByText('Страх убивает разум', { exact: true })).toBeVisible();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'В корзину', exact: true }).click();
  await page.getByRole('button', { name: 'Корзина', exact: true }).click();
  await expect(page.getByText('Страх убивает разум', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Восстановить' }).click();
  await page.getByRole('button', { name: 'Все цитаты', exact: true }).click();
  await expect(page.getByText('Страх убивает разум', { exact: true })).toBeVisible();
});
test('локальная библиотека работает без сети после загрузки', async ({ page, context }) => {
  await addBook(page);
  await context.setOffline(true);
  await page.getByRole('heading', { name: 'Дюна', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Прочитано страниц').fill('300');
  await page.getByRole('button', { name: 'Сохранить книгу' }).click();
  await expect(page.getByText('63%', { exact: true })).toBeVisible();
  await expect(page.getByText('Нет сети · личные данные сохраняются')).toBeVisible();
  await context.setOffline(false);
});
test('экспорт и валидируемый импорт JSON', async ({ page }) => {
  await addBook(page);
  await page.goto('/#/profile');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Экспорт JSON' }).click();
  expect((await download).suggestedFilename()).toMatch(/\.json$/);
  const backup = {
    format: 'bookclub',
    version: 1,
    exportedAt: new Date().toISOString(),
    books: [],
    reviews: [],
    progress: [],
    quotes: [],
    settings: [],
  };
  await page.locator('input[type=file]').setInputFiles({
    name: 'backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Режим импорта').selectOption('replace');
  page.once('dialog', (d) => d.accept());
  await dialog.getByRole('button', { name: 'Импортировать' }).click();
  await page.goto('/#/books');
  await expect(page.getByRole('heading', { name: 'Пока нет книг' })).toBeVisible();
});
test('светлая и тёмная темы, мобильная ширина без горизонтальной прокрутки', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Книжный клуб' })).toBeVisible();
  await expect(
    page.getByText('Браузер не разрешил локальное хранилище.', { exact: false }),
  ).not.toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});
