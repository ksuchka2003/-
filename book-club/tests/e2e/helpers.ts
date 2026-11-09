import { expect, type Page } from '@playwright/test';
export async function editOpenBook(page: Page) {
  const card = page.getByRole('dialog', { name: 'Моя книга', exact: true });
  await card.getByRole('button', { name: 'Издание и обложка', exact: true }).click();
  await page.getByRole('dialog').getByText('Моё чтение', { exact: true }).click();
}
export async function openBookEditor(page: Page, title: string) {
  await page
    .locator('.personal-book-card')
    .getByRole('heading', { name: title, exact: true })
    .click();
  await editOpenBook(page);
}
export async function writeEntry(page: Page, title: string, text: string, thought = false) {
  await page
    .locator('.personal-book-card')
    .getByRole('heading', { name: title, exact: true })
    .click();
  const card = page.getByRole('dialog', { name: 'Моя книга', exact: true });
  await card.getByRole('button', { name: thought ? /^Мысли/ : /^Заметки/ }).click();
  await card
    .getByRole('button', { name: thought ? 'Добавить мысль' : 'Добавить заметку', exact: true })
    .click();
  await page.getByLabel(thought ? 'Законченная мысль' : 'Текст заметки').fill(text);
  await page
    .getByRole('button', { name: thought ? 'Сохранить мысль' : 'Сохранить заметку', exact: true })
    .click();
  await expect(card.getByText(text, { exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'Назад', exact: true }).click();
}
export async function expectEntry(page: Page, title: string, text: string, thought = false) {
  await page
    .locator('.personal-book-card')
    .getByRole('heading', { name: title, exact: true })
    .click();
  const card = page.getByRole('dialog', { name: 'Моя книга', exact: true });
  await card.getByRole('button', { name: thought ? /^Мысли/ : /^Заметки/ }).click();
  await expect(card.getByText(text, { exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'Назад', exact: true }).click();
}
