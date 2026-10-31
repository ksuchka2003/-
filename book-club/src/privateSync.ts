import { liveQuery } from 'dexie';
import { type LibraryDB } from './db';
import {
  bookSchema,
  progressSchema,
  reviewSchema,
  quoteSchema,
  validProgress,
  now,
  uid,
  message,
} from './domain';
import type {
  LibraryKind,
  LibraryPayload,
  LibraryRecord,
  LibraryBase,
  LibraryConflict,
  LibraryChange,
  LibraryReply,
  LibrarySyncState,
} from './privateTypes';

const names: Record<LibraryKind, string> = {
  book: 'personal_books',
  progress: 'reading_progress',
  review: 'personal_reviews',
  quote: 'quotes',
  setting: 'settings',
};
export const libraryKey = (kind: LibraryKind, id: string) => `${kind}:${id}`;
export function canonical(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
    .join(',')}}`;
}
const equal = (a: unknown, b: unknown) => canonical(a) === canonical(b);
function parse(kind: LibraryKind, payload: LibraryPayload): LibraryPayload {
  if (payload === null) return null;
  const schemas = {
    book: bookSchema,
    progress: progressSchema,
    review: reviewSchema,
    quote: quoteSchema,
  };
  if (kind === 'setting') {
    if (typeof payload.key !== 'string' || payload.key.startsWith('_') || payload.key === 'privacy')
      throw new Error('Неверная настройка библиотеки');
    return payload;
  }
  return schemas[kind].parse(payload) as unknown as Record<string, unknown>;
}
export function mergeLibraryRecord(
  base: LibraryPayload,
  local: LibraryPayload,
  cloud: LibraryPayload,
): { merged: LibraryPayload } | null {
  if (equal(local, cloud)) return { merged: local };
  if (equal(local, base)) return { merged: cloud };
  if (equal(cloud, base)) return { merged: local };
  if (!base || !local || !cloud) return null;
  const merged: Record<string, unknown> = {};
  for (const field of new Set([
    ...Object.keys(base),
    ...Object.keys(local),
    ...Object.keys(cloud),
  ])) {
    if (field === 'updatedAt') {
      merged[field] = [local[field], cloud[field]]
        .filter((v) => typeof v === 'string')
        .sort()
        .at(-1);
      continue;
    }
    if (equal(local[field], base[field])) merged[field] = cloud[field];
    else if (equal(cloud[field], base[field]) || equal(local[field], cloud[field]))
      merged[field] = local[field];
    else return null;
  }
  return { merged };
}
function localTables(db: LibraryDB) {
  return Object.values(names).map((n) => db.table(n));
}
async function getLocal(db: LibraryDB, kind: LibraryKind, id: string): Promise<LibraryPayload> {
  return (await db.table(names[kind]).get(id)) || null;
}
async function capture(db: LibraryDB) {
  const records = new Map<string, { kind: LibraryKind; id: string; payload: LibraryPayload }>();
  await db.transaction('r', localTables(db), async () => {
    for (const [kind, name] of Object.entries(names) as [LibraryKind, string][]) {
      for (const payload of (await db.table(name).toArray()) as Record<string, unknown>[]) {
        const id = String(payload.id || payload.bookId || payload.key);
        if (kind === 'setting' && (id.startsWith('_') || id === 'privacy')) continue;
        records.set(libraryKey(kind, id), { kind, id, payload });
      }
    }
  });
  return records;
}
async function putLocal(db: LibraryDB, kind: LibraryKind, id: string, payload: LibraryPayload) {
  if (payload) await db.table(names[kind]).put(parse(kind, payload));
  else {
    await db.table(names[kind]).delete(id);
    if (kind === 'book') {
      await db.reading_progress.delete(id);
      await db.personal_reviews.delete(id);
      await db.quotes.where('bookId').equals(id).delete();
    }
  }
}
function validateProjection(
  records: Map<string, { kind: LibraryKind; id: string; payload: LibraryPayload }>,
) {
  for (const r of records.values()) {
    if (!r.payload) continue;
    parse(r.kind, r.payload);
    if (r.kind === 'progress') {
      const book = records.get(libraryKey('book', r.id))?.payload;
      if (book) validProgress(Number(r.payload.pages), Number(book.totalPages));
    }
  }
}
type Transport = {
  pull: () => Promise<LibraryRecord[]>;
  push: (changes: LibraryChange[], device: string) => Promise<LibraryReply[]>;
};
export function createLibrarySynchronizer(
  db: LibraryDB,
  transport: Transport,
  onRemoteApplied: () => Promise<void> = async () => {},
) {
  let running: Promise<void> | null = null;
  let repeat = false;
  async function state(values: Partial<LibrarySyncState>) {
    try {
      const old = (await db.settings.get('_librarySync'))?.value as LibrarySyncState | undefined;
      await db.settings.put({
        key: '_librarySync',
        value: { phase: 'idle', lastSynced: null, error: '', conflicts: 0, ...old, ...values },
      });
    } catch (error) {
      if (!(error instanceof Error) || error.name !== 'DatabaseClosedError') throw error;
    }
  }
  async function cycle() {
    if (!navigator.onLine) {
      await state({ phase: 'offline' });
      return;
    }
    await state({ phase: 'syncing', error: '' });
    try {
      let device = (await db.settings.get('_privateDevice'))?.value as string | undefined;
      if (!device) {
        device = uid();
        await db.settings.put({ key: '_privateDevice', value: device });
      }
      const remote = await transport.pull();
      const snapshot = await capture(db);
      const bases = new Map((await db.private_sync_meta.toArray()).map((b) => [b.key, b]));
      const conflicts = new Map((await db.private_conflicts.toArray()).map((c) => [c.key, c]));
      const cloud = new Map(remote.map((r) => [libraryKey(r.kind, r.entity_id), r]));
      const plans: {
        key: string;
        kind: LibraryKind;
        id: string;
        before: LibraryPayload;
        after: LibraryPayload;
        base: LibraryRecord | null;
        send: boolean;
      }[] = [];
      const newConflicts: LibraryConflict[] = [];
      const keys = new Set([...snapshot.keys(), ...bases.keys(), ...cloud.keys()]);
      const parent = (key: string) => {
        const entry = snapshot.get(key) || bases.get(key) || cloud.get(key)!;
        const kind = entry.kind;
        if (kind === 'progress' || kind === 'review')
          return snapshot.get(key)?.id || bases.get(key)?.entityId || cloud.get(key)?.entity_id;
        if (kind === 'quote')
          return String(
            snapshot.get(key)?.payload?.bookId ||
              bases.get(key)?.payload?.bookId ||
              cloud.get(key)?.payload?.bookId ||
              '',
          );
        return '';
      };
      const families = new Map<string, string[]>();
      for (const key of keys) {
        const bookId = parent(key);
        if (!bookId) continue;
        const list = families.get(bookId) || [];
        list.push(key);
        families.set(bookId, list);
      }
      const family = (bookId: string) => families.get(bookId) || [];
      const held = new Set<string>();
      for (const key of keys) {
        const entry = snapshot.get(key) || bases.get(key) || cloud.get(key)!;
        if (entry.kind !== 'book') continue;
        const local = snapshot.get(key)?.payload || null;
        const remoteBook = cloud.get(key);
        const server = remoteBook?.payload || null;
        const id = snapshot.get(key)?.id || bases.get(key)?.entityId || remoteBook!.entity_id;
        if (equal(local, server)) continue;
        const children = family(id);
        const danger =
          (local &&
            remoteBook &&
            remoteBook.revision !== bases.get(key)?.revision &&
            !server &&
            children.some(
              (child) =>
                !equal(snapshot.get(child)?.payload || null, bases.get(child)?.payload || null),
            )) ||
          (!local &&
            server &&
            bases.get(key)?.payload &&
            children.some(
              (child) =>
                !equal(cloud.get(child)?.payload || null, bases.get(child)?.payload || null),
            )) ||
          conflicts.get(key)?.related;
        if (!danger) continue;
        held.add(id);
        newConflicts.push({
          key,
          kind: 'book',
          entityId: id,
          local,
          cloud: remoteBook || {
            kind: 'book',
            entity_id: id,
            payload: null,
            revision: 0,
            device_id: device,
          },
          related: children.map((child) => {
            const row = snapshot.get(child) || bases.get(child) || cloud.get(child)!;
            return (
              cloud.get(child) || {
                kind: row.kind,
                entity_id: snapshot.get(child)?.id || bases.get(child)?.entityId || '',
                payload: null,
                revision: 0,
                device_id: device,
              }
            );
          }),
        });
      }
      for (const key of keys) {
        const local = snapshot.get(key);
        const base = bases.get(key);
        const r = cloud.get(key);
        const kind = local?.kind || base?.kind || r!.kind;
        const id = local?.id || base?.entityId || r!.entity_id;
        const payload = local?.payload || null;
        const server = r?.payload || null;
        if ((kind === 'book' && held.has(id)) || held.has(parent(key) || '')) continue;
        if (conflicts.has(key)) {
          if (equal(payload, server)) {
            plans.push({
              key,
              kind,
              id,
              before: payload,
              after: payload,
              base: r || null,
              send: false,
            });
          } else if (r) newConflicts.push({ key, kind, entityId: id, local: payload, cloud: r });
          continue;
        }
        if (equal(payload, server)) {
          if (r)
            plans.push({ key, kind, id, before: payload, after: payload, base: r, send: false });
          continue;
        }
        const dirty = !equal(payload, base?.payload || null);
        if (!dirty) {
          if (r)
            plans.push({
              key,
              kind,
              id,
              before: payload,
              after: parse(kind, server),
              base: r,
              send: false,
            });
          continue;
        }
        if ((r?.revision || 0) === (base?.revision || 0)) {
          plans.push({
            key,
            kind,
            id,
            before: payload,
            after: payload,
            base: r || null,
            send: true,
          });
          continue;
        }
        const merged =
          !base && r && !server && payload
            ? null
            : mergeLibraryRecord(base?.payload || null, payload, server);
        if (merged) {
          plans.push({
            key,
            kind,
            id,
            before: payload,
            after: parse(kind, merged.merged),
            base: r || null,
            send: !equal(merged.merged, server),
          });
        } else
          newConflicts.push({
            key,
            kind,
            entityId: id,
            local: payload,
            cloud: r || { kind, entity_id: id, payload: null, revision: 0, device_id: device },
          });
      }
      const projection = new Map(snapshot);
      for (const p of plans) {
        if (p.after) projection.set(p.key, { kind: p.kind, id: p.id, payload: p.after });
        else projection.delete(p.key);
      }
      validateProjection(projection);
      const changes: LibraryChange[] = [];
      await db.transaction(
        'rw',
        [...localTables(db), db.private_sync_meta, db.private_conflicts],
        async () => {
          for (const c of newConflicts)
            if (equal(await getLocal(db, c.kind, c.entityId), c.local))
              await db.private_conflicts.put(c);
          // Books precede their child records when restoring another device's library.
          for (const p of plans.sort(
            (a, b) => (a.kind === 'book' ? 0 : 1) - (b.kind === 'book' ? 0 : 1),
          )) {
            if (!equal(await getLocal(db, p.kind, p.id), p.before)) continue;
            if (!equal(p.before, p.after)) {
              await putLocal(db, p.kind, p.id, p.after);
              await db.settings.put({ key: '_reconcilePublic', value: true });
            }
            if (p.base)
              await db.private_sync_meta.put({
                key: p.key,
                kind: p.kind,
                entityId: p.id,
                payload: p.base.payload,
                revision: p.base.revision,
              });
            await db.private_conflicts.delete(p.key);
            if (p.send)
              changes.push({
                kind: p.kind,
                entity_id: p.id,
                payload: p.after,
                base_revision: p.base?.revision || 0,
              });
          }
        },
      );
      // A retry of a committed request has the same payload and is acknowledged by the server.
      changes.sort((a, b) => {
        const rank = (c: LibraryChange) =>
          c.kind === 'book' ? (c.payload ? 0 : 3) : c.payload ? 1 : 2;
        return rank(a) - rank(b);
      });
      for (let start = 0; start < changes.length;) {
        const batch: LibraryChange[] = [];
        let bytes = 0;
        while (start < changes.length && batch.length < 200) {
          const op = changes[start];
          const size = new TextEncoder().encode(JSON.stringify(op)).length;
          if (batch.length && bytes + size > 700000) break;
          batch.push(op);
          bytes += size;
          start++;
        }
        const results = await transport.push(batch, device);
        if (results.length !== batch.length)
          throw new Error('Сервер не подтвердил изменения библиотеки');
        await db.transaction(
          'rw',
          [...localTables(db), db.private_sync_meta, db.private_conflicts],
          async () => {
            for (const result of results) {
              const r = result.record;
              if (!r) throw new Error('Неверный ответ синхронизации');
              const key = libraryKey(r.kind, r.entity_id);
              if (result.status === 'conflict') {
                const current = await getLocal(db, r.kind, r.entity_id);
                await db.private_conflicts.put({
                  key,
                  kind: r.kind,
                  entityId: r.entity_id,
                  local: current,
                  cloud: r,
                });
              } else {
                const previous = await db.private_sync_meta.get(key);
                if (!previous || previous.revision <= r.revision)
                  await db.private_sync_meta.put({
                    key,
                    kind: r.kind,
                    entityId: r.entity_id,
                    payload: r.payload,
                    revision: r.revision,
                  });
              }
            }
          },
        );
      }
      if ((await db.settings.get('_reconcilePublic'))?.value) {
        await onRemoteApplied();
        await db.settings.delete('_reconcilePublic');
      }
      const latest = await capture(db);
      const acknowledged = new Map((await db.private_sync_meta.toArray()).map((r) => [r.key, r]));
      const unresolved = new Set((await db.private_conflicts.toArray()).map((r) => r.key));
      const dirty = [...new Set([...latest.keys(), ...acknowledged.keys()])].some(
        (key) =>
          !unresolved.has(key) &&
          !equal(latest.get(key)?.payload || null, acknowledged.get(key)?.payload || null),
      );
      await state({
        phase: dirty ? 'syncing' : 'idle',
        ...(dirty ? {} : { lastSynced: now() }),
        error: '',
        conflicts: await db.private_conflicts.count(),
      });
    } catch (e) {
      await state({ phase: 'error', error: message(e) });
    }
  }
  return {
    sync() {
      if (running) {
        repeat = true;
        return running;
      }
      running = (async () => {
        do {
          repeat = false;
          await cycle();
        } while (repeat && db.isOpen() && navigator.onLine);
      })().finally(() => {
        running = null;
      });
      return running;
    },
    watch(onChange: () => void) {
      let last = '';
      return liveQuery(() => capture(db).then((r) => canonical([...r.values()]))).subscribe({
        next: (value) => {
          if (value !== last) {
            last = value;
            void state({ phase: navigator.onLine ? 'syncing' : 'offline' });
            onChange();
          }
        },
        error: () => {
          void state({ phase: 'error', error: 'Не удалось прочитать локальную библиотеку' });
        },
      });
    },
    async resolve(key: string, choice: 'local' | 'cloud') {
      const conflict = await db.private_conflicts.get(key);
      if (!conflict) return;
      await db.transaction(
        'rw',
        [...localTables(db), db.private_sync_meta, db.private_conflicts],
        async () => {
          if (conflict.related && choice === 'cloud') {
            const snapshot = await capture(db);
            for (const row of snapshot.values())
              if (
                row.kind === 'progress' || row.kind === 'review'
                  ? row.id === conflict.entityId
                  : row.kind === 'quote' && row.payload?.bookId === conflict.entityId
              )
                await db.table(names[row.kind]).delete(row.id);
          }
          if (choice === 'cloud') {
            const projection = await capture(db);
            if (conflict.cloud.payload)
              projection.set(key, {
                kind: conflict.kind,
                id: conflict.entityId,
                payload: parse(conflict.kind, conflict.cloud.payload),
              });
            else projection.delete(key);
            validateProjection(projection);
            await putLocal(db, conflict.kind, conflict.entityId, conflict.cloud.payload);
          }
          for (const related of conflict.related || []) {
            if (choice === 'cloud' && conflict.cloud.payload)
              await putLocal(db, related.kind, related.entity_id, related.payload);
            const relatedKey = libraryKey(related.kind, related.entity_id);
            await db.private_sync_meta.put({
              key: relatedKey,
              kind: related.kind,
              entityId: related.entity_id,
              payload: related.payload,
              revision: related.revision,
            });
            await db.private_conflicts.delete(relatedKey);
          }
          await db.private_sync_meta.put({
            key,
            kind: conflict.kind,
            entityId: conflict.entityId,
            payload: conflict.cloud.payload,
            revision: conflict.cloud.revision,
          });
          await db.private_conflicts.delete(key);
          await db.settings.put({ key: '_reconcilePublic', value: true });
          validateProjection(await capture(db));
        },
      );
      await this.sync();
    },
  };
}
