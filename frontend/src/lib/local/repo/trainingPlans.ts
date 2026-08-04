// A coleção `training_plans`. Leitura local-first para as telas de treino, que
// até aqui iam à rede antes de desenhar — o dono relatou o app demorando para
// abrir com internet lenta, e era isso.
//
// O detalhe (com os dias e exercícios) e o resumo da listagem convivem no mesmo
// store: `GET /training-plans` devolve planos sem `days`, e `GET
// /training-plans/{id}` devolve com. Guardar o de menor detalhe por cima do
// completo apagaria os dias do aparelho, então o merge preserva o que já existe
// (ver `mergePreservingDays`).

import { trainingPlansApi } from '../../../api/trainingPlans';
import type { TrainingPlan } from '../../../types';
import { isNetworkOnline } from '../../offline';
import { offlineReady } from '../../offlineBoot';
import { EntityCache } from '../entityStore';
import { hasPendingMutationsFor } from './shared';

const PULL_TIMEOUT_MS = 10_000;
const ROUTE_PREFIX = '/training-plans';

export const trainingPlansCache = new EntityCache<TrainingPlan>('training_plans');

export function listPlans(): TrainingPlan[] {
  return trainingPlansCache.getAll();
}

export function getPlan(id: number): TrainingPlan | undefined {
  return trainingPlansCache.get(id);
}

export function getActivePlan(): TrainingPlan | undefined {
  return trainingPlansCache.getAll().find((plan) => plan.active);
}

// Espera `offlineReady` para não correr com a rehidratação do `useOfflineStore`
// sobre o mesmo banco — mesma razão descrita em `repo/foodLogs.ts`.
void offlineReady.then(() => trainingPlansCache.ensureLoaded());

/**
 * A listagem não traz `days`. Sobrescrever o registro local com ela apagaria os
 * dias de um plano já detalhado — e é justamente deles que depende iniciar
 * treino sem internet. Então o que chega só substitui campo a campo, e `days`
 * do que já está no aparelho vence quando o novo vem vazio.
 */
function mergePreservingDays(incoming: TrainingPlan): TrainingPlan {
  const existing = trainingPlansCache.get(incoming.id);
  if (!existing) return incoming;
  const days = incoming.days?.length ? incoming.days : existing.days;
  return { ...existing, ...incoming, days };
}

/**
 * Guarda o plano vindo do servidor. Chamado tanto pelo pull quanto pelas telas
 * que buscam o detalhe, para que abrir um plano uma vez o deixe disponível
 * offline depois.
 */
export async function rememberPlan(plan: TrainingPlan): Promise<void> {
  await trainingPlansCache.put(mergePreservingDays(plan));
}

/**
 * Atualiza por id, nunca `clear()` + regrava: `workouts` referencia dias com
 * `ON DELETE SET NULL`, e um plano que sumisse do store por um instante
 * poderia deixar uma sessão offline apontando para dia inexistente — o
 * histórico e os pesos memorizados se desvinculam sem erro nenhum.
 *
 * Puxa a listagem e, para o plano acompanhado, também o detalhe: é o único que
 * precisa dos dias para o treino da vez e para iniciar sem rede.
 */
export async function pullTrainingPlans(): Promise<void> {
  if (!isNetworkOnline()) return;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  if (hasPendingMutationsFor(ROUTE_PREFIX)) return;

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
  const timeoutId = controller ? setTimeout(() => controller.abort(), PULL_TIMEOUT_MS) : undefined;
  try {
    const plans = await trainingPlansApi.list();
    await trainingPlansCache.upsertMany(plans.map(mergePreservingDays));

    const tracked = plans.find((plan) => plan.active);
    if (tracked) {
      const detail = await trainingPlansApi.get(tracked.id);
      await rememberPlan(detail);
    }
  } catch {
    // Best-effort: o próximo tick agendado tenta de novo.
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}
