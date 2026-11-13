import { useEffect, useMemo, useState } from 'react';
import { apiClient } from '../api/client';
import type { DashboardData } from '../types';
import { todayLocalDate } from './date';
import { pendingCompletedWorkouts, readCache, resourceKeyForRequest, useOfflineStore } from './offline';
import { useLocalAll } from './local/useLocal';
import { workoutsCache } from './local/repo/workouts';
import { countWeekSessions, resolveWeekDone, startOfWeek } from './planProgress';

/** O número da semana no `/dashboard`: o mesmo que o Início mostra. */
export function serverWeekDone(data: DashboardData | null | undefined): number | null {
  if (!data) return null;
  return data.weekly_performance?.done_this_week ?? data.workout_stats?.workouts_this_week ?? null;
}

/**
 * O número do servidor para telas que não carregam o `/dashboard` por conta
 * própria (Treinos). É a mesma requisição, chaveada por data, que o Início faz,
 * com o cache dela desenhando enquanto a rede não responde. `null` até saber.
 */
export function useServerWeekDone(): number | null {
  const [done, setDone] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    const params = { date: todayLocalDate() };
    setDone(serverWeekDone(readCache<DashboardData>(resourceKeyForRequest('/dashboard', params))));
    apiClient.get<DashboardData>('/dashboard', { params })
      .then((res) => { if (alive) setDone(serverWeekDone(res.data)); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, []);
  return done;
}

/** Treinos da semana pela definição única (`resolveWeekDone`), a partir do número do servidor. */
export function useWeekDone(serverDone: number | null): number {
  const history = useLocalAll(workoutsCache);
  const queue = useOfflineStore((state) => state.queue);
  return useMemo(() => {
    const pending = pendingCompletedWorkouts(queue);
    const weekStart = startOfWeek().getTime();
    return resolveWeekDone({
      serverDone,
      localDone: countWeekSessions(history, pending),
      pendingThisWeek: pending.filter((local) => local.completedAt >= weekStart).length,
    });
  }, [history, queue, serverDone]);
}
