import type { Metadata } from './domain';
import { searchProviders, normalizedIsbn } from '../supabase/functions/_shared/book-search';
import { action, configured, currentIdentity } from './cloud';
export { normalizedIsbn };
const cache = new Map<string, { time: number; data: Metadata[] }>();
export async function searchBooks(query: string, signal?: AbortSignal): Promise<Metadata[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const key = normalizedIsbn(q) || q.toLocaleLowerCase('ru');
  const hit = cache.get(key);
  if (hit && Date.now() - hit.time < 600000) return hit.data;
  const data: Metadata[] =
    configured && currentIdentity()
      ? await action('book.search', { query: q })
      : await searchProviders(q, signal);
  if (signal?.aborted) throw new DOMException('Отменено', 'AbortError');
  if (data.length) cache.set(key, { time: Date.now(), data });
  return data;
}
