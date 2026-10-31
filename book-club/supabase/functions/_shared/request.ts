// AbortSignal.timeout/any are absent in some Telegram mobile WebViews.
// Keep the timeout active until the response body has been read as well.
export async function requestJson<T = unknown>(
  url: string,
  init: RequestInit = {},
  timeoutMs = 20000,
): Promise<{ response: Response; data: T }> {
  const controller = new AbortController();
  const parent = init.signal;
  const abort = () => controller.abort();
  if (parent?.aborted) throw new DOMException('Запрос отменён', 'AbortError');
  parent?.addEventListener('abort', abort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    return { response, data: (await response.json()) as T };
  } catch (error) {
    if (timedOut) {
      const timeout = new Error('Сервер не ответил вовремя');
      timeout.name = 'TimeoutError';
      throw timeout;
    }
    throw error;
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener('abort', abort);
  }
}
