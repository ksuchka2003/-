import { it, expect, vi, afterEach } from 'vitest';
import { searchBooks } from '../src/bookSearch';
import { normalizedIsbn, validIsbn } from '../supabase/functions/_shared/book-search';
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
it('нормализует ISBN с кириллической Х и использует точный поиск без языкового фильтра', async () => {
  expect(normalizedIsbn('ISBN: 5-367-00198-Х')).toBe('536700198X');
  expect(validIsbn('536700198X')).toBe(true);
  const fetcher = vi
    .fn()
    .mockImplementation(async (url: string) => ({
      ok: true,
      json: async () =>
        url.includes('googleapis')
          ? { items: [] }
          : {
              'ISBN:536700198X': {
                title: 'Издание',
                authors: [{ name: 'Автор' }],
                number_of_pages: 250,
              },
            },
    }));
  vi.stubGlobal('fetch', fetcher);
  const found = await searchBooks('536700198Х');
  expect(found[0].isbn).toBe('536700198X');
  expect(found[0].authors).toBe('Автор');
  expect(fetcher.mock.calls[0][0]).toContain('isbn%3A536700198X');
  expect(fetcher.mock.calls[0][0]).not.toContain('langRestrict');
});
it('объясняет ошибку контрольной цифры и не отправляет неверный ISBN', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  await expect(searchBooks('9780000000000')).rejects.toThrow('контрольная');
  expect(fetcher).not.toHaveBeenCalled();
});
it('отличает частичный отказ каталога от отсутствия книги', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockRejectedValueOnce(new Error('quota'))
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) }),
  );
  await expect(searchBooks('9780140328721')).rejects.toThrow('Один из каталогов');
});
