import type { Page } from '@playwright/test';
export async function editOpenBook(page: Page) {
  const card = page.getByRole('dialog', { name: 'Карточка книги', exact: true });
  await card.getByRole('button', { name: 'Действия с книгой', exact: true }).click();
  await card.getByRole('button', { name: 'Изменить книгу', exact: true }).click();
}
export async function openBookEditor(page: Page, title: string) {
  await page
    .locator('.personal-book-card')
    .getByRole('heading', { name: title, exact: true })
    .click();
  await editOpenBook(page);
}
