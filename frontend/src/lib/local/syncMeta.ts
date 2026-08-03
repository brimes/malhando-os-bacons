// Bookkeeping for the background pull — one row per collection in the `meta`
// store, namespaced `local_sync:*` so it never collides with the keys
// `offlineDbStorage.ts` already keeps there (`cache`, `lastSyncAt`, `failed`,
// `nextLocalId`, `activeSession`, `planDays` — see that module's `META_KEYS`).
//
// What is tracked here answers one question a screen needs before it can
// trust "no local logs for this day" over "we never actually asked": has a
// pull of this collection, covering this date, ever completed? See
// `lib/local/repo/foodLogs.ts`'s `isDateSynced`.

import { getRecord, putRecord } from '../localDb';

export interface SyncWindowMeta {
  /** Inclusive `YYYY-MM-DD` bounds of the last pull that completed for this collection. */
  from?: string;
  to?: string;
  /** Epoch ms the last pull completed. */
  pulledAt: number;
}

function metaKey(name: string): string {
  return `local_sync:${name}`;
}

export async function readSyncWindowMeta(name: string): Promise<SyncWindowMeta | undefined> {
  return getRecord<{ key: string; value: SyncWindowMeta }>('meta', metaKey(name)).then((row) => row?.value);
}

export async function writeSyncWindowMeta(name: string, meta: SyncWindowMeta): Promise<void> {
  await putRecord('meta', { key: metaKey(name), value: meta });
}
