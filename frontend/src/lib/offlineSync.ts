import axios from 'axios';
import type { MutationMethod, PendingMutation, ResourceKey } from '../types/offline';
import {
  isNetworkOnline,
  onNetworkStatusChange,
  reportNetworkFailure,
} from './network';
import {
  dropQueuedMutations,
  getQueue,
  invalidateCacheByPrefix,
  markSynced,
  moveToFailed,
  patchQueuedMutation,
  pushToQueue,
  readCache,
  removeFromQueue,
  setOnline,
  setSyncing,
  writeCache,
} from './offlineStore';
import { collectReconcilerDependents, runLocalIdReconcilers } from './local/remap';
import { normalizePath, normalizeRoute } from './requestPath';
import {
  dependentMutationsOf,
  forgetLocalSessionIfMatches,
  isIdempotentRetryable,
  isSessionRoute,
  parseSessionEndRoute,
  parseSetDeleteRoute,
  reconcileWorkoutSet,
  reconcileWorkoutStart,
  WorkoutStartConflictError,
} from './workoutSession';

/** A mutation that keeps failing on the server is dropped instead of blocking the queue forever. */
const MAX_MUTATION_ATTEMPTS = 5;
/**
 * Itens que o servidor recusou com "ainda não" (404/405 numa rota nova): só o
 * timer de retry os reenvia, não cada resposta de leitura que chega — senão cada
 * GET dispararia um PUT que se sabe recusado.
 */
const HOLD_MS = 30_000;
const heldUntil = new Map<string, number>();
function heldIds(): Set<string> {
  const now = Date.now();
  for (const [id, until] of heldUntil) if (until <= now) heldUntil.delete(id);
  return new Set(heldUntil.keys());
}
/** Quanto tempo uma troca de data recusada com 404/405 continua sendo retentada. */
const DATE_ROUTE_PATIENCE_MS = 30 * 24 * 3_600_000;
const isWorkoutDateRoute = (url: string): boolean => /^\/workouts\/\d+\/date$/.test(normalizePath(url));
/**
 * The workout session's own writes are local-first: the person already moved on
 * and the app is the only place that data exists. A server that is down for a
 * few minutes must not turn into a parked (failed) start with every series
 * behind it, so these get many more tries — spaced by the backoff below.
 */
const MAX_SESSION_MUTATION_ATTEMPTS = 25;

function maxAttemptsFor(mutation: PendingMutation): number {
  return mutation.idempotent || isSessionRoute(mutation.url) ? MAX_SESSION_MUTATION_ATTEMPTS : MAX_MUTATION_ATTEMPTS;
}

// --- background retry -------------------------------------------------------
// Nothing else wakes the queue after a failed attempt on a link that never
// dropped (no `online` event, no response to piggyback on), so a failure
// schedules its own retry with exponential backoff. Invisible to the screen.
const RETRY_BASE_MS = 2_000;
const RETRY_MAX_MS = 60_000;
let retryAttempt = 0;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
/** Mutation being sent right now, so an undo knows it can no longer just be dropped. */
let inFlightLocalId: string | undefined;

export function isMutationInFlight(localId: string): boolean {
  return inFlightLocalId === localId;
}

export function cancelScheduledRetry(): void {
  if (retryTimer !== undefined) clearTimeout(retryTimer);
  retryTimer = undefined;
  retryAttempt = 0;
}

function scheduleRetry(): void {
  if (retryTimer !== undefined) return;
  const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** retryAttempt);
  retryAttempt += 1;
  retryTimer = setTimeout(() => {
    retryTimer = undefined;
    // Forced: the attempt itself is the best probe there is. `isNetworkOnline`
    // only says when it is worth trying, never whether the write is kept.
    void flushQueue({ force: true });
  }, delay);
}
/** Cap on how many resources `syncNow()` refreshes, newest first. */
const MAX_TRACKED_RESOURCES = 24;
/** Key used only to timestamp a successful queue flush. */
export const QUEUE_SYNC_KEY = 'sync:queue';

/**
 * Endpoints that must never be queued: their whole point is the server's answer
 * (an assistant reply, a token, a job id to poll). Replaying them minutes later
 * would either be useless or produce a response nobody is waiting for anymore.
 */
const ONLINE_ONLY_PATHS: RegExp[] = [
  /^\/auth\//,
  /^\/chat(\/|$)/,
  // Dúvidas durante o treino: the answer is generated live, so a question
  // replayed half an hour later would arrive with nobody reading it. `-?`
  // covers a session still running on its offline-assigned id — otherwise a
  // question asked before the start syncs falls through to the generic
  // "não sincronizado" queueing path instead of the clear "precisa de
  // internet" message this path exists to give it.
  /^\/workouts\/-?\d+\/chat(\/|$)/,
  // Troca de exercício: depende do servidor para resolver o vídeo do nome
  // novo e devolver a sessão atualizada. Enfileirada, a pessoa continuaria o
  // treino com o exercício antigo achando que já trocou.
  /^\/workouts\/-?\d+\/substitutions(\/|$)/,
  /^\/onboarding\/objective\//,
  /^\/training-plans\/automatic/,
  /^\/training-plans\/\d+\/adjust/,
  // Mesma razão do automático/ajuste: a criação dinâmica ainda depende do
  // servidor responder na hora (não é um job — ver `trainingPlansApi.createDynamic`),
  // e a geração do dia roda minutos contra o assistente. Enfileiradas, a
  // resposta chegaria sem ninguém olhando a tela.
  /^\/training-plans\/dynamic/,
  /^\/training-plans\/\d+\/dynamic-day/,
  // Same reasoning as the training plan assistant: generation/adjustment run
  // for minutes against a live LLM call, and a photo upload cannot be queued
  // in localStorage at all (base64 would blow past the per-entry cap and the
  // origin's ~5MB budget). The cheat-day conversation and its acceptance are
  // also live exchanges with the assistant, same as workout/onboarding chat.
  /^\/nutrition\/plans\/automatic/,
  /^\/nutrition\/plans\/\d+\/adjust/,
  /^\/nutrition\/photos/,
  // Geração de imagem ao vivo contra a IA: enfileirada, chegaria sem ninguém olhando.
  /^\/exercise-illustrations/,
  /^\/nutrition\/suggestion/,
  // Conversa viva com o assistente para montar um registro: replayed depois,
  // chegaria uma pergunta sem ninguém para responder.
  /^\/nutrition\/logs\/assistant/,
  /^\/nutrition\/cheat-day/,
  // Avaliação do resultado: pedir a análise é uma chamada viva ao assistente,
  // e aplicá-la reescreve os planos a partir de uma proposta que só existe no
  // servidor. Replayed meia hora depois, o "confirmar" chegaria sem ninguém
  // olhando o que estava sendo confirmado.
  /^\/progress-reviews/,
  // Never queue the user's own API key: the queue is persisted in localStorage
  // in clear text, so an offline save would leave a third-party credential
  // sitting on the device indefinitely. The server also validates the key
  // against the provider before storing it, which cannot happen offline.
  /^\/llm-settings/,
  /^\/subscription\//,
];

/**
 * Paths allowed to carry an id that only exists on this device. The rule below
 * exists because replaying `PUT /workouts/-3` would 404, but the guided session
 * is the one case where the whole chain is queued together: the start is
 * replayed first and rewrites these URLs with the real id before they go out
 * (see `reconcileWorkoutStart`). Without the exception a workout started in the
 * gym with no signal could not record a single series.
 */
const LOCAL_ID_ALLOWED_PATHS: RegExp[] = [
  /^\/workouts\/-\d+\/(sets|finish|complete|progress|cancel)$/,
];

const MUTATION_METHODS: MutationMethod[] = ['POST', 'PUT', 'PATCH', 'DELETE'];

/** Raised by reads that have no cached copy to fall back on. */
export class OfflineUnavailableError extends Error {
  constructor(message = 'Sem conexão e sem dados salvos neste dispositivo.') {
    super(message);
    this.name = 'OfflineUnavailableError';
  }
}

/** Raised when a write touches something that only exists locally. */
export class UnsyncedDependencyError extends Error {
  constructor(message = 'Este item ainda não foi sincronizado. Conecte-se à internet para alterá-lo.') {
    super(message);
    this.name = 'UnsyncedDependencyError';
  }
}

// --- request classification -------------------------------------------------

export { normalizePath } from './requestPath';

export function isMutationMethod(method: string | undefined): method is MutationMethod {
  return MUTATION_METHODS.includes((method ?? '').toUpperCase() as MutationMethod);
}

export function isOnlineOnlyPath(url: string): boolean {
  const path = normalizePath(url);
  return ONLINE_ONLY_PATHS.some((pattern) => pattern.test(path));
}

/**
 * True when the URL points at an entity created offline (ids are negative while
 * they wait for the server) and there is no way to fix it up later. Replaying
 * `PUT /workouts/-3` would 404 — see the known limitation about server-generated
 * ids. The guided-session paths are exempt: their local id is rewritten by the
 * replay of the start that created it.
 */
export function referencesLocalId(url: string): boolean {
  const route = normalizeRoute(url);
  if (!/\/-\d+(\/|$)/.test(route)) return false;
  return !LOCAL_ID_ALLOWED_PATHS.some((pattern) => pattern.test(route));
}

/**
 * A request that came back without any response never reached the server:
 * offline, DNS failure, refused connection or timeout.
 */
export function isConnectivityError(error: unknown): boolean {
  return axios.isAxiosError(error) && !error.response;
}

function isTimeoutError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  return error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT';
}

/**
 * Only failures we are sure the server never saw get queued. A timeout is
 * excluded on purpose: the request may well have been processed, and replaying
 * it would duplicate the write — the user retrying by hand is the safer path.
 *
 * The one exception is a request the server itself dedupes (the session start,
 * keyed by `client_session_id`): resending it either creates the workout or
 * returns the one it already created, so a timeout is safe to queue.
 */
export function isQueueableFailure(error: unknown, request?: { url?: string; body?: unknown }): boolean {
  if (!isConnectivityError(error)) return false;
  if (!isTimeoutError(error)) return true;
  return request !== undefined && isIdempotentRetryable(request.url ?? '', request.body);
}

// --- mutation queue ---------------------------------------------------------

/** Resolves with the server's response body, which the replay needs to reconcile ids. */
export type MutationExecutor = (mutation: PendingMutation) => Promise<unknown>;

// The executor is injected by src/api/client.ts instead of imported here, so the
// queue does not depend on the axios instance that depends on the queue.
let executeMutation: MutationExecutor | null = null;

export function registerMutationExecutor(executor: MutationExecutor): void {
  executeMutation = executor;
  if (isNetworkOnline() && getQueue().length > 0) void flushQueue();
}

/**
 * Id da conta logada, lido na hora (nunca em cache de módulo). `mob_user` é
 * gravado junto do token; o `mob-auth` persistido cobre sessões abertas antes
 * de `mob_user` existir. `null` = ninguém logado.
 */
export function currentUserId(): number | null {
  if (typeof localStorage === 'undefined') return null;
  const read = (key: string): unknown => {
    try {
      return JSON.parse(localStorage.getItem(key) ?? 'null');
    } catch {
      return null;
    }
  };
  const direct = read('mob_user') as { id?: unknown } | null;
  if (typeof direct?.id === 'number') return direct.id;
  const persisted = read('mob-auth') as { state?: { user?: { id?: unknown } } } | null;
  const id = persisted?.state?.user?.id;
  return typeof id === 'number' ? id : null;
}

/**
 * A fila tem dono. Item de outra conta, ou legado sem dono (veio de antes do
 * campo existir, ou de um backup restaurado), nunca sai sozinho: ficaria
 * indistinguível de trabalho da conta errada.
 */
export function isOwnedBy(mutation: PendingMutation, userId: number | null): boolean {
  return userId !== null && mutation.userId === userId;
}

/** Itens sem dono: aguardam decisão explícita no painel de sincronização. */
export function legacyMutations(): PendingMutation[] {
  return getQueue().filter((mutation) => mutation.userId === undefined);
}

/** "Enviar para esta conta": adota os itens legados para o usuário logado. */
export function adoptLegacyMutations(): number {
  const userId = currentUserId();
  if (userId === null) return 0;
  const legacy = legacyMutations();
  for (const mutation of legacy) patchQueuedMutation(mutation.localId, { userId });
  if (legacy.length > 0) flushQueueIfPending();
  return legacy.length;
}

/** "Descartar": só por ação explícita do usuário. */
export function discardLegacyMutations(): number {
  return dropQueuedMutations((mutation) => mutation.userId === undefined);
}

let localIdCounter = 0;

export function enqueueMutation(input: {
  method: MutationMethod;
  url: string;
  body?: unknown;
  params?: Record<string, unknown>;
  localEntityId?: number;
  trainingPlanDayId?: number;
  dedupeKey?: string;
  idempotent?: boolean;
  dateChange?: PendingMutation['dateChange'];
}): PendingMutation {
  localIdCounter += 1;
  const mutation: PendingMutation = {
    localId: `${Date.now().toString(36)}-${localIdCounter}`,
    method: input.method,
    url: input.url,
    body: input.body,
    params: input.params,
    createdAt: Date.now(),
    attempts: 0,
    localEntityId: input.localEntityId,
    trainingPlanDayId: input.trainingPlanDayId,
    dedupeKey: input.dedupeKey,
    idempotent: input.idempotent,
    dateChange: input.dateChange,
    userId: currentUserId() ?? undefined,
  };
  pushToQueue(mutation);
  return mutation;
}

let runningFlush: Promise<void> | null = null;
/** A write was queued while a flush was already running: run once more when it ends. */
let flushAgain = false;

/** Primeiro item da fila que pertence à conta logada agora. */
function nextEligible(skip?: ReadonlySet<string>): PendingMutation | undefined {
  const userId = currentUserId();
  if (userId === null || !localStorage.getItem('mob_token')) return undefined;
  return getQueue().find((mutation) => isOwnedBy(mutation, userId) && !skip?.has(mutation.localId));
}

/**
 * Replays the queue in FIFO order, one at a time. Order matters: a later
 * mutation may depend on an earlier one (finishing a workout after its sets),
 * so the first failure stops the run and leaves the rest for the next attempt.
 */
export function flushQueue(options: { force?: boolean } = {}): Promise<void> {
  if (runningFlush) return runningFlush;
  runningFlush = runFlush(options.force === true).finally(() => {
    runningFlush = null;
    if (flushAgain) {
      flushAgain = false;
      if (nextEligible() !== undefined) void flushQueue();
    }
  });
  return runningFlush;
}

/**
 * What a local-first action calls right after queueing its write. Never awaited
 * by the screen: it returns immediately and the send happens in the background.
 * `isNetworkOnline` only decides whether trying now is worthwhile; when it says
 * no (or the attempt fails) a backoff timer keeps trying, so a "network that
 * lies" costs nothing visible.
 */
export function requestFlush(): void {
  if (runningFlush) {
    flushAgain = true;
    return;
  }
  if (nextEligible() === undefined) return;
  if (!isNetworkOnline()) {
    scheduleRetry();
    return;
  }
  void flushQueue();
}

/**
 * Drains the queue whenever we learn the server answered something. Without
 * this the only triggers are app start and the `online` event, and neither
 * fires in the common case: a single write fails (flaky request, server
 * blip) while the device never actually loses its link. `navigator.onLine`
 * stays true, so no `online` event ever comes, and the write sits in the
 * queue until the app is reopened.
 */
export function flushQueueIfPending(): void {
  if (runningFlush || !isNetworkOnline() || nextEligible(heldIds()) === undefined) return;
  void flushQueue();
}

/**
 * Fails a mutation and, when it was a workout start, everything still queued
 * behind it that only makes sense once the start succeeds (its series, its
 * finish). A start that is refused for good — a 409 "another workout is
 * already in progress" from a session forgotten open on another device is the
 * one seen in practice — would otherwise leave those pointing at a workout
 * that was never created: each one replayed in turn, each one its own 404,
 * until the queue burns through every attempt on its own. Parking them
 * together, with a reason that says why, turns that into one legible entry
 * instead of a trickle of "not found" nobody asked for.
 */
function failMutationAndDependents(mutation: PendingMutation, reason: string): void {
  // Workout's own dependents (bespoke — see `dependentMutationsOf`'s comment)
  // plus whatever any registered `LocalIdReconciler` (nutrition food logs,
  // and any entity added after it) considers dependent on this create.
  const dependents = [...dependentMutationsOf(mutation), ...collectReconcilerDependents(mutation)];
  moveToFailed(mutation, reason);
  if (dependents.length === 0) return;
  const explanation = `Não foi possível enviar: o início deste treino falhou (${reason}).`;
  for (const dependent of dependents) moveToFailed(dependent, explanation);
}

async function runFlush(force: boolean): Promise<void> {
  if (!executeMutation || (!force && !isNetworkOnline())) return;
  if (nextEligible() === undefined) return;

  setSyncing(true);
  let replayed = 0;
  let stalled = false;
  // Itens que o servidor ainda não sabe atender (rota nova num backend antigo):
  // ficam para a próxima rodada sem travar o que vem atrás.
  const deferred = new Set<string>();
  try {
    // Re-read the queue on every step: a screen may have appended to it while
    // the previous replay was in flight.
    for (let mutation = nextEligible(deferred); mutation !== undefined; mutation = nextEligible(deferred)) {
      try {
        inFlightLocalId = mutation.localId;
        const result = await executeMutation(mutation);
        inFlightLocalId = undefined;
        removeFromQueue(mutation.localId);
        replayed += 1;
        retryAttempt = 0;
        try {
          // Must happen before the next iteration: everything queued behind a
          // session start still addresses `/workouts/-1/...` and would 404
          // unless the real id the server just returned is swapped in first.
          reconcileWorkoutStart(mutation, result);
        } catch (conflict) {
          if (!(conflict instanceof WorkoutStartConflictError)) throw conflict;
          // The start itself reached the server fine — it is already off the
          // queue — but the workout it deduped onto is not the one still open
          // here. Remapping would point every queued set and finish at a
          // closed workout, so instead the whole chain is parked as failed,
          // explained, with the local session and its recorded series left
          // untouched rather than silently discarded.
          failMutationAndDependents(mutation, conflict.message);
        }
        // Same idea, generalized: any entity outside the workout session that
        // registered itself via `registerLocalIdReconciler` (nutrition food
        // logs today) gets the same "swap the negative id for the real one,
        // everywhere it was written" treatment, before the next queued
        // mutation (an edit or delete still addressing the local id) is replayed.
        runLocalIdReconcilers(mutation, result);
        reconcileWorkoutSet(mutation, result);
      } catch (error) {
        inFlightLocalId = undefined;
        if (isConnectivityError(error)) {
          // A timeout is not proof the write failed — the server may well have
          // applied it. Retrying would duplicate the series; parking it lets the
          // person decide. Anything else is a real disconnection: keep the queue.
          if (isTimeoutError(error)) {
            if (!mutation.idempotent && !isIdempotentRetryable(mutation.url, mutation.body)) {
              failMutationAndDependents(mutation, 'A resposta do servidor demorou demais. Não dá para saber se foi salvo, então não reenviamos automaticamente.');
              continue;
            }
            // The server dedupes this one, so a resend is safe. Attempts are still
            // counted so a server that always times out cannot wedge the queue —
            // and stopping here keeps the session's own writes behind it in order.
            const timedOutAttempts = mutation.attempts + 1;
            if (timedOutAttempts >= maxAttemptsFor(mutation)) {
              failMutationAndDependents(mutation, 'O servidor não respondeu depois de várias tentativas.');
              continue;
            }
            patchQueuedMutation(mutation.localId, {
              attempts: timedOutAttempts,
              lastError: 'O servidor demorou a responder. Vamos tentar de novo.',
            });
            stalled = true;
            break;
          }
          reportNetworkFailure();
          stalled = true;
          break;
        }
        const attempts = mutation.attempts + 1;
        const status = axios.isAxiosError(error) ? error.response?.status ?? 0 : 0;
        const reason = describeError(error);
        // An expired session rejects every pending write the same way. Parking
        // them one by one would burn the whole queue (and the failed list only
        // keeps the last few), so stop and keep everything for after re-login.
        // O 401 de um reenvio não desloga ninguém (ver client.ts): o item fica
        // retido e, se a recusa persistir, vira falha explicada em vez de
        // tentar para sempre a cada resposta que chega.
        if (status === 401 || status === 403) {
          if (attempts >= MAX_MUTATION_ATTEMPTS) {
            failMutationAndDependents(mutation, 'O servidor recusou a sessão várias vezes ao reenviar.');
            continue;
          }
          patchQueuedMutation(mutation.localId, {
            attempts,
            lastError: 'O servidor recusou a sessão. Vamos tentar de novo depois.',
          });
          stalled = true;
          break;
        }
        // `PUT /workouts/{id}/date` num backend que ainda não tem a rota responde
        // 404/405. Isso é "ainda não", não "nunca": a troca de data é do dono do
        // aparelho e precisa sobreviver até o deploy. Fica na fila, retentada com
        // backoff e sem gastar tentativas; só é desistida se o treino sumiu de
        // vez (30 dias sem o servidor aceitar).
        if ((status === 404 || status === 405) && isWorkoutDateRoute(mutation.url) && Date.now() - mutation.createdAt < DATE_ROUTE_PATIENCE_MS) {
          patchQueuedMutation(mutation.localId, {
            lastError: 'O servidor ainda não aceita a troca de data. Vamos tentar de novo depois.',
          });
          deferred.add(mutation.localId);
          heldUntil.set(mutation.localId, Date.now() + HOLD_MS);
          stalled = true;
          continue;
        }
        // Closing a session the server no longer has open is not a failure:
        // finish, complete and cancel all ask for "no open session", and a 404
        // or 409 means that is already true. Parking it would leave the workout
        // on screen forever, and every new attempt to close it only queues
        // another doomed request.
        const ending = parseSessionEndRoute(mutation.url);
        if (ending && (status === 404 || status === 409)) {
          removeFromQueue(mutation.localId);
          forgetLocalSessionIfMatches(ending.workoutId);
          replayed += 1;
          continue;
        }
        // Undoing a series the server no longer has: the wanted end state
        // ("that series is gone") already holds.
        if (parseSetDeleteRoute(mutation.url) && status === 404) {
          removeFromQueue(mutation.localId);
          replayed += 1;
          continue;
        }
        // A 4xx will never succeed on replay (duplicate, stale, refused), so it
        // is parked as failed — along with anything that only made sense once
        // this one went through. A 5xx may be temporary and gets a few retries
        // before it is parked too — either way the queue never deadlocks.
        if ((status >= 400 && status < 500) || attempts >= maxAttemptsFor(mutation)) {
          failMutationAndDependents(mutation, reason);
          continue;
        }
        patchQueuedMutation(mutation.localId, { attempts, lastError: reason });
        stalled = true;
        break;
      }
    }
  } finally {
    inFlightLocalId = undefined;
    setSyncing(false);
  }
  if (stalled) scheduleRetry();

  if (replayed > 0) {
    markSynced(QUEUE_SYNC_KEY);
    // Snapshots read outside `readThrough` (the guided session calls the API
    // directly) are not tracked and would keep serving pre-sync data — with
    // local negative ids that no longer match the server. Dropping them forces
    // the next read to go out, which now succeeds since the queue just drained.
    //
    // Only once it really drained, though: with writes still queued the server's
    // copy is behind the device's, and re-reading it would wipe series that are
    // waiting to be sent off a session that is still running.
    if (getQueue().length === 0) invalidateCacheByPrefix('get:/workouts');
    // The local snapshots predate everything that was just replayed.
    await revalidateTrackedResources();
  }
}

function describeError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { error?: string } | undefined;
    return data?.error ?? error.message;
  }
  return error instanceof Error ? error.message : 'Erro desconhecido';
}

// --- read-through cache -----------------------------------------------------

interface TrackedResource {
  run: () => Promise<void>;
}

// Kept so `syncNow()` can refresh exactly what the app has already displayed.
const trackedResources = new Map<ResourceKey, TrackedResource>();

export interface ReadThroughOptions<T> {
  resourceKey: ResourceKey;
  fetcher: () => Promise<T>;
  /** Called with the cached copy first (when there is one), then with the fresh one. */
  apply: (data: T, origin: 'cache' | 'network') => void;
  /** Called when the network read fails; `hadCache` tells whether the screen has something to show. */
  onError?: (error: unknown, hadCache: boolean) => void;
  /** Skip storing the payload — for volatile or oversized responses. */
  cacheable?: boolean;
}

/**
 * Offline-first read: hands over the local copy immediately, then revalidates
 * in the background whenever there is a connection. The screen never waits for
 * the network to show something it already has.
 */
export async function readThrough<T>(options: ReadThroughOptions<T>): Promise<void> {
  const { resourceKey, fetcher, apply, onError, cacheable = true } = options;

  if (trackedResources.size >= MAX_TRACKED_RESOURCES && !trackedResources.has(resourceKey)) {
    const oldest = trackedResources.keys().next().value;
    if (oldest !== undefined) trackedResources.delete(oldest);
  }
  trackedResources.delete(resourceKey);
  trackedResources.set(resourceKey, { run: () => revalidate(options) });

  const cached = readCache<T>(resourceKey);
  const hadCache = cached !== undefined;
  if (hadCache) apply(cached as T, 'cache');

  if (!isNetworkOnline()) {
    if (!hadCache) onError?.(new OfflineUnavailableError(), false);
    return;
  }

  try {
    const fresh = await fetcher();
    if (cacheable) writeCache(resourceKey, fresh);
    else markSynced(resourceKey);
    apply(fresh, 'network');
  } catch (error) {
    if (isConnectivityError(error)) reportNetworkFailure();
    onError?.(error, hadCache);
  }
}

/** Same as `readThrough` minus the cache-first hand-over: used by `syncNow()`. */
async function revalidate<T>(options: ReadThroughOptions<T>): Promise<void> {
  const { resourceKey, fetcher, apply, onError, cacheable = true } = options;
  if (!isNetworkOnline()) return;
  try {
    const fresh = await fetcher();
    if (cacheable) writeCache(resourceKey, fresh);
    else markSynced(resourceKey);
    apply(fresh, 'network');
  } catch (error) {
    if (isConnectivityError(error)) reportNetworkFailure();
    onError?.(error, true);
  }
}

async function revalidateTrackedResources(): Promise<void> {
  const runs = [...trackedResources.values()].map((resource) => resource.run());
  await Promise.allSettled(runs);
}

/** Flushes pending writes and refreshes every resource the app has read so far. */
export async function syncNow(): Promise<void> {
  await flushQueue();
  await revalidateTrackedResources();
}

// --- wiring -----------------------------------------------------------------

setOnline(isNetworkOnline());
onNetworkStatusChange((online) => {
  setOnline(online);
  // Connection is back: drain whatever piled up, then refresh the screens.
  if (online) void flushQueue();
});
