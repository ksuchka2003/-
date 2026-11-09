import { openBookEditor, writeEntry, expectEntry } from './helpers';
import { test, expect, type Page } from '@playwright/test';
async function addBook(page: Page) {
  await page.goto('/#/books');
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await page.getByRole('button', { name: 'Добавить вручную', exact: true }).click();
  await dialog.getByLabel('Название', { exact: true }).fill('Дюна');
  await dialog.getByLabel('Автор', { exact: true }).fill('Фрэнк Герберт');
  await dialog.getByText('Данные издания — необязательно', { exact: true }).click();
  await dialog.getByText('Моё чтение', { exact: true }).click();
  await dialog.getByLabel('Страниц в моём издании').fill('480');
  await dialog.getByLabel('Прочитано страниц').fill('200');
  await dialog
    .getByRole('group', { name: 'Личный статус' })
    .getByRole('button', { name: 'Читаю', exact: true })
    .click();
  await dialog.getByRole('button', { name: 'Сохранить книгу' }).click();
  await expect(dialog).not.toBeVisible();
}
test.beforeEach(async ({ page }) => {
  await page.route('https://telegram.org/**', (route) => route.abort());
});
test('узкий экран: ручное добавление не вызывает интернет-поиск, меню и форма без переполнения', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  let searches = 0;
  await page.route('https://www.googleapis.com/books/**', (r) => {
    searches++;
    return r.abort();
  });
  await page.route('https://openlibrary.org/**', (r) => {
    searches++;
    return r.abort();
  });
  await page.goto('/#/books');
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Найти в книгах клуба').fill('Новая книга');
  await dialog.getByRole('button', { name: 'Добавить вручную', exact: true }).click();
  await expect(dialog.getByLabel('Название', { exact: true })).toHaveValue('Новая книга');
  await dialog.getByText('Данные издания — необязательно', { exact: true }).click();
  await expect(dialog.getByLabel('ISBN', { exact: true })).toHaveCount(0);
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await dialog.getByRole('button', { name: 'Сохранить книгу' }).click();
  expect(searches).toBe(0);
  await page.getByRole('button', { name: 'Ещё', exact: true }).click();
  await page.getByRole('dialog').getByRole('link', { name: 'Участники', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Участники', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('книга: добавление, редактирование, сохранение после перезагрузки, удаление', async ({
  page,
}) => {
  await addBook(page);
  await expect(page.getByRole('heading', { name: 'Дюна', exact: true })).toBeVisible();
  await expect(page.getByText('42%', { exact: true })).toBeVisible();
  await page.reload();
  await openBookEditor(page, 'Дюна');
  const dialog = page.getByRole('dialog');

  await dialog.getByLabel('Прочитано страниц').fill('240');
  await dialog.getByRole('button', { name: 'Сохранить книгу' }).click();
  await expect(page.getByText('50%', { exact: true })).toBeVisible();
  await writeEntry(page, 'Дюна', 'Личная мысль');
  await openBookEditor(page, 'Дюна');

  page.once('dialog', (d) => d.accept());
  await dialog.getByRole('button', { name: 'В корзину', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Пока нет книг' })).toBeVisible();
  await page.getByRole('button', { name: 'Корзина · 1', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Дюна', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Восстановить книгу', exact: true }).click();
  await page.getByRole('button', { name: 'К библиотеке', exact: true }).click();
  await expectEntry(page, 'Дюна', 'Личная мысль');
});

test('черновики книги и цитаты переживают закрытие и перезагрузку, сохранённый черновик очищается', async ({
  page,
}) => {
  await page.goto('/#/books');
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await page.getByRole('button', { name: 'Добавить вручную', exact: true }).click();
  await page.getByLabel('Название', { exact: true }).fill('Незаконченная книга');
  await page.getByRole('dialog').getByRole('button', { name: 'Назад', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await expect(page.getByLabel('Название', { exact: true })).toHaveValue('Незаконченная книга');
  await expect(page.getByText('Черновик восстановлен', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Сохранить книгу', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.goto('/#/quotes');
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await page.getByLabel('Название книги', { exact: true }).fill('Незаконченная книга');
  await page.getByLabel('Текст цитаты').fill('Мысль, которую не хочется потерять');
  await page.getByRole('dialog').getByRole('button', { name: 'Назад', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await expect(page.getByLabel('Текст цитаты')).toHaveValue('Мысль, которую не хочется потерять');
  await page.getByRole('button', { name: 'Сохранить цитату', exact: true }).click();
  await expect(page.locator('blockquote')).toHaveText('Мысль, которую не хочется потерять');
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await expect(page.getByLabel('Текст цитаты')).toHaveValue('');
});

test('статус меняется с карточки без полной формы, завершение обновляет страницы', async ({
  page,
}) => {
  await addBook(page);
  await page.getByRole('button', { name: 'Изменить статус: Дюна', exact: true }).click();
  const menu = page.getByRole('dialog', { name: 'Статус чтения', exact: true });
  await expect(menu.getByLabel('Название', { exact: true })).toHaveCount(0);
  await menu.getByRole('button', { name: 'Прочитано', exact: true }).click();
  await expect(menu).not.toBeVisible();
  await expect(page.locator('.personal-book-card')).toContainText('480 из 480');
  await expect(page.locator('.personal-book-card')).toContainText('100%');
  await page.reload();
  await expect(page.locator('.quick-status')).toHaveText(/Прочитано/);
  await page.getByRole('button', { name: 'Изменить статус: Дюна', exact: true }).click();
  await menu.getByRole('button', { name: 'Отложено', exact: true }).click();
  await expect(menu).not.toBeVisible();
  await expect(page.locator('.quick-status')).toHaveText(/Отложено/);
});
test('цитаты: создание, избранное, корзина и восстановление', async ({ page }) => {
  await addBook(page);
  await page.goto('/#/quotes');
  await expect(page.getByRole('heading', { name: 'Цитаты', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Название книги', { exact: true }).fill('Дюн');
  await dialog.getByRole('option', { name: /Дюна/ }).click();
  await dialog.getByLabel('Текст цитаты').fill('Страх убивает разум');
  await dialog.getByText('Страница, глава и комментарий', { exact: true }).click();
  await dialog.getByLabel('Страница', { exact: true }).fill('15');
  await dialog.getByLabel('Глава', { exact: true }).fill('Глава 1');
  await dialog.getByLabel('Комментарий', { exact: true }).fill('Стоит обсудить');
  await dialog.getByRole('button', { name: 'Сохранить цитату' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText('Страх убивает разум', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Редактировать цитату', exact: true }).click();
  await expect(dialog.getByLabel('Страница', { exact: true })).not.toBeVisible();
  await dialog.getByLabel('Текст цитаты').fill('Страх убивает разум.');
  await page.setViewportSize({ width: 320, height: 420 });
  await expect(dialog.getByRole('button', { name: 'Сохранить цитату' })).toBeInViewport();
  await dialog.getByRole('button', { name: 'Сохранить цитату' }).click();
  await expect(dialog).not.toBeVisible();
  await page.setViewportSize({ width: 320, height: 760 });
  await expect(page.getByText('Стоит обсудить', { exact: true })).toBeVisible();
  await expect(page.getByText('Стр. 15', { exact: true })).not.toBeVisible();
  await page.locator('.source-disclosure summary').click();
  await expect(page.getByText('Стр. 15', { exact: true })).toBeVisible();
  await expect(page.getByText('Глава 1', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'В избранное', exact: true }).click();
  await page.getByRole('button', { name: 'Фильтры цитат', exact: true }).click();
  await page.getByLabel('Только избранное', { exact: true }).check();
  await page.getByRole('button', { name: 'Показать цитаты', exact: true }).click();
  await expect(page.getByText('Страх убивает разум.', { exact: true })).toBeVisible();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'В корзину', exact: true }).click();
  await page.getByLabel('Раздел цитат').selectOption('trash');
  await expect(page.getByText('Страх убивает разум.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Восстановить' }).click();
  await page.getByLabel('Раздел цитат').selectOption('mine');
  await expect(page.getByText('Страх убивает разум.', { exact: true })).toBeVisible();
});
test('локальная библиотека работает без сети после загрузки', async ({ page, context }) => {
  await addBook(page);
  await context.setOffline(true);
  await openBookEditor(page, 'Дюна');
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

test('книга с одним названием и обычная текстовая цитата без фото', async ({ page }) => {
  await page.goto('/#/books');
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await page.getByRole('button', { name: 'Добавить вручную', exact: true }).click();
  await page.getByLabel('Название', { exact: true }).fill('Минимальная книга');
  await page.getByRole('button', { name: 'Сохранить книгу' }).click();
  await expect(page.getByRole('heading', { name: 'Минимальная книга' })).toBeVisible();
  await page.goto('/#/quotes');
  await expect(page.getByRole('button', { name: /С фото|Добавить цитату с фото/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await page.getByLabel('Название книги', { exact: true }).fill('Текстовая книга');
  await expect(page.getByRole('dialog').locator('input[type=file]')).toHaveCount(0);
  await page.getByLabel('Текст цитаты').fill('Истории объединяют людей.');
  await page.getByRole('button', { name: 'Сохранить цитату' }).click();
  await expect(page.getByText('Истории объединяют людей.', { exact: true })).toBeVisible();
});
