import { useCallback, useMemo } from 'react';
import type { OfflineStatus, ResourceKey } from '../types/offline';
import { clearFailedMutations, getLatestSyncAt, useOfflineStore } from './offlineStore';
import { syncNow } from './offlineSync';

/**
 * Connection and synchronisation status for any screen that wants to show it
 * ("última sincronização", "3 alterações pendentes", a "sincronizar agora"
 * button). Reads straight from the persisted offline store, so it is correct on
 * the first render after a cold start.
 */
export function useOfflineStatus(): OfflineStatus {
  const isOnline = useOfflineStore((state) => state.isOnline);
  const isSyncing = useOfflineStore((state) => state.isSyncing);
  const queue = useOfflineStore((state) => state.queue);
  const failed = useOfflineStore((state) => state.failed);
  const lastSyncMap = useOfflineStore((state) => state.lastSyncAt);

  const lastSyncAt = useMemo(() => getLatestSyncAt(lastSyncMap), [lastSyncMap]);
  const lastSyncAtFor = useCallback(
    (resourceKey: ResourceKey) => lastSyncMap[resourceKey] ?? null,
    [lastSyncMap],
  );

  return {
    isOnline,
    lastSyncAt,
    pendingCount: queue.length,
    syncNow,
    isSyncing,
    failedCount: failed.length,
    failedMutations: failed,
    lastSyncAtFor,
    discardFailedMutations: clearFailedMutations,
  };
}

/** Same data outside React (event handlers, module code). */
export function getOfflineStatus(): Omit<OfflineStatus, 'syncNow' | 'lastSyncAtFor' | 'discardFailedMutations'> {
  const { isOnline, isSyncing, queue, failed, lastSyncAt } = useOfflineStore.getState();
  return {
    isOnline,
    isSyncing,
    lastSyncAt: getLatestSyncAt(lastSyncAt),
    pendingCount: queue.length,
    failedCount: failed.length,
    failedMutations: failed,
  };
}
