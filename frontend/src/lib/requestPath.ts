// Turns whatever axios recorded as the request URL into a stable, comparable
// path. It lives on its own (instead of inside offlineSync) because both the
// request classifier and the workout-session helpers need it, and offlineSync
// imports the session helpers — sharing it here is what keeps that from becoming
// a circular import.

/** `https://api.mob.app/api/workouts/start` and `/api/workouts/start` both become `/workouts/start`. */
export function normalizePath(url: string): string {
  const withoutBase = url.replace(/^https?:\/\/[^/]+/, '').replace(/^\/api(?=\/)/, '');
  return withoutBase.startsWith('/') ? withoutBase : `/${withoutBase}`;
}

/** Same as `normalizePath` minus the query string, for exact route matching. */
export function normalizeRoute(url: string): string {
  return normalizePath(url).replace(/\?.*$/, '');
}
