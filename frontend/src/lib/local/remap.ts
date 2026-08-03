// Generic id-remap mechanics shared by every entity that can be created
// offline and later learns its real id from the server. `workoutSession.ts`
// had this logic hard-coded for `/workouts/{id}` (see `remapLocalWorkoutId`);
// it now calls the two helpers below instead of building its own regex, and
// `lib/local/repo/foodLogs.ts` (this slice) is the second, unrelated caller —
// see that module's `registerLocalIdReconciler` call.
//
// Deliberately depends only on `offlineStore` (state) and `requestPath`
// (parsing), same rule `workoutSession.ts` follows and for the same reason:
// `offlineSync.ts`'s queue replay is what calls into this module (via the
// reconciler registry below), so the dependency has to point one way.

import type { PendingMutation } from '../../types/offline';
import { getQueue, rewriteQueuedUrls } from '../offlineStore';
import { normalizeRoute } from '../requestPath';

/** Matches `{routeSegment}/{id}` as a whole path segment — not a prefix of a longer id. */
export function routeIdPattern(routeSegment: string, id: number): RegExp {
  return new RegExp(`(^|/)${routeSegment}/${id}(?=/|$)`);
}

/**
 * Rewrites every queued mutation's URL that addresses `{routeSegment}/{localId}`
 * to point at `{routeSegment}/{realId}` instead. Called once the create that
 * minted `localId` has synced and the server handed back the real one —
 * everything still queued behind it (an edit, a delete) was built pointing at
 * the negative id and would 404 on replay otherwise.
 */
export function remapQueuedRoute(routeSegment: string, localId: number, realId: number): void {
  if (localId >= 0 || realId <= 0 || localId === realId) return;
  const pattern = routeIdPattern(routeSegment, localId);
  rewriteQueuedUrls((url) => url.replace(pattern, `$1${routeSegment}/${realId}`));
}

/** Every mutation still queued that addresses `{routeSegment}/{localId}`, in any method. */
export function queuedMutationsReferencingLocalId(
  routeSegment: string,
  localId: number,
  queue: PendingMutation[] = getQueue(),
): PendingMutation[] {
  const pattern = routeIdPattern(routeSegment, localId);
  return queue.filter((mutation) => pattern.test(normalizeRoute(mutation.url)));
}

/**
 * Plugs an entity created offline into the queue's reconciliation step
 * (`offlineSync.ts`'s `runFlush`) without that module having to import
 * entity-specific code. `workoutSession.ts` keeps its own bespoke
 * `reconcileWorkoutStart`/`dependentMutationsOf` (its response shape and
 * conflict handling — a session already closed server-side — do not fit this
 * generic contract); every other entity that can be created offline
 * registers one of these instead. See `lib/local/repo/foodLogs.ts`.
 */
export interface LocalIdReconciler {
  /** True when this reconciler owns the mutation that just replayed. */
  matches: (mutation: PendingMutation) => boolean;
  /** Applies the remap — local store, queued URLs — now that the real id is known. */
  reconcile: (mutation: PendingMutation, response: unknown) => void;
  /** Mutations that only make sense once `mutation` (a create) succeeds, for when it fails for good instead. */
  dependents?: (mutation: PendingMutation, queue: PendingMutation[]) => PendingMutation[];
}

const reconcilers: LocalIdReconciler[] = [];

export function registerLocalIdReconciler(reconciler: LocalIdReconciler): void {
  reconcilers.push(reconciler);
}

/** Called by `runFlush` right after a mutation replays successfully. */
export function runLocalIdReconcilers(mutation: PendingMutation, response: unknown): void {
  for (const reconciler of reconcilers) {
    if (reconciler.matches(mutation)) reconciler.reconcile(mutation, response);
  }
}

/** Called by `failMutationAndDependents` to also park whatever a registered entity considers dependent. */
export function collectReconcilerDependents(mutation: PendingMutation, queue: PendingMutation[] = getQueue()): PendingMutation[] {
  const dependents: PendingMutation[] = [];
  for (const reconciler of reconcilers) {
    if (reconciler.matches(mutation) && reconciler.dependents) {
      dependents.push(...reconciler.dependents(mutation, queue));
    }
  }
  return dependents;
}
