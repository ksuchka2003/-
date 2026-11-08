import { useState } from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { beforeEach, afterEach, it, expect } from 'vitest';
import { getDB, openLibrary } from '../src/db';
import { uid } from '../src/domain';
import { exportBackup } from '../src/backup';
import { useDraft } from '../src/ui/useDraft';
function Form() {
  const [initial] = useState({ text: 'Исходное' });
  const draft = useDraft('test', initial);
  if (!draft.value) return null;
  return (
    <>
      <input
        aria-label="Текст"
        value={draft.value.text}
        onChange={(e) => draft.setValue({ text: e.target.value })}
      />
      <button onClick={() => void draft.discard()}>Сбросить</button>
      <button onClick={() => void draft.clear()}>Сохранить</button>
      <span>{draft.restored ? 'Восстановлен' : ''}</span>
    </>
  );
}
beforeEach(() => openLibrary(uid()));
afterEach(async () => {
  cleanup();
  await getDB().delete();
});
it('восстанавливает незаконченный текст после закрытия, сбрасывает по выбору и исключает его из экспорта', async () => {
  let view = render(<Form />);
  fireEvent.change(await screen.findByLabelText('Текст'), {
    target: { value: 'Незаконченная мысль' },
  });
  await waitFor(async () =>
    expect((await getDB().settings.get('_draft:test'))?.value).toEqual({
      text: 'Незаконченная мысль',
    }),
  );
  expect((await exportBackup()).settings).toEqual([]);
  expect(await getDB().sync_queue.count()).toBe(0);
  view.unmount();
  view = render(<Form />);
  expect(await screen.findByDisplayValue('Незаконченная мысль')).toBeVisible();
  expect(screen.getByText('Восстановлен')).toBeVisible();
  fireEvent.click(screen.getByText('Сбросить'));
  await waitFor(() => expect(screen.getByLabelText('Текст')).toHaveValue('Исходное'));
  await waitFor(async () => expect(await getDB().settings.get('_draft:test')).toBeUndefined());
});
it('успешное сохранение очищает черновик, возврат к исходному тексту не воскрешает старую версию', async () => {
  const view = render(<Form />);
  const input = await screen.findByLabelText('Текст');
  fireEvent.change(input, { target: { value: 'Изменено' } });
  await waitFor(async () => expect(await getDB().settings.get('_draft:test')).toBeDefined());
  fireEvent.change(input, { target: { value: 'Исходное' } });
  await waitFor(async () => expect(await getDB().settings.get('_draft:test')).toBeUndefined());
  fireEvent.change(input, { target: { value: 'Готовый текст' } });
  await waitFor(async () => expect(await getDB().settings.get('_draft:test')).toBeDefined());
  fireEvent.click(screen.getByText('Сохранить'));
  await waitFor(async () => expect(await getDB().settings.get('_draft:test')).toBeUndefined());
  view.unmount();
  render(<Form />);
  expect(await screen.findByDisplayValue('Исходное')).toBeVisible();
});
