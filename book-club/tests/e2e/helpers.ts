import { expect, type Page, type Locator } from '@playwright/test';
export async function choosePaper(page: Page, label: string, choice: string | { label: string }) {
  await page.getByRole('button', { name: label, exact: true }).click();
  const sheet = page.getByRole('dialog', { name: label, exact: true });
  const option =
    typeof choice === 'string'
      ? sheet.locator('[data-option-value=' + JSON.stringify(choice) + ']')
      : sheet.getByRole('button', { name: choice.label, exact: true });
  await option.click();
  await expect(sheet).not.toBeVisible();
}
export async function openActions(scope: Page | Locator, label: string) {
  const trigger = scope.getByRole('button', { name: label, exact: true });
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
}
export async function editOpenBook(page: Page) {
  const card = page.getByRole('dialog', { name: 'Моя книга', exact: true });
  await openActions(card, 'Действия с книгой');
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
