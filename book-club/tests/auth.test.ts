// @vitest-environment node
import { createHmac } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { validateInitData } from '../supabase/functions/_shared/telegram';
const token = '123:test-token-for-unit-tests';
function signed(date = 10000, user = { id: 42, first_name: 'Анна' }) {
  const p = new URLSearchParams({
    auth_date: String(date),
    user: JSON.stringify(user),
    query_id: 'test',
  });
  const text = [...p.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const key = createHmac('sha256', 'WebAppData').update(token).digest();
  p.set('hash', createHmac('sha256', key).update(text).digest('hex'));
  return p.toString();
}
describe('Telegram initData', () => {
  it('принимает подписанные данные', async () => {
    expect((await validateInitData(signed(), token, 3600, 10001)).id).toBe(42);
  });
  it('отклоняет подмену Telegram ID', async () => {
    await expect(
      validateInitData(signed().replace('42', '43'), token, 3600, 10001),
    ).rejects.toThrow();
  });
  it('отклоняет истёкшую и будущую авторизацию', async () => {
    await expect(validateInitData(signed(), token, 3600, 20000)).rejects.toThrow();
    await expect(validateInitData(signed(20000), token, 3600, 10000)).rejects.toThrow();
  });
  it('отклоняет повторяющиеся параметры', async () => {
    await expect(
      validateInitData(`${signed()}&auth_date=10000`, token, 3600, 10001),
    ).rejects.toThrow();
  });
});
