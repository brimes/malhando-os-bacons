import { describe, expect, it } from 'vitest';
import { computePlanWeekProgress, countWeekSessions, resolveWeekDone } from '../planProgress';
import type { TrainingPlan, Workout } from '../../types';

// Sexta-feira, 13/11/2026, meio-dia local: a semana corrente começa na segunda, 09/11.
const NOW = new Date(2026, 10, 13, 12, 0, 0);
const at = (day: number, hour = 9) => new Date(2026, 10, day, hour, 0, 0).toISOString();

const workout = (id: number, date: string, dayId?: number, status: Workout['status'] = 'completed'): Workout => ({
  id, user_id: 1, name: `w${id}`, date, status, training_plan_day_id: dayId, created_at: date,
});

const plan = {
  id: 1, name: 'p', days_per_week: 4, active: true, kind: 'regular',
  days: [{ id: 11, name: 'A', day_number: 1 }, { id: 12, name: 'B', day_number: 2 }],
} as unknown as TrainingPlan;

describe('treinos da semana', () => {
  it('conta treino livre e de dia repetido, não só o dia "esperado" do plano', () => {
    const history = [workout(1, at(13), undefined), workout(2, at(12), 12), workout(3, at(11), 12)];
    expect(countWeekSessions(history, [], NOW)).toBe(3);
    const progress = computePlanWeekProgress({ plan, workouts: history, now: NOW });
    expect(progress.done).toBe(3);
    expect(progress.target).toBe(4);
  });

  it('ignora treino da semana passada e treino não concluído', () => {
    const history = [workout(1, at(8)), workout(2, at(13), 11, 'in_progress'), workout(3, at(9, 0))];
    expect(countWeekSessions(history, [], NOW)).toBe(1);
  });

  it('segunda-feira de madrugada já é a semana corrente', () => {
    expect(countWeekSessions([workout(1, new Date(2026, 10, 9, 0, 30).toISOString())], [], NOW)).toBe(1);
  });

  it('conta a fila do aparelho', () => {
    const pending = [{ trainingPlanDayId: 11, completedAt: NOW.getTime() - 1000 }];
    expect(countWeekSessions([workout(1, at(12))], pending, NOW)).toBe(2);
  });
});

describe('resolveWeekDone: Início e Treinos usam a mesma conta', () => {
  it('sem número do servidor vale o local', () => {
    expect(resolveWeekDone({ serverDone: null, localDone: 2, pendingThisWeek: 0 })).toBe(2);
  });

  it('histórico local atrasado (0) não esconde o que o servidor já confirmou: 3, não 0', () => {
    expect(resolveWeekDone({ serverDone: 3, localDone: 0, pendingThisWeek: 0 })).toBe(3);
  });

  it('soma a fila ao servidor sem contá-la duas vezes quando o local já a tem', () => {
    expect(resolveWeekDone({ serverDone: 3, localDone: 4, pendingThisWeek: 1 })).toBe(4);
    expect(resolveWeekDone({ serverDone: 3, localDone: 0, pendingThisWeek: 1 })).toBe(4);
  });

  it('o cartão de Treinos reflete o número do servidor mesmo com o histórico vazio', () => {
    const progress = computePlanWeekProgress({ plan, workouts: [], serverDone: 3, now: NOW });
    expect(progress.done).toBe(3);
    expect(progress.remaining).toBe(1);
    expect(progress.onTrack).toBe(false);
  });
});
