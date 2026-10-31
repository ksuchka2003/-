export type LibraryKind = 'book' | 'progress' | 'review' | 'quote' | 'setting';
export type LibraryPayload = Record<string, unknown> | null;
export type LibraryRecord = {
  kind: LibraryKind;
  entity_id: string;
  payload: LibraryPayload;
  revision: number;
  device_id: string;
};
export type LibraryBase = {
  key: string;
  kind: LibraryKind;
  entityId: string;
  payload: LibraryPayload;
  revision: number;
};
export type LibraryConflict = {
  key: string;
  kind: LibraryKind;
  entityId: string;
  local: LibraryPayload;
  cloud: LibraryRecord;
  related?: LibraryRecord[];
};
export type LibraryChange = {
  kind: LibraryKind;
  entity_id: string;
  payload: LibraryPayload;
  base_revision: number;
};
export type LibraryReply = { status: 'applied' | 'conflict'; record: LibraryRecord };
export type LibrarySyncState = {
  phase: 'idle' | 'syncing' | 'offline' | 'error';
  lastSynced: string | null;
  error: string;
  conflicts: number;
};
