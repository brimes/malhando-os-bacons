// Round-trip coverage for the IndexedDB persistence engine (fatia 2 of the
// local-first plan). The fixture below is typed `Required<PendingMutation>`
// on purpose: if a field is ever added to `PendingMutation`
// (`types/offline.ts`) and this fixture is not updated to set it, `tsc`
// refuses to compile this file — the failure the task asked for happens at
// build time, before the test even runs. If the fixture *is* updated but the
// mapping in `offlineDbStorage.ts` is not, the `deepStrictEqual` below is what
// catches it.

import { beforeEach, describe, expect, it } from 'vitest';
import type { FailedMutation, PendingMutation, PersistedOfflineState } from '../../types/offline';
import { clearStore, getAll } from '../localDb';
import {
  indexedDbPersistStorage,
  markPersistHydrated,
  readPersistedOfflineState,
  writePersistedOfflineState,
} from '../offlineDbStorage';

const fullMutation: Required<PendingMutation> = {
  localId: 'abc123-1',
  method: 'POST',
  url: '/workouts/-1/sets',
  params: { foo: 'bar' },
  body: { client_set_id: 'set-uuid-1', weight_kg: 40 },
  createdAt: 1700000000000,
  attempts: 2,
  lastError: 'timeout',
  localEntityId: -7,
  trainingPlanDayId: 42,
};

const secondMutation: PendingMutation = {
  localId: 'abc123-0',
  method: 'POST',
  url: '/workouts/start',
  body: { client_session_id: 'session-uuid-1' },
  createdAt: 1699999999000,
  attempts: 0,
  localEntityId: -1,
};

const fullFailedMutation: Required<FailedMutation> = {
  ...fullMutation,
  localId: 'abc123-2',
  failedAt: 1700000001000,
  reason: 'Servidor recusou.',
};

describe('offlineDbStorage — outbox round trip', () => {
  beforeEach(async () => {
    // Truly empty, not "written with empty values" — `writePersistedOfflineState`
    // always puts its six `meta` rows, so using it here would leave `meta`
    // non-empty and defeat the "fresh install" test below.
    await Promise.all([clearStore('outbox'), clearStore('meta')]);
  });

  it('preserves every PendingMutation field through a write + read cycle', async () => {
    await writePersistedOfflineState({
      cache: {},
      lastSyncAt: {},
      queue: [fullMutation, secondMutation],
      failed: [],
      nextLocalId: -8,
      activeSession: null,
      planDays: {},
    });

    const restored = await readPersistedOfflineState();
    expect(restored).not.toBeNull();
    expect(restored?.queue).toHaveLength(2);

    const restoredFull = restored?.queue.find((mutation) => mutation.localId === fullMutation.localId);
    expect(restoredFull).toStrictEqual(fullMutation);

    const restoredSecond = restored?.queue.find((mutation) => mutation.localId === secondMutation.localId);
    expect(restoredSecond).toStrictEqual(secondMutation);
  });

  it('never leaks the derived `entity` index field back into PendingMutation', async () => {
    await writePersistedOfflineState({
      cache: {},
      lastSyncAt: {},
      queue: [fullMutation],
      failed: [],
      nextLocalId: -1,
      activeSession: null,
      planDays: {},
    });

    const restored = await readPersistedOfflineState();
    expect(restored?.queue[0]).not.toHaveProperty('entity');

    // The raw IndexedDB row, on the other hand, does carry it — that's the
    // whole point of the index existing.
    const rawRows = await getAll<Record<string, unknown>>('outbox');
    expect(rawRows[0]).toHaveProperty('entity', 'workouts');
  });

  it('removes outbox rows for mutations no longer present, without touching the rest', async () => {
    await writePersistedOfflineState({
      cache: {},
      lastSyncAt: {},
      queue: [fullMutation, secondMutation],
      failed: [],
      nextLocalId: -8,
      activeSession: null,
      planDays: {},
    });
    await writePersistedOfflineState({
      cache: {},
      lastSyncAt: {},
      queue: [secondMutation],
      failed: [],
      nextLocalId: -8,
      activeSession: null,
      planDays: {},
    });

    const restored = await readPersistedOfflineState();
    expect(restored?.queue).toStrictEqual([secondMutation]);
  });

  it('round-trips failed mutations, activeSession, nextLocalId and planDays through meta', async () => {
    const activeSession = { workout: { id: -3, training_plan_day_id: 9, status: 'in_progress' } };
    const planDays = { 9: { data: { plan: { id: 1 }, day: { id: 9 } }, updatedAt: 123 } };

    await writePersistedOfflineState({
      cache: { 'get:/workouts': { data: [{ id: 1 }], updatedAt: 111 } },
      lastSyncAt: { 'get:/workouts': 111 },
      queue: [],
      failed: [fullFailedMutation],
      nextLocalId: -42,
      activeSession,
      planDays,
    });

    const restored = await readPersistedOfflineState();
    expect(restored?.failed).toStrictEqual([fullFailedMutation]);
    expect(restored?.activeSession).toStrictEqual(activeSession);
    expect(restored?.nextLocalId).toBe(-42);
    expect(restored?.planDays).toStrictEqual(planDays);
    // Discardable by contract (see the migration, which deliberately does not
    // carry these two over from the old localStorage blob) but still
    // round-trips faithfully once *in* IndexedDB — only the migration itself
    // skips them, not ordinary persistence.
    expect(restored?.cache).toStrictEqual({ 'get:/workouts': { data: [{ id: 1 }], updatedAt: 111 } });
    expect(restored?.lastSyncAt).toStrictEqual({ 'get:/workouts': 111 });
  });

  it('reports no persisted state when both outbox and meta are empty', async () => {
    const restored = await readPersistedOfflineState();
    expect(restored).toBeNull();
  });

  it('survives 600 queued mutations without dropping the outbox or planDays (acceptance criterion 4)', async () => {
    const queue: PendingMutation[] = Array.from({ length: 600 }, (_, index) => ({
      localId: `stress-${index}`,
      method: 'POST',
      url: `/workouts/-1/sets`,
      body: { client_set_id: `set-${index}` },
      createdAt: 1700000000000 + index,
      attempts: 0,
    }));
    const planDays = Object.fromEntries(
      Array.from({ length: 30 }, (_, index) => [index, { data: { day: index }, updatedAt: index }]),
    );

    await writePersistedOfflineState({
      cache: {},
      lastSyncAt: {},
      queue,
      failed: [],
      nextLocalId: -601,
      activeSession: null,
      planDays,
    });

    const restored = await readPersistedOfflineState();
    expect(restored?.queue).toHaveLength(600);
    expect(restored?.queue.map((mutation) => mutation.localId).sort()).toStrictEqual(
      queue.map((mutation) => mutation.localId).sort(),
    );
    expect(Object.keys(restored?.planDays ?? {})).toHaveLength(30);
  });
});

describe('indexedDbPersistStorage — write suppression before hydration', () => {
  // Reproduces the actual bug this exists to prevent: `offlineStore.ts`'s own
  // `setOnline(...)` call at module load fires a `setState` — and therefore a
  // `persist` write — synchronously, long before `offlineBoot.ts`'s
  // `rehydrate()` (an async IndexedDB read) has restored anything. Without
  // `markPersistHydrated`, that write's still-pristine snapshot
  // (`{ cache: {}, queue: [], ... }`) lands on disk, clobbering whatever the
  // *previous* session had — and `rehydrate()` then faithfully restores that
  // now-empty snapshot back into memory. `hydrated` is a module-level flag
  // with no reset, matching real boot (set exactly once) — so this is one
  // test, ordered: writes rejected, then `markPersistHydrated()`, then
  // writes accepted.
  it('drops setItem/removeItem before markPersistHydrated(), accepts them after', async () => {
    await Promise.all([clearStore('outbox'), clearStore('meta')]);

    const previousSessionState: PersistedOfflineState = {
      cache: { 'get:/terms': { data: { accepted: true }, updatedAt: 1 } },
      lastSyncAt: {},
      queue: [],
      failed: [],
      nextLocalId: -1,
      activeSession: null,
      planDays: {},
    };
    await writePersistedOfflineState(previousSessionState);

    // The early, still-pristine write a fresh boot fires before hydration —
    // must not reach disk, or it would erase `previousSessionState` above.
    const prematureState: PersistedOfflineState = {
      cache: {},
      lastSyncAt: {},
      queue: [],
      failed: [],
      nextLocalId: -1,
      activeSession: null,
      planDays: {},
    };
    await indexedDbPersistStorage.setItem('mob-offline', { state: prematureState, version: 1 });

    const stillIntact = await readPersistedOfflineState();
    expect(stillIntact?.cache).toStrictEqual(previousSessionState.cache);

    markPersistHydrated();

    const postHydrationState: PersistedOfflineState = {
      ...previousSessionState,
      cache: { ...previousSessionState.cache, 'get:/onboarding': { data: { completed: true }, updatedAt: 2 } },
    };
    await indexedDbPersistStorage.setItem('mob-offline', { state: postHydrationState, version: 1 });

    const afterHydration = await readPersistedOfflineState();
    expect(afterHydration?.cache).toStrictEqual(postHydrationState.cache);
  });
});
