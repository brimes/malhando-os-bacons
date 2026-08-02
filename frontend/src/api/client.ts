import axios, { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import {
  enqueueMutation,
  isConnectivityError,
  isMutationMethod,
  isOnlineOnlyPath,
  isQueueableFailure,
  normalizePath,
  readCacheEntry,
  referencesLocalId,
  registerMutationExecutor,
  flushQueueIfPending,
  reportNetworkFailure,
  reportNetworkSuccess,
  resourceKeyForRequest,
  takeLocalId,
  UnsyncedDependencyError,
  writeCache,
} from '../lib/offline';
import { dayIdForActiveWorkout, parseCloseRoute } from '../lib/workoutSession';
import type { MutationMethod } from '../types/offline';

const BASE_URL = import.meta.env.VITE_API_URL ?? '/api';

export const apiClient = axios.create({
  baseURL: BASE_URL,
  // Default for ordinary CRUD calls. AI calls that run synchronously against a
  // live LLM (onboarding chat, workout chat, nutrition photos, cheat-day chat,
  // rest-of-day suggestion) each pass their own, larger `timeout` — see the
  // call sites. Plan generation/adjustment is asynchronous (job + polling) and
  // never needs one at all.
  timeout: 8000,
  headers: {
    'Content-Type': 'application/json',
  },
});

/** Marks a request as a queue replay, so a second failure does not re-queue it. */
interface OfflineAwareConfig extends InternalAxiosRequestConfig {
  isOfflineReplay?: boolean;
}

// Volatile or unbounded responses: caching them buys nothing and eats the
// localStorage budget the queue depends on.
const NON_CACHEABLE_GET_PATHS: RegExp[] = [
  /^\/nutrition\/foods\/search/,
  /^\/nutrition\/plans\/jobs\//,
  /^\/nutrition\/suggestion/,
  /^\/nutrition\/photos\//,
  /^\/nutrition\/cheat-day/,
  /^\/training-plans\/jobs\//,
  /^\/chat(\/|$)/,
  // The chat screen refuses to open offline anyway, so a cached history would
  // only take up room that the pending queue needs more. `-?` covers a
  // session still running on its offline-assigned id.
  /^\/workouts\/-?\d+\/chat(\/|$)/,
];

const ONLINE_ONLY_MESSAGE = 'Esta ação precisa de internet. Conecte-se e tente novamente.';

/** Code on the synthetic error a captive-portal response is turned into, so it never gets mistaken for a real timeout. */
const CAPTIVE_PORTAL_ERROR_CODE = 'ERR_CAPTIVE_PORTAL';

function isCacheableGetPath(url: string): boolean {
  const path = normalizePath(url);
  return !NON_CACHEABLE_GET_PATHS.some((pattern) => pattern.test(path));
}

/**
 * Our API always answers with `application/json` (see `writeJSON` on the
 * backend) or, for a handful of legitimate binary routes (e.g.
 * `GET /nutrition/photos/:id`), a real content type for the file it serves —
 * never HTML. A captive portal intercepts the request and answers with its
 * own login page instead, still as a 200, so the only reliable tell is the
 * declared content type, not the status or the body's shape.
 */
function looksLikeCaptivePortalResponse(response: AxiosResponse): boolean {
  if (response.status === 204) return false;
  const contentType = String(response.headers?.['content-type'] ?? '');
  return /html/i.test(contentType);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Axios has already serialized the body by the time an interceptor sees it. */
function parseRequestBody(data: unknown): unknown {
  if (typeof data !== 'string') return data;
  try {
    return JSON.parse(data);
  } catch {
    return undefined;
  }
}

function buildResponse<T>(config: InternalAxiosRequestConfig, status: number, data: T, statusText: string): AxiosResponse<T> {
  return { data, status, statusText, headers: {}, config };
}

/**
 * Stand-in body for a write that got queued. Callers expect the created entity
 * back, so the request body is echoed with a negative id — negative ids are the
 * marker for "exists only on this device yet".
 */
function buildOptimisticPayload(config: OfflineAwareConfig, method: MutationMethod): unknown {
  if (method === 'DELETE') return null;
  const body = parseRequestBody(config.data);
  if (!isPlainObject(body)) return null;

  const idInUrl = Number(normalizePath(config.url ?? '').match(/\/(\d+)(?:\?|$)/)?.[1]);
  const id = method === 'POST'
    ? takeLocalId()
    : (typeof body.id === 'number' ? body.id : (Number.isFinite(idInUrl) ? idInUrl : takeLocalId()));

  const payload: Record<string, unknown> = { ...body, id, offline_pending: true };
  if (method === 'POST') payload.created_at = new Date().toISOString();
  return payload;
}

// Attach JWT token to every request
apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = localStorage.getItem('mob_token');
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

/**
 * Everything a connectivity failure does once it is recognized as one,
 * shared between a real network error and a captive portal's 200-with-HTML
 * masquerading as a response. `error` only has to look enough like an
 * `AxiosError` for `isQueueableFailure`/`isConnectivityError` to classify it —
 * see `looksLikeCaptivePortalResponse`'s call site for how that error is built.
 */
function handleConnectivityFailure(config: OfflineAwareConfig, error: AxiosError): Promise<AxiosResponse> {
  const url = config.url ?? '';
  const method = (config.method ?? 'get').toUpperCase();

  // Reads fall back to the last snapshot instead of failing the screen.
  if (!isMutationMethod(method)) {
    const cached = readCacheEntry(resourceKeyForRequest(url, config.params));
    if (cached) {
      // A cached `null` is the 204 the server sent (e.g. no active workout).
      const status = cached.data === null ? 204 : 200;
      return Promise.resolve(buildResponse(config, status, cached.data, 'OK (cache local)'));
    }
    return Promise.reject(error);
  }

  if (isOnlineOnlyPath(url)) {
    return Promise.reject(new Error(ONLINE_ONLY_MESSAGE));
  }
  if (referencesLocalId(url)) {
    // The target only exists in the queue; the server has no id for it yet.
    return Promise.reject(new UnsyncedDependencyError());
  }
  const body = parseRequestBody(config.data);
  if (!isQueueableFailure(error, { url, body })) return Promise.reject(error);

  const optimistic = buildOptimisticPayload(config, method);
  // The negative id travels with the mutation so the replay can pair it with
  // the real id the server assigns, and rewrite whatever was queued behind it.
  const localEntityId = isPlainObject(optimistic) && typeof optimistic.id === 'number' && optimistic.id < 0
    ? optimistic.id
    : undefined;
  // A `finish`/`complete` is tagged with its training plan day right now,
  // while the local session slot still knows it — by the time anything
  // reads the queue again the session may already be cleared (the screen
  // clears it right after queueing the very mutation being built here) or
  // its start may have synced and left the queue entirely. Either way this
  // is the only moment the answer is guaranteed available.
  const closeRoute = parseCloseRoute(url);
  const trainingPlanDayId = closeRoute ? dayIdForActiveWorkout(closeRoute.workoutId) : undefined;
  enqueueMutation({
    method,
    url,
    body,
    params: config.params as Record<string, unknown> | undefined,
    localEntityId,
    trainingPlanDayId,
  });
  // Resolved, not rejected: the write is durable and will reach the server on
  // reconnect, so the screen should carry on instead of showing an error.
  return Promise.resolve(buildResponse(config, 202, optimistic, 'Accepted (offline)'));
}

apiClient.interceptors.response.use(
  (response) => {
    const config = response.config as OfflineAwareConfig;

    if (looksLikeCaptivePortalResponse(response)) {
      // A 200 with an HTML body from a path under our own baseURL is not our
      // API — it is a captive portal's login page. Treated as a dropped
      // connection: reporting it "successful" would hand screens that call the
      // API directly (bypassing readThrough) an HTML string where they expect
      // JSON, and the app has no error boundary to catch what that throws.
      reportNetworkFailure();
      const portalError = new axios.AxiosError(
        'Resposta não é da API (portal cativo?)',
        CAPTIVE_PORTAL_ERROR_CODE,
        config,
      );
      // Replays are driven by flushQueue, which decides what to do with failures.
      if (config.isOfflineReplay) return Promise.reject(portalError);
      return handleConnectivityFailure(config, portalError);
    }

    // A response of any kind proves the server is reachable.
    reportNetworkSuccess();
    // ...so anything waiting in the queue can go out now. Relying only on the
    // `online` event leaves writes stranded whenever the link never dropped.
    if (!config.isOfflineReplay) flushQueueIfPending();
    const url = config.url ?? '';
    const method = (config.method ?? 'get').toUpperCase();
    // Every GET is cached on the way through, which is what lets screens that
    // call the API directly (without a store) keep working offline.
    if (method === 'GET' && response.status >= 200 && response.status < 300 && isCacheableGetPath(url)) {
      writeCache(resourceKeyForRequest(url, config.params), response.status === 204 ? null : response.data);
    }
    return response;
  },
  (error: AxiosError) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('mob_token');
      localStorage.removeItem('mob_user');
      window.location.href = '/login';
      return Promise.reject(error);
    }

    const config = error.config as OfflineAwareConfig | undefined;
    if (!config || !isConnectivityError(error)) return Promise.reject(error);
    // Replays are driven by flushQueue, which decides what to do with failures.
    if (config.isOfflineReplay) return Promise.reject(error);

    return handleConnectivityFailure(config, error);
  },
);

// Lets the queue replay through this very instance (auth header, base URL and
// the 401 handling included) without offlineSync having to import it.
registerMutationExecutor(async (mutation) => {
  const response = await apiClient.request({
    method: mutation.method,
    url: mutation.url,
    data: mutation.body,
    params: mutation.params,
    isOfflineReplay: true,
  } as OfflineAwareConfig);
  // Handed back so the queue can reconcile ids the server just assigned — a
  // session started offline learns its real workout id from here.
  return response.data;
});

export function getErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    // "Network Error" says nothing to whoever is holding the phone.
    if (isConnectivityError(error)) return 'Sem conexão com o servidor. Tente novamente quando estiver online.';
    const data = error.response?.data as { error?: string } | undefined;
    return data?.error ?? error.message;
  }
  if (error instanceof Error) return error.message;
  return 'Erro desconhecido';
}
