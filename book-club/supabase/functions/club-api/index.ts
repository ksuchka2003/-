import { endpoint, body, caller, checked } from '../_shared/http.ts';
Deno.serve(
  endpoint(async (req) => {
    const { db, member } = await caller(req);
    const input = await body(req);
    if (typeof input.action !== 'string' || !input.data || typeof input.data !== 'object')
      throw new Error('Неверный запрос');
    if (input.action.startsWith('admin.') && member.role !== 'admin')
      throw new Error('Требуется администратор');
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
