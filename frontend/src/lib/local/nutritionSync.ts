// Background sync for nutrition, wired up once as a side effect of importing
// this module (see the bottom of this file, and `offlineBoot.ts` which
// imports it after the entity caches finish loading). Two independent loops:
//
//  - push: the shared mutation queue (`offlineSync.ts`'s `flushQueue`)
//    already knows how to replay and retry — this only decides *when* to
//    call it: right after a local-first write (`repo/shared.ts`'s
//    `enqueueAndPushSoon`, not here), on reconnect, on foreground, and every
//    60s while anything is queued.
//  - pull: one interval per collection, each guarded by the same three
//    rules (offline, backgrounded, outbox non-empty for that collection —
//    see each repo module's pull function) so a screen never has to think
//    about any of this.

import { flushQueueIfPending, onNetworkStatusChange } from '../offline';
import { offlineReady } from '../offlineBoot';
import { pullFoodLogs } from './repo/foodLogs';
import { pullPersonalFoods } from './repo/foodItems';
import { pullNutritionPlans } from './repo/nutritionPlans';
import { migrarFormatoDosPlanos, pullTrainingPlans } from './repo/trainingPlans';
import { pullWorkouts } from './repo/workouts';

const PUSH_INTERVAL_MS = 60_000;
const FOOD_LOGS_PULL_INTERVAL_MS = 5 * 60_000;
const NUTRITION_PLANS_PULL_INTERVAL_MS = 15 * 60_000;
const FOOD_ITEMS_PULL_INTERVAL_MS = 30 * 60_000;
// Treino muda com a mesma frequência que a comida — a pessoa registra e quer
// ver refletido. O plano muda raramente, então acompanha o ritmo do cardápio.
const WORKOUTS_PULL_INTERVAL_MS = 5 * 60_000;
const TRAINING_PLANS_PULL_INTERVAL_MS = 15 * 60_000;

let started = false;

function schedule(fn: () => void, intervalMs: number): void {
  fn();
  setInterval(fn, intervalMs);
}

/**
 * Starts every timer and listener exactly once. Idempotent so a test (or a
 * hot reload) importing this module more than once cannot double the
 * intervals — nothing here is per-component, it runs for the app's whole
 * lifetime once boot calls this.
 */
/**
 * Sem sessão não há o que sincronizar, e tentar é ativamente daninho: o
 * servidor responde 401, o app derruba a sessão e manda para o login. Na tela
 * de login isso vira ciclo — foi o que fazia a tela piscar no iOS, onde não
 * dava nem para digitar a senha. O token é lido do localStorage, a mesma fonte
 * que o interceptor usa, para não depender do store de autenticação aqui.
 */
function hasSession(): boolean {
  return typeof localStorage !== 'undefined' && !!localStorage.getItem('mob_token');
}

export function startNutritionSync(): void {
  if (started) return;
  started = true;

  const push = () => {
    if (hasSession()) flushQueueIfPending();
  };

  // Push: reconnect and foreground.
  onNetworkStatusChange((online) => {
    if (online) push();
  });
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') push();
    });
  }
  setInterval(push, PUSH_INTERVAL_MS);

  // Pull: one sliding-window/full-set refetch per collection. Each pull
  // function is its own guard (offline, backgrounded, outbox non-empty) — the
  // rule "nunca rode push ou pull enquanto o probe estiver negativo" is
  // enforced there via `isNetworkOnline()`, not here.
  schedule(() => { if (hasSession()) void pullFoodLogs(); }, FOOD_LOGS_PULL_INTERVAL_MS);
  schedule(() => { if (hasSession()) void pullNutritionPlans(); }, NUTRITION_PLANS_PULL_INTERVAL_MS);
  schedule(() => { if (hasSession()) void pullPersonalFoods(); }, FOOD_ITEMS_PULL_INTERVAL_MS);
  schedule(() => { if (hasSession()) void pullWorkouts(); }, WORKOUTS_PULL_INTERVAL_MS);
  schedule(() => { if (hasSession()) void pullTrainingPlans(); }, TRAINING_PLANS_PULL_INTERVAL_MS);

  // Uma vez só, e antes de qualquer tela ler: um plano guardado no aparelho
  // continua válido quando o servidor ganha um campo novo em exercício, então
  // nada o rebuscaria e ele ficaria sem o campo para sempre. Ver
  // `VERSAO_FORMATO_PLANO` em `repo/trainingPlans.ts`.
  if (hasSession()) void migrarFormatoDosPlanos();
}

// Started as a side effect of import — `App.tsx` imports this module for
// exactly that — once `offlineReady` settles, not before: a pull's first
// tick fires immediately (see `schedule`) and writes to the same IndexedDB
// database `useOfflineStore`'s `persist.rehydrate()` is still reading from
// until then. Racing ahead of it risks losing that write the moment
// `rehydrate()` resolves and replaces the store wholesale — see the matching
// comment on `repo/foodLogs.ts`'s own `ensureLoaded()` call.
void offlineReady.then(() => startNutritionSync());
