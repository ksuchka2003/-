import { it, expect, vi, afterEach } from 'vitest';
import { searchBooks } from '../src/bookSearch';
afterEach(() => vi.unstubAllGlobals());
it('позволяет продолжить поиск при отказе одного API и кеширует результат', async () => {
  const fetcher = vi
    .fn()
    .mockRejectedValueOnce(new Error('Google unavailable'))
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        docs: [
          {
            title: 'Солярис',
            author_name: ['Станислав Лем'],
            number_of_pages_median: 300,
            cover_i: 42,
          },
        ],
      }),
    });
  vi.stubGlobal('fetch', fetcher);
  const result = await searchBooks('Солярис тест');
  expect(result[0].totalPages).toBe(300);
  expect(result[0].cover).toContain('https://covers.openlibrary.org');
  await searchBooks('Солярис тест');
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it('предлагает ручной ввод, если оба API недоступны', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  await expect(searchBooks('Неизвестное издание 2026')).rejects.toThrow('вручную');
});
