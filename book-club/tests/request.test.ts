// @vitest-environment node
import { it, expect, vi, afterEach } from 'vitest';
import { requestJson } from '../supabase/functions/_shared/request';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it('работает без современных методов AbortSignal на мобильном WebView', async () => {
  vi.stubGlobal('AbortSignal', {});
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ ok: true })),
  );
  expect((await requestJson<{ ok: boolean }>('https://club.test.invalid')).data.ok).toBe(true);
});
it('прерывает запрос по таймауту и отличает его от отсутствия сети', async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () =>
            reject(new DOMException('Abort', 'AbortError')),
          );
        }),
    ),
  );
  const pending = requestJson('https://club.test.invalid', {}, 1000);
  const checked = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });
  await vi.advanceTimersByTimeAsync(1000);
  await checked;
});
it('сохраняет отмену поиска пользователем и не отправляет уже отменённый запрос', async () => {
  const abort = new AbortController();
  abort.abort();
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  await expect(
    requestJson('https://club.test.invalid', { signal: abort.signal }),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(fetcher).not.toHaveBeenCalled();
});
