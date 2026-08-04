// A coleção `workouts` (treinos concluídos). Leitura local-first para o
// histórico, a faixa da semana e o dashboard, que até aqui esperavam a rede
// para desenhar.
//
// Escrita continua onde sempre esteve: iniciar treino, registrar série e
// finalizar passam pela sessão em andamento (`lib/workoutSession.ts`), que já é
// offline por design e tem idempotência própria — `client_session_id` e
// `client_set_id`. Nada aqui toca nesse caminho; este módulo só lê e sincroniza
// o que já está concluído.

import { workoutsApi } from '../../../api/workouts';
import type { Workout } from '../../../types';
import { todayLocalDate } from '../../date';
import { isNetworkOnline } from '../../offline';
import { offlineReady } from '../../offlineBoot';
import { EntityCache } from '../entityStore';
import { hasPendingMutationsFor } from './shared';

const PULL_TIMEOUT_MS = 10_000;
const ROUTE_PREFIX = '/workouts';

/** Mesma janela da nutrição, pelo mesmo motivo: substituí-la inteira a cada
 * pull faz deleção funcionar sem tombstone — e o backend não tem nenhum. */
export const WORKOUTS_WINDOW_DAYS = 60;

export const workoutsCache = new EntityCache<Workout>('workouts');

function daysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  // Componentes locais, nunca toISOString sobre meia-noite local — em UTC-3
  // isso devolve o dia anterior.
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function listWorkouts(): Workout[] {
  return workoutsCache.getAll();
}

export function listByDate(date: string): Workout[] {
  return workoutsCache.getAll().filter((workout) => String(workout.date).slice(0, 10) === date);
}

export function listByRange(from: string, to: string): Workout[] {
  return workoutsCache
    .getAll()
    .filter((workout) => {
      const day = String(workout.date).slice(0, 10);
      return day >= from && day <= to;
    })
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

// Espera `offlineReady` para não correr com a rehidratação do `useOfflineStore`
// sobre o mesmo banco — mesma razão descrita em `repo/foodLogs.ts`.
void offlineReady.then(() => workoutsCache.ensureLoaded());

/**
 * Substitui a janela inteira. É o que faz um treino apagado em outro aparelho
 * sumir daqui sem o backend precisar de tombstone. Registros fora da janela
 * ficam como histórico congelado — nunca são apagados localmente.
 *
 * Não roda com escrita de treino pendente na fila: a cópia do servidor estaria
 * atrás da do aparelho, e sobrescrever apagaria da tela o treino que a pessoa
 * acabou de fazer offline.
 */
export async function pullWorkouts(windowDays = WORKOUTS_WINDOW_DAYS): Promise<void> {
  if (!isNetworkOnline()) return;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  if (hasPendingMutationsFor(ROUTE_PREFIX)) return;

  const from = daysAgo(windowDays);
  const to = todayLocalDate();

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
  const timeoutId = controller ? setTimeout(() => controller.abort(), PULL_TIMEOUT_MS) : undefined;
  try {
    const workouts = await workoutsApi.listRange(from, to, controller?.signal);
    await workoutsCache.replaceWindow(workouts, (workout) => {
      const day = String(workout.date).slice(0, 10);
      return day >= from && day <= to;
    });
  } catch {
    // Best-effort: o próximo tick agendado tenta de novo.
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}
