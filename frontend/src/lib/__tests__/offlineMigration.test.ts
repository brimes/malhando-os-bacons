// @vitest-environment jsdom
//
// Exercises acceptance criteria 1 and 3 directly: seed the old localStorage
// blob, migrate, and check both what landed in IndexedDB and that the old key
// is gone. `jsdom` (not the default `node` environment used by the rest of
// this suite) is what supplies `window.localStorage` here.

import { beforeEach, describe, expect, it } from 'vitest';
import { clearStore, getAll } from '../localDb';
import {
  exportIndexedDbToLegacyLocalStorage,
  migrateLegacyLocalStorageToIndexedDb,
  readPersistedOfflineState,
} from '../offlineDbStorage';

const LEGACY_KEY = 'mob-offline';

function seedLegacyLocalStorage(state: unknown): void {
  window.localStorage.setItem(LEGACY_KEY, JSON.stringify({ state, version: 1 }));
}

describe('offlineDbStorage — localStorage <-> IndexedDB migration', () => {
  beforeEach(async () => {
    window.localStorage.clear();
    await Promise.all([clearStore('outbox'), clearStore('meta')]);
  });

  it('migrates a queued start and a queued set, with every field, and clears the old key (criterion 1)', async () => {
    const startMutation = {
      localId: 'start-1',
      method: 'POST',
      url: '/workouts/start',
      body: { client_session_id: 'session-uuid-1', training_plan_day_id: 5 },
      createdAt: 1700000000000,
      attempts: 0,
      localEntityId: -1,
    };
    const setMutation = {
      localId: 'set-1',
      method: 'POST',
      url: '/workouts/-1/sets',
      body: { client_set_id: 'set-uuid-1', weight_kg: 60 },
      createdAt: 1700000001000,
      attempts: 0,
    };

    seedLegacyLocalStorage({
      // `cache`/`lastSyncAt` are deliberately dropped by the migration — see
      // the assertion below and the module comment on
      // `migrateLegacyLocalStorageToIndexedDb`.
      cache: { 'get:/workouts': { data: [{ id: 1 }], updatedAt: 1 } },
      lastSyncAt: { 'get:/workouts': 1 },
      queue: [startMutation, setMutation],
      failed: [],
      nextLocalId: -2,
      activeSession: null,
      planDays: {},
    });

    await migrateLegacyLocalStorageToIndexedDb();

    expect(window.localStorage.getItem(LEGACY_KEY)).toBeNull();

    const outboxRows = await getAll<Record<string, unknown>>('outbox');
    expect(outboxRows).toHaveLength(2);
    const restored = await readPersistedOfflineState();
    expect(restored?.queue).toStrictEqual([startMutation, setMutation]);
    expect(restored?.nextLocalId).toBe(-2);
    // Discarded on purpose, not carried over from the legacy blob.
    expect(restored?.cache).toStrictEqual({});
    expect(restored?.lastSyncAt).toStrictEqual({});
  });

  it('carries an in-progress session through the migration, still resumable (criterion 3)', async () => {
    const activeSession = {
      workout: { id: -1, training_plan_day_id: 5, status: 'in_progress', client_session_id: 'session-uuid-1', sets: [] },
      plan_id: 1,
      day_name: 'Dia A',
      exercises: [{ id: 10, exercise_name: 'Supino' }],
    };

    seedLegacyLocalStorage({
      cache: {},
      lastSyncAt: {},
      queue: [],
      failed: [],
      nextLocalId: -1,
      activeSession,
      planDays: {},
    });

    await migrateLegacyLocalStorageToIndexedDb();

    const restored = await readPersistedOfflineState();
    expect(restored?.activeSession).toStrictEqual(activeSession);
  });

  it('is a no-op when there is nothing to migrate', async () => {
    await migrateLegacyLocalStorageToIndexedDb();
    const restored = await readPersistedOfflineState();
    expect(restored).toBeNull();
  });

  it('reverting exports the outbox back into localStorage without losing it (criterion 5)', async () => {
    const mutation = {
      localId: 'set-9',
      method: 'POST',
      url: '/workouts/-1/sets',
      body: { client_set_id: 'set-uuid-9' },
      createdAt: 1700000009000,
      attempts: 1,
    };
    seedLegacyLocalStorage({
      cache: {}, lastSyncAt: {}, queue: [mutation], failed: [], nextLocalId: -3, activeSession: null, planDays: {},
    });
    await migrateLegacyLocalStorageToIndexedDb();
    expect(window.localStorage.getItem(LEGACY_KEY)).toBeNull();

    await exportIndexedDbToLegacyLocalStorage();

    const raw = window.localStorage.getItem(LEGACY_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string);
    expect(parsed.state.queue).toStrictEqual([mutation]);
  });
});
