// Connection detection. Deliberately free of imports so the offline store and
// the axios client can both depend on it without creating a cycle.

type NetworkListener = (isOnline: boolean) => void;

// `navigator.onLine` only reports whether the device has *a* link: a captive
// wifi portal answers every request with 200 and a login page, so the OS
// considers the link up while every real request is dead. A probe against the
// backend's own health endpoint is the only way to tell — and even that is not
// enough on its own, because the captive portal also answers `/api/health`
// with 200: the body has to be checked, not just the status.
const BASE_URL = (typeof import.meta !== 'undefined' && (import.meta as { env?: { VITE_API_URL?: string } }).env?.VITE_API_URL) || '/api';

/** How long the probe waits before giving up and calling it offline. */
const PROBE_TIMEOUT_MS = 3_000;
/** How often the probe repeats while the last result was negative. Never runs on a timer while positive. */
const PROBE_INTERVAL_WHILE_OFFLINE_MS = 30_000;

const listeners = new Set<NetworkListener>();

/** Result of the last body-validated probe. Optimistic until the boot probe resolves. */
let probeOnline = true;
/** `navigator.onLine === false` short-circuits to offline without spending a probe. */
let isOnline = computeStatus();
let probeTimer: number | undefined;
let probeInFlight: Promise<void> | null = null;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function computeStatus(): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  return probeOnline;
}

function notify(next: boolean) {
  if (next === isOnline) return;
  isOnline = next;
  listeners.forEach((listener) => listener(next));
}

function recompute() {
  notify(computeStatus());
}

function clearProbeTimer() {
  if (probeTimer !== undefined) {
    window.clearTimeout(probeTimer);
    probeTimer = undefined;
  }
}

/** Schedules the next probe only while the last one was negative — a healthy link is never polled. */
function scheduleNextProbe() {
  clearProbeTimer();
  if (probeOnline || typeof window === 'undefined') return;
  probeTimer = window.setTimeout(() => {
    probeTimer = undefined;
    void runProbe();
  }, PROBE_INTERVAL_WHILE_OFFLINE_MS);
}

/**
 * Fetches `/api/health` and accepts only a body that parses as JSON with
 * `status === 'ok'`. A captive portal's login page comes back as HTML (fails
 * to parse), an empty body (fails to parse) or a 200 with the wrong shape —
 * all three have to read as offline, which a bare status check would miss.
 */
async function probeHealth(): Promise<boolean> {
  if (typeof fetch === 'undefined') return true;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
  const timeoutId = typeof window !== 'undefined' && controller
    ? window.setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
    : undefined;
  try {
    const response = await fetch(`${BASE_URL}/health`, { signal: controller?.signal, cache: 'no-store' });
    const text = await response.text();
    const body: unknown = JSON.parse(text);
    return isPlainObject(body) && body.status === 'ok';
  } catch {
    return false;
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  }
}

/**
 * Runs a single probe, coalescing concurrent callers into the same in-flight
 * request. A no-op whenever the OS itself already says there is no link —
 * spending a probe on that would just wait out `PROBE_TIMEOUT_MS` for an
 * answer that `navigator.onLine` already gave for free.
 */
function runProbe(): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    recompute();
    return Promise.resolve();
  }
  if (probeInFlight) return probeInFlight;
  probeInFlight = probeHealth()
    .then((result) => {
      probeOnline = result;
      recompute();
      scheduleNextProbe();
    })
    .finally(() => {
      probeInFlight = null;
    });
  return probeInFlight;
}

if (typeof window !== 'undefined') {
  // The OS regained a link — still needs the body-validated probe before
  // trusting it, since this is exactly the event a captive portal fires.
  window.addEventListener('online', () => {
    void runProbe();
  });
  // The OS itself says there is no link: trust it immediately, no probe spent.
  window.addEventListener('offline', () => {
    clearProbeTimer();
    recompute();
  });
  // Coming back to the foreground is the other moment a phone walks into (or
  // out of) a captive portal without any 'online'/'offline' event firing.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void runProbe();
  });
  // Boot probe. `runProbe` itself is the guard against `navigator.onLine === false`.
  void runProbe();
}

export function isNetworkOnline(): boolean {
  return isOnline;
}

export function onNetworkStatusChange(listener: NetworkListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Called when a request dies without a response. Flips to offline right away
 * for fast feedback, then confirms with a body-validated probe instead of
 * trusting `navigator.onLine` blindly — the old optimistic recheck came back
 * "online" on a captive portal every time, because the OS never actually
 * dropped the link.
 */
export function reportNetworkFailure(): void {
  probeOnline = false;
  recompute();
  void runProbe();
}

/**
 * Called when any request comes back with a response: the server is
 * reachable. Only confirms — it never revives from a negative probe on its
 * own, because a captive portal answers every path with 200 and HTML, not
 * just `/api/health`. If the last probe was negative, this fires an
 * immediate, body-validated probe instead (coalesced with one already in
 * flight via `runProbe`) so the probe itself decides, and a real network
 * recovers without waiting out the 30s retry cycle.
 */
export function reportNetworkSuccess(): void {
  if (!probeOnline) {
    void runProbe();
    return;
  }
  clearProbeTimer();
  recompute();
}
