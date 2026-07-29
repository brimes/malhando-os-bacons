// Connection detection. Deliberately free of imports so the offline store and
// the axios client can both depend on it without creating a cycle.

type NetworkListener = (isOnline: boolean) => void;

// `navigator.onLine` only reports whether the device has *a* link: a captive
// wifi portal, a dead VPN or a backend that is down all report `true`. Requests
// that die without a response are the second, more reliable signal, so the
// status here is the combination of both.
const RECHECK_AFTER_FAILURE_MS = 15_000;

const listeners = new Set<NetworkListener>();
let isOnline = typeof navigator === 'undefined' || navigator.onLine !== false;
let recheckTimer: number | undefined;

function setStatus(next: boolean) {
  if (next === isOnline) return;
  isOnline = next;
  listeners.forEach((listener) => listener(next));
}

function clearRecheck() {
  if (recheckTimer !== undefined) {
    window.clearTimeout(recheckTimer);
    recheckTimer = undefined;
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    clearRecheck();
    setStatus(true);
  });
  window.addEventListener('offline', () => {
    clearRecheck();
    setStatus(false);
  });
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
 * Called when a request dies without a response. The browser may never fire an
 * `online` event afterwards (the OS link never actually dropped), so an
 * optimistic recheck is scheduled — otherwise the app would stay stuck in
 * offline mode until the next reload.
 */
export function reportNetworkFailure(): void {
  setStatus(false);
  if (typeof window === 'undefined' || recheckTimer !== undefined) return;
  recheckTimer = window.setTimeout(() => {
    recheckTimer = undefined;
    if (typeof navigator === 'undefined' || navigator.onLine !== false) setStatus(true);
  }, RECHECK_AFTER_FAILURE_MS);
}

/** Called when any request comes back with a response: the server is reachable. */
export function reportNetworkSuccess(): void {
  clearRecheck();
  setStatus(true);
}
