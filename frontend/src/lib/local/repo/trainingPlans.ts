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
import { getRecord, putRecord } from '../../localDb';
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

    // Detalhe de TODOS os planos ativos, não só do primeiro. `find` devolvia
    // um só, e quem tem mais de um plano ativo ficava com os demais presos na
    // versão que estava no aparelho — eles só atualizavam se a pessoa abrisse
    // cada um na mão.
    for (const plano of plans.filter((plan) => plan.active)) {
      await rememberPlan(await trainingPlansApi.get(plano.id));
    }
  } catch {
    // Best-effort: o próximo tick agendado tenta de novo.
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

/**
 * Versão do formato do plano guardado no aparelho.
 *
 * Serve para uma coisa só: quando o servidor passa a devolver um campo novo em
 * exercício já existente, o plano no aparelho continua válido — e por isso
 * ninguém o rebusca — mas sem o campo. Foi o que aconteceu com os vídeos: o
 * vínculo nasceu no servidor para planos que já estavam no aparelho, e o app
 * não tinha por que notar.
 *
 * Subir este número força uma releitura dos detalhes na próxima abertura.
 * 1 → 2: exercícios passaram a ter `video`.
 */
const VERSAO_FORMATO_PLANO = 2;
const CHAVE_VERSAO = 'training_plans_format_version';

/**
 * Rebusca os detalhes uma única vez quando o formato guardado ficou para trás.
 *
 * Não apaga nada: `rememberPlan` sobrescreve campo a campo, então uma sessão
 * offline em andamento e os dias guardados continuam de pé mesmo se isto falhar
 * no meio. Falhando, a versão não é gravada e a próxima abertura tenta de novo.
 */
export async function migrarFormatoDosPlanos(): Promise<void> {
  const guardado = await getRecord<{ key: string; value: number }>('meta', CHAVE_VERSAO);
  if ((guardado?.value ?? 1) >= VERSAO_FORMATO_PLANO) return;
  if (!isNetworkOnline()) return;

  try {
    const plans = await trainingPlansApi.list();
    for (const plano of plans) {
      await rememberPlan(await trainingPlansApi.get(plano.id));
    }
    await putRecord('meta', { key: CHAVE_VERSAO, value: VERSAO_FORMATO_PLANO });
  } catch {
    // Sem gravar a versão: a próxima abertura tenta de novo.
  }
}
