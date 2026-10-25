import { type Metadata } from './domain';
const cache = new Map<string, { time: number; data: Metadata[] }>();
const safeCover = (s: string) => s.replace(/^http:/, 'https:');
export async function searchBooks(query: string, signal?: AbortSignal): Promise<Metadata[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const hit = cache.get(q);
  if (hit && Date.now() - hit.time < 3600000) return hit.data;
  const responses = await Promise.allSettled([
    fetch(
      `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=12&langRestrict=ru`,
      { signal },
    ).then(async (r) => {
      if (!r.ok) throw new Error('Google Books недоступен');
      const data = await r.json();
      return (data.items || []).map((item: { volumeInfo: Record<string, any> }): Metadata => {
        const b = item.volumeInfo;
        return {
          title: b.title || 'Без названия',
          authors: (b.authors || []).join(', '),
          description: b.description || '',
          genre: (b.categories || []).join(', '),
          year: parseInt(b.publishedDate) || null,
          isbn:
            (b.industryIdentifiers || []).find((i: { type: string }) => i.type === 'ISBN_13')
              ?.identifier || '',
          totalPages: b.pageCount || 0,
          cover: safeCover(b.imageLinks?.thumbnail || ''),
        };
      });
    }),
    fetch(
      `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=12&fields=key,title,author_name,first_publish_year,isbn,cover_i,number_of_pages_median,subject`,
      { signal },
    ).then(async (r) => {
      if (!r.ok) throw new Error('Open Library недоступна');
      const data = await r.json();
      return (data.docs || []).map((b: Record<string, any>): Metadata => ({
        title: b.title,
        authors: (b.author_name || []).join(', '),
        description: '',
        genre: (b.subject || []).slice(0, 2).join(', '),
        year: b.first_publish_year || null,
        isbn: b.isbn?.[0] || '',
        totalPages: b.number_of_pages_median || 0,
        cover: b.cover_i ? `https://covers.openlibrary.org/b/id/${b.cover_i}-M.jpg` : '',
      }));
    }),
  ]);
  if (signal?.aborted) throw new DOMException('Отменено', 'AbortError');
  const ok = responses.filter(
    (r): r is PromiseFulfilledResult<Metadata[]> => r.status === 'fulfilled',
  );
  if (!ok.length) throw new Error('Сервисы поиска недоступны. Можно добавить книгу вручную.');
  const data = ok.flatMap((r) => r.value);
  cache.set(q, { time: Date.now(), data });
  return data;
}
