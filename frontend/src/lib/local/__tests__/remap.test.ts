// Unit coverage for the generalized id-remap mechanics `workoutSession.ts`'s
// `remapLocalWorkoutId` used to build inline (see `lib/local/remap.ts`'s
// module comment) and that `lib/local/repo/foodLogs.ts` now shares it with.

import { beforeEach, describe, expect, it } from 'vitest';
import { useOfflineStore } from '../../offlineStore';
import type { PendingMutation } from '../../../types/offline';
import {
  collectReconcilerDependents,
  queuedMutationsReferencingLocalId,
  registerLocalIdReconciler,
  remapQueuedRoute,
  routeIdPattern,
  runLocalIdReconcilers,
} from '../remap';

function mutation(overrides: Partial<PendingMutation>): PendingMutation {
  return {
    localId: 'm-1',
    method: 'POST',
    url: '/nutrition/logs',
    createdAt: 1,
    attempts: 0,
    ...overrides,
  };
}

describe('routeIdPattern / remapQueuedRoute', () => {
  it('matches the id as a whole path segment, not a prefix of a longer one', () => {
    const pattern = routeIdPattern('nutrition/logs', 3);
    expect(pattern.test('/nutrition/logs/3')).toBe(true);
    expect(pattern.test('/nutrition/logs/3/x')).toBe(true);
    expect(pattern.test('/nutrition/logs/30')).toBe(false);
  });

  it('rewrites every queued URL addressing the local id, and only that segment', () => {
    useOfflineStore.setState({
      queue: [
        mutation({ localId: 'a', method: 'PUT', url: '/nutrition/logs/-5' }),
        mutation({ localId: 'b', method: 'DELETE', url: '/nutrition/logs/-5' }),
        mutation({ localId: 'c', method: 'PUT', url: '/nutrition/logs/-50' }),
      ],
    });

    remapQueuedRoute('nutrition/logs', -5, 42);

    const urls = useOfflineStore.getState().queue.map((m) => m.url);
    expect(urls).toStrictEqual(['/nutrition/logs/42', '/nutrition/logs/42', '/nutrition/logs/-50']);
  });

  it('is a no-op for a positive localId or a non-positive realId', () => {
    useOfflineStore.setState({ queue: [mutation({ url: '/nutrition/logs/-1' })] });
    remapQueuedRoute('nutrition/logs', 1, 2);
    remapQueuedRoute('nutrition/logs', -1, 0);
    expect(useOfflineStore.getState().queue[0].url).toBe('/nutrition/logs/-1');
  });
});

describe('queuedMutationsReferencingLocalId', () => {
  it('finds every mutation addressing the id, across methods', () => {
    const queue = [
      mutation({ localId: 'a', method: 'POST', url: '/nutrition/logs', localEntityId: -2 }),
      mutation({ localId: 'b', method: 'PUT', url: '/nutrition/logs/-2' }),
      mutation({ localId: 'c', method: 'DELETE', url: '/nutrition/logs/-9' }),
    ];
    const found = queuedMutationsReferencingLocalId('nutrition/logs', -2, queue);
    expect(found.map((m) => m.localId)).toStrictEqual(['b']);
  });
});

describe('LocalIdReconciler registry', () => {
  beforeEach(() => {
    useOfflineStore.setState({ queue: [] });
  });

  it('runs only the reconciler that matches, and hands it the response', () => {
    const seen: unknown[] = [];
    registerLocalIdReconciler({
      matches: (m) => m.url === '/only-this-one',
      reconcile: (_m, response) => seen.push(response),
    });
    registerLocalIdReconciler({
      matches: () => false,
      reconcile: () => seen.push('should not run'),
    });

    runLocalIdReconcilers(mutation({ url: '/only-this-one' }), { id: 42 });
    expect(seen).toStrictEqual([{ id: 42 }]);
  });

  it('collects dependents only from reconcilers that match and declare them', () => {
    const dependent = mutation({ localId: 'dep', url: '/only-dependents/-1' });
    registerLocalIdReconciler({
      matches: (m) => m.url === '/only-dependents',
      reconcile: () => undefined,
      dependents: () => [dependent],
    });

    const dependents = collectReconcilerDependents(mutation({ url: '/only-dependents' }), [dependent]);
    expect(dependents).toStrictEqual([dependent]);
    expect(collectReconcilerDependents(mutation({ url: '/unrelated' }), [dependent])).toStrictEqual([]);
  });
});
