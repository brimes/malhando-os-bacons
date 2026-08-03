// Small pieces every collection module under `lib/local/repo/` needs and none
// of them owns on its own: the outbox-emptiness guard a pull must respect,
// and the "write local, enqueue, push soon" shape every local-first mutation
// follows. Kept out of `entityStore.ts` (generic cache mechanics, no opinion
// about routes or the queue) and out of `offlineSync.ts` (the queue itself,
// no opinion about entities).

import { enqueueMutation, flushQueue, isNetworkOnline } from '../../offline';
import { getQueue } from '../../offlineStore';
import { normalizeRoute } from '../../requestPath';

/**
 * True when anything is still queued for a collection — a create not yet
 * synced, an edit or delete behind it. The spec rule this exists for: "pull
 * nunca roda para uma coleção com outbox não vazio (a cópia do servidor está
 * atrás)". `routePrefix` is matched against the normalized route, so
 * `/nutrition/logs` also catches `/nutrition/logs/-3`.
 */
export function hasPendingMutationsFor(routePrefix: string): boolean {
  return getQueue().some((mutation) => normalizeRoute(mutation.url).startsWith(routePrefix));
}

/**
 * Queues `mutation` and immediately tries to send it — the "push dispara ao
 * gravar" rule. Fire-and-forget on purpose: the write already landed locally
 * (the caller wrote to the `EntityCache` before calling this), so the screen
 * has nothing left to wait for. A rejection here just means the mutation is
 * still sitting in the queue, exactly as if the push tick had not fired yet.
 */
export function enqueueAndPushSoon(input: Parameters<typeof enqueueMutation>[0]): ReturnType<typeof enqueueMutation> {
  const mutation = enqueueMutation(input);
  if (isNetworkOnline()) void flushQueue();
  return mutation;
}
