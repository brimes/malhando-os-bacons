// Single entry point for the offline layer. Screens and stores import from
// here; the modules behind it are split only to keep the axios client and the
// mutation queue free of circular imports.

export {
  isNetworkOnline,
  onNetworkStatusChange,
  reportNetworkFailure,
  reportNetworkSuccess,
} from './network';

export {
  useOfflineStore,
  resourceKeyForRequest,
  readCache,
  readCacheEntry,
  hasCache,
  writeCache,
  patchCacheLocally,
  invalidateCache,
  invalidateCacheByPrefix,
  markSynced,
  getLastSyncAt,
  getLatestSyncAt,
  takeLocalId,
  isLocalId,
  dropQueuedMutations,
  clearOfflineData,
  readLocalActiveSession,
  writeLocalActiveSession,
} from './offlineStore';

export {
  OfflineUnavailableError,
  UnsyncedDependencyError,
  readThrough,
  syncNow,
  flushQueue,
  flushQueueIfPending,
  enqueueMutation,
  registerMutationExecutor,
  isConnectivityError,
  isQueueableFailure,
  isOnlineOnlyPath,
  isMutationMethod,
  referencesLocalId,
  normalizePath,
  QUEUE_SYNC_KEY,
} from './offlineSync';

export type { ReadThroughOptions, MutationExecutor } from './offlineSync';

export {
  applyChecklistLocally,
  dayIdForActiveWorkout,
  dependentMutationsOf,
  findCachedPlanDay,
  OfflineSessionConflictError,
  OfflineSessionUnavailableError,
  newClientSessionId,
  onWorkoutIdRemap,
  parseCloseRoute,
  pendingCompletedWorkouts,
  persistPlanDaysDurable,
  readCachedActiveWorkout,
  reconcileActiveSessionRead,
  reconcileWorkoutStart,
  storeLocalActiveWorkout,
  WorkoutStartConflictError,
} from './workoutSession';

export type { LocalCompletedWorkout } from './workoutSession';

export { useOfflineStatus, getOfflineStatus } from './useOfflineStatus';

// Side effect: starts the storage-engine reconciliation + rehydration as soon
// as anything imports this barrel (which `api/client.ts` does, so effectively
// every screen does, transitively, before React's first render). See its
// module comment for why this has to run exactly once, in this order.
export { offlineReady } from './offlineBoot';

export type {
  CacheEntry,
  FailedMutation,
  MutationMethod,
  OfflineStatus,
  PendingMutation,
  ResourceKey,
} from '../types/offline';
