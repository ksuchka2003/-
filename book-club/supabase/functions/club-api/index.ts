import { endpoint, body, caller, checked } from '../_shared/http.ts';
import { searchProviders } from '../_shared/book-search.ts';
Deno.serve(
  endpoint(async (req) => {
    const { db, member } = await caller(req);
    const input = await body(req);
    if (typeof input.action !== 'string' || !input.data || typeof input.data !== 'object')
      throw new Error('Неверный запрос');
    if (input.action.startsWith('admin.') && member.role !== 'admin')
      throw new Error('Требуется администратор');
    if (input.action === 'book.search') {
      if (typeof input.data.query !== 'string' || input.data.query.length > 200)
        throw new Error('Введите название, автора или ISBN длиной до 200 символов');
      return searchProviders(
        input.data.query,
        req.signal,
        Deno.env.get('GOOGLE_BOOKS_API_KEY') || '',
      );
    }
    if (input.action === 'admin.telegram') {
      const response = await fetch(
        `https://api.telegram.org/bot${Deno.env.get('TELEGRAM_BOT_TOKEN')}/getMe`,
        { signal: AbortSignal.timeout(8000) },
      );
      const info = await response.json();
      if (!info.ok) throw new Error('Telegram временно недоступен');
      return { username: info.result.username, hasMainApp: Boolean(info.result.has_main_web_app) };
    }
    if (input.action === 'admin.invitation') {
      const token = [...crypto.getRandomValues(new Uint8Array(24))]
        .map((x) => x.toString(16).padStart(2, '0'))
        .join('');
      const hash = [
        ...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))),
      ]
        .map((x) => x.toString(16).padStart(2, '0'))
        .join('');
      const invite = checked(
        await db.rpc('club_action', {
          p_action: 'admin.create_invite',
          p_data: { id: crypto.randomUUID(), token_hash: hash, max_uses: input.data.max_uses || 1 },
        }),
      );
      return { ...invite, token };
    }
    if (input.action === 'sync') {
      const d = input.data;
      if (d.kind === 'privacy') {
        const keys = [
          'show_finished',
          'show_current',
          'show_progress',
          'show_ratings',
          'show_reviews',
          'show_quotes',
        ];
        const patch = Object.fromEntries(
          Object.entries(d.payload || {}).filter(([key]) => keys.includes(key)),
        );
        checked(await db.rpc('sync_privacy_settings', { p_patch: patch, p_version: d.version }));
        return { ok: true };
      }
      checked(
        await db.rpc('sync_public', {
          p_kind: d.kind,
          p_entity: d.entityId,
          p_payload: d.payload,
          p_version: d.version,
        }),
      );
      return { ok: true };
    }
    if (input.action === 'private.sync')
      return checked(
        await db.rpc('sync_private_library', {
          p_changes: input.data.changes,
          p_device: input.data.device,
        }),
      );
    return checked(await db.rpc('club_action', { p_action: input.action, p_data: input.data }));
  }),
);
