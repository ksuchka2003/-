export type SearchBook = {
  title: string;
  authors: string;
  description: string;
  genre: string;
  year: number | null;
  isbn: string;
  cover: string;
  totalPages: number;
};
import { requestJson } from './request.ts';
const cache = new Map<string, { time: number; books: SearchBook[] }>();
export function normalizedIsbn(query: string): string | null {
  const raw = query
    .trim()
    .replace(/^ISBN(?:-1[03])?\s*:?\s*/i, '')
    .replace(/[\s\-–—]/g, '')
    .replace(/[хХx]/g, 'X');
  return /^(\d{9}[\dX]|\d{13})$/.test(raw) ? raw : null;
}
export function validIsbn(isbn: string): boolean {
  const total = [...isbn].reduce(
    (sum, digit, i) =>
      sum + (digit === 'X' ? 10 : Number(digit)) * (isbn.length === 10 ? 10 - i : i % 2 ? 3 : 1),
    0,
  );
  return total % (isbn.length === 10 ? 11 : 10) === 0;
}
const text = (value: unknown, max: number) =>
  typeof value === 'string' ? value.slice(0, max) : '';
const cover = (value: unknown) =>
  typeof value === 'string' && /^https?:\/\//.test(value)
    ? value.replace(/^http:/, 'https:').slice(0, 2048)
    : '';
const year = (value: unknown) => {
  const match = String(value || '').match(/\b(1[0-9]{3}|20[0-9]{2})\b/);
  return match ? Number(match[1]) : null;
};
const pages = (value: unknown) =>
  Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 1000000 ? Number(value) : 0;
async function get(url: string, signal?: AbortSignal) {
  const { response, data } = await requestJson<any>(url, { signal }, 6500);
  if (!response.ok) throw new Error('Поиск временно недоступен');
  return data;
}
export async function searchProviders(
  query: string,
  signal?: AbortSignal,
  googleKey = '',
): Promise<SearchBook[]> {
  const q = query.trim().slice(0, 200);
  if (q.length < 2) return [];
  const isbn = normalizedIsbn(q);
  if (isbn && !validIsbn(isbn))
    throw new Error('Проверьте ISBN: неверная контрольная цифра. Можно найти книгу по названию.');
  const key = isbn || q.toLocaleLowerCase('ru');
  const hit = cache.get(key);
  if (hit && Date.now() - hit.time < 600000) return hit.books;
  const googleUrl = new URL('https://www.googleapis.com/books/v1/volumes');
  googleUrl.searchParams.set('q', isbn ? `isbn:${isbn}` : q);
  googleUrl.searchParams.set('maxResults', '15');
  googleUrl.searchParams.set('printType', 'books');
  if (googleKey) googleUrl.searchParams.set('key', googleKey);
  const google = get(googleUrl.toString(), signal).then((data) =>
    (data.items || []).map((item: any): SearchBook => {
      const b = item.volumeInfo || {};
      return {
        title: text(b.title, 300),
        authors: text((b.authors || []).join(', '), 500),
        description: text(b.description, 10000),
        genre: text((b.categories || []).join(', '), 150),
        year: year(b.publishedDate),
        isbn:
          isbn ||
          text(
            (b.industryIdentifiers || []).find((i: any) => i.type === 'ISBN_13')?.identifier ||
              (b.industryIdentifiers || []).find((i: any) => i.type === 'ISBN_10')?.identifier,
            30,
          ),
        totalPages: pages(b.pageCount),
        cover: cover(b.imageLinks?.thumbnail),
      };
    }),
  );
  const library = isbn
    ? get(
        `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`,
        signal,
      ).then((data): SearchBook[] => {
        const b = data[`ISBN:${isbn}`];
        if (!b) return [];
        return [
          {
            title: text(b.title, 300),
            authors: text((b.authors || []).map((a: any) => a.name).join(', '), 500),
            description: '',
            genre: text(
              (b.subjects || [])
                .slice(0, 2)
                .map((a: any) => a.name)
                .join(', '),
              150,
            ),
            year: year(b.publish_date),
            isbn,
            totalPages: pages(b.number_of_pages),
            cover: cover(b.cover?.medium || b.cover?.large),
          },
        ];
      })
    : get(
        `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=15&lang=ru&fields=title,author_name,first_publish_year,isbn,cover_i,number_of_pages_median,subject`,
        signal,
      ).then((data): SearchBook[] =>
        (data.docs || []).map((b: any) => ({
          title: text(b.title, 300),
          authors: text((b.author_name || []).join(', '), 500),
          description: '',
          genre: text((b.subject || []).slice(0, 2).join(', '), 150),
          year: year(b.first_publish_year),
          isbn: text(b.isbn?.find((s: string) => s.length === 13) || b.isbn?.[0], 30),
          totalPages: pages(b.number_of_pages_median),
          cover: b.cover_i ? `https://covers.openlibrary.org/b/id/${Number(b.cover_i)}-M.jpg` : '',
        })),
      );
  const responses = await Promise.allSettled([google, library]);
  if (signal?.aborted) throw new DOMException('Отменено', 'AbortError');
  const successful = responses.filter(
    (r): r is PromiseFulfilledResult<SearchBook[]> => r.status === 'fulfilled',
  );
  if (!successful.length)
    throw new Error(
      'Сервисы поиска временно недоступны. Попробуйте позже или добавьте книгу вручную.',
    );
  const unique = new Map<string, SearchBook>();
  for (const b of successful.flatMap((r) => r.value).filter((b) => b.title)) {
    const id = b.isbn || `${b.title}:${b.authors}:${b.year}`.toLocaleLowerCase('ru');
    if (!unique.has(id)) unique.set(id, b);
  }
  const books = [...unique.values()];
  if (!books.length && successful.length < 2)
    throw new Error(
      'Один из каталогов временно недоступен, в другом совпадений нет. Попробуйте название или добавьте книгу вручную.',
    );
  if (books.length || successful.length === 2) {
    if (cache.size >= 100) cache.delete(cache.keys().next().value!);
    cache.set(key, { time: Date.now(), books });
  }
  return books;
}
