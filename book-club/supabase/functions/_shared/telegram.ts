export type TelegramUser = {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  startParam?: string;
};
const enc = new TextEncoder();
async function hmac(key: BufferSource, data: string) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  return crypto.subtle.sign('HMAC', k, enc.encode(data));
}
export async function validateInitData(
  raw: string,
  botToken: string,
  maxAge = 3600,
  seconds = Math.floor(Date.now() / 1000),
): Promise<TelegramUser> {
  if (raw.length > 16000) throw new Error('Слишком длинные initData');
  const p = new URLSearchParams(raw);
  if (new Set(p.keys()).size !== [...p.keys()].length)
    throw new Error('Повторяющиеся поля initData');
  const hash = p.get('hash') || '';
  if (!/^[a-f0-9]{64}$/i.test(hash)) throw new Error('Неверная подпись Telegram');
  p.delete('hash');
  const check = [...p.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = await hmac(enc.encode('WebAppData'), botToken);
  const key = await crypto.subtle.importKey(
    'raw',
    secret,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const signature = Uint8Array.from(hash.match(/../g)!, (x) => parseInt(x, 16));
  if (!(await crypto.subtle.verify('HMAC', key, signature, enc.encode(check))))
    throw new Error('Неверная подпись Telegram');
  const date = Number(p.get('auth_date'));
  if (!Number.isInteger(date) || date > seconds + 30 || seconds - date > maxAge || date <= 0)
    throw new Error('Сессия Telegram истекла. Откройте приложение заново.');
  const user = JSON.parse(p.get('user') || '{}');
  if (!Number.isSafeInteger(user.id) || user.id <= 0 || typeof user.first_name !== 'string')
    throw new Error('Пользователь Telegram отсутствует');
  return { ...user, startParam: p.get('start_param') || '' };
}
