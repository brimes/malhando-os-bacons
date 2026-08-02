// Polyfills `indexedDB` for the Node test environment. `localDb.ts` feature-
// detects `typeof indexedDB === 'undefined'` the same way it would in a real
// browser without this — `fake-indexeddb/auto` is what makes that check pass
// under `vitest run`, not a shim `localDb.ts` itself needs to know about.
import 'fake-indexeddb/auto';
