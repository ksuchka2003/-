import { test, expect } from '@playwright/test';

test('камера: снимок превращается в цитату, камера выключается после снимка и закрытия формы', async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.addInitScript(() => {
    const state = { calls: [] as MediaStreamConstraints[], stopped: 0 };
    (window as any).__testCamera = state;
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async (constraints: MediaStreamConstraints) => {
          state.calls.push(constraints);
          const canvas = document.createElement('canvas');
          canvas.width = 1600;
          canvas.height = 600;
          const ctx = canvas.getContext('2d')!;
          ctx.fillStyle = 'white';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = 'black';
          ctx.font = '75px Georgia';
          ctx.fillText('Книжный клуб читает вместе.', 90, 200);
          ctx.fillText('Истории объединяют людей.', 90, 350);
          const stream = canvas.captureStream(5);
          for (const track of stream.getTracks()) {
            const stop = track.stop.bind(track);
            track.stop = () => {
              state.stopped++;
              stop();
            };
          }
          return stream;
        },
      },
    });
  });
  await page.goto('/#/quotes');
  await page.getByRole('button', { name: 'Добавить цитату с фото', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Сделать снимок', exact: true })).toBeEnabled();
  await page.setViewportSize({ width: 320, height: 760 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page
    .getByRole('group', { name: 'Камера для цитаты' })
    .screenshot({ path: '../../work/quote-camera-mobile.png' });
  await page.getByRole('button', { name: 'Сделать снимок', exact: true }).click();
  await expect(page.getByAltText('Фотография для распознавания цитаты')).toBeVisible();
  const first = await page.evaluate(() => (window as any).__testCamera);
  expect(first.stopped).toBe(first.calls.length);
  expect(await page.evaluate(() => (window as any).__testCamera.calls[0].audio)).toBe(false);
  await page.getByLabel('Название книги', { exact: true }).fill('Книга с камеры');
  await page.getByRole('button', { name: 'Распознать текст', exact: true }).click();
  await expect(page.getByLabel('Текст цитаты')).toHaveValue(/Истории объединяют людей/, {
    timeout: 90000,
  });
  await page.getByRole('button', { name: 'Сохранить цитату', exact: true }).click();
  await expect(page.locator('.quote-source').filter({ hasText: 'Книга с камеры' })).toBeVisible();
  await page.getByRole('button', { name: 'Добавить цитату с фото', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Сделать снимок', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const state = (window as any).__testCamera;
        return state.stopped === state.calls.length && state.calls.length > 0;
      }),
    )
    .toBe(true);
  await page.getByRole('button', { name: 'Добавить цитату с фото', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Сделать снимок', exact: true })).toBeEnabled();
  await page.getByLabel('Текст цитаты').fill('Черновик при сворачивании');
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await expect(page.getByRole('group', { name: 'Камера для цитаты' })).not.toBeVisible();
  await expect(page.getByLabel('Текст цитаты')).toHaveValue('Черновик при сворачивании');
  expect(
    await page.evaluate(() => {
      const state = (window as any).__testCamera;
      return state.stopped === state.calls.length;
    }),
  ).toBe(true);
});

test('отказ доступа к камере: понятная ошибка, системная съёмка и галерея сохраняют черновик', async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: () => Promise.reject(new DOMException('denied', 'NotAllowedError')) },
    }),
  );
  await page.goto('/#/quotes');
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await page.getByLabel('Текст цитаты').fill('Уже написанный текст');
  await page.getByRole('button', { name: 'Сфотографировать', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Разрешите Telegram доступ к камере');
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Системная камера', exact: true }).click(),
  ]);
  expect(await chooser.element().getAttribute('accept')).toBe('image/*');
  expect(await chooser.element().getAttribute('capture')).toBe('environment');
  const png = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 10;
    c.height = 10;
    return c.toDataURL().split(',')[1];
  });
  await chooser.setFiles({
    name: 'camera.png',
    mimeType: 'image/png',
    buffer: Buffer.from(png, 'base64'),
  });
  await expect(page.getByAltText('Фотография для распознавания цитаты')).toBeVisible();
  await expect(page.getByLabel('Текст цитаты')).toHaveValue('Уже написанный текст');
  const [gallery] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Из галереи', exact: true }).click(),
  ]);
  expect(await gallery.element().getAttribute('capture')).toBeNull();
});
