import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { getDB, openLibrary } from '../src/db';
import { queue, setSyncScope, copyPublicQuote } from '../src/local';
import { flushQueue } from '../src/cloud';
import { uid } from '../src/domain';
let scope: string;
beforeEach(() => {
  scope = uid();
  openLibrary(scope);
  setSyncScope(scope);
});
afterEach(async () => {
  await getDB().delete();
});
it('оставляет операцию при сетевой ошибке и повторяет её без дубликатов', async () => {
  const entity = uid();
  await queue('quote', entity, null);
  const send = vi
    .fn()
    .mockRejectedValueOnce(new Error('Нет сети'))
    .mockResolvedValueOnce({ ok: true });
  await flushQueue(send, scope);
  expect(await getDB().sync_queue.count()).toBe(1);
  expect((await getDB().sync_queue.toArray())[0].attempts).toBe(1);
  await flushQueue(send, scope);
  expect(await getDB().sync_queue.count()).toBe(0);
  expect(send).toHaveBeenCalledTimes(2);
});
it('не удаляет более новое изменение при подтверждении старого', async () => {
  const entity = uid();
  await queue('quote', entity, { text: 'Старое' });
  await flushQueue(async () => {
    await queue('quote', entity, { text: 'Новое' });
  }, scope);
  expect((await getDB().sync_queue.toArray())[0].payload?.text).toBe('Новое');
});
it('не отправляет операции другого аккаунта', async () => {
  await queue('quote', uid(), null);
  const send = vi.fn();
  await flushQueue(send, uid());
  expect(send).not.toHaveBeenCalled();
});
it('применяет отключение приватности раньше обычных публикаций', async () => {
  await queue('quote', uid(), { text: 'Публикация' });
  await queue('privacy', scope, { show_quotes: false });
  const order: string[] = [];
  await flushQueue(async (op) => {
    order.push(op.kind);
  }, scope);
  expect(order).toEqual(['privacy', 'quote']);
});
it('сохраняет независимую копию чужой цитаты и предотвращает повторное сохранение', async () => {
  const q = {
    id: uid(),
    book_id: uid(),
    title: 'Дюна',
    text: 'Мысль',
    page: 5,
    chapter: 'Глава',
    comment: '',
  };
  await copyPublicQuote(q, 'Анна');
  const saved = (await getDB().quotes.toArray())[0];
  expect(saved.id).not.toBe(q.id);
  expect(saved.sourceId).toBe(q.id);
  expect(saved.published).toBe(false);
  await expect(copyPublicQuote(q, 'Анна')).rejects.toThrow('уже');
});
