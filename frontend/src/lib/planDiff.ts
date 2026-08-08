import type {
  ProposedNutritionMeal,
  ProposedNutritionPlan,
  ProposedTrainingExercise,
  ProposedTrainingPlan,
} from '../types';

/**
 * Uma linha do "o que muda". `kind` só existe para colorir: verde entra,
 * vermelho sai, âmbar muda.
 */
export interface DiffLine {
  kind: 'added' | 'removed' | 'changed';
  text: string;
}

/**
 * O diff é por NOME, não por posição. O assistente devolve o plano inteiro
 * reescrito e pode reordenar exercícios sem que nada tenha mudado de verdade;
 * comparar posição a posição transformaria uma troca de ordem numa lista de
 * alterações que a pessoa lê e não reconhece.
 */
export function trainingDiffLines(current: ProposedTrainingPlan, proposed: ProposedTrainingPlan): DiffLine[] {
  const lines: DiffLine[] = [];
  const dayCount = Math.max(current.days.length, proposed.days.length);

  for (let index = 0; index < dayCount; index += 1) {
    const before = current.days[index];
    const after = proposed.days[index];
    const label = after?.name ?? before?.name ?? `Dia ${index + 1}`;

    if (!before) {
      lines.push({ kind: 'added', text: `Novo dia: ${label} (${after.exercises.length} exercícios)` });
      continue;
    }
    if (!after) {
      lines.push({ kind: 'removed', text: `Dia removido: ${before.name}` });
      continue;
    }
    if (before.name !== after.name) {
      lines.push({ kind: 'changed', text: `${before.name} passa a se chamar ${after.name}` });
    }

    const beforeByName = new Map(before.exercises.map((exercise) => [exercise.exercise_name, exercise]));
    const afterByName = new Map(after.exercises.map((exercise) => [exercise.exercise_name, exercise]));

    for (const exercise of after.exercises) {
      const previous = beforeByName.get(exercise.exercise_name);
      if (!previous) {
        lines.push({ kind: 'added', text: `${label}: entra ${exercise.exercise_name} (${volumeOf(exercise)})` });
        continue;
      }
      if (volumeOf(previous) !== volumeOf(exercise)) {
        lines.push({
          kind: 'changed',
          text: `${label}: ${exercise.exercise_name} ${volumeOf(previous)} → ${volumeOf(exercise)}`,
        });
      }
    }
    for (const exercise of before.exercises) {
      if (!afterByName.has(exercise.exercise_name)) {
        lines.push({ kind: 'removed', text: `${label}: sai ${exercise.exercise_name}` });
      }
    }
  }
  return withDetailFallback(lines, current, proposed);
}

/**
 * A lista acima só enxerga o que dá para nomear: dias, exercícios e volume. Um
 * plano pode voltar do assistente com descanso, observação ou instrução
 * diferente e produzir zero linhas — e aí `lines.length === 0` mentiria dizendo
 * que nada muda. A comparação bruta fecha esse buraco: se o JSON difere e nada
 * foi nomeado, é ajuste de detalhe, e a tela precisa saber que existe.
 *
 * Nenhuma linha com o JSON idêntico é a resposta certa: o assistente reescreveu
 * o plano igual, então não há o que confirmar.
 */
function withDetailFallback<T>(lines: DiffLine[], current: T, proposed: T): DiffLine[] {
  if (lines.length > 0 || JSON.stringify(current) === JSON.stringify(proposed)) return lines;
  return [{ kind: 'changed', text: 'Ajustes de detalhe (descanso, observações ou instruções)' }];
}

/** "3x12" para carga, "3x45s" para exercício por tempo. */
export function volumeOf(exercise: ProposedTrainingExercise): string {
  if (exercise.tracking_type === 'time' && exercise.duration_seconds) {
    return `${exercise.sets}x${exercise.duration_seconds}s`;
  }
  return `${exercise.sets}x${exercise.reps}`;
}

export function nutritionDiffLines(current: ProposedNutritionPlan, proposed: ProposedNutritionPlan): DiffLine[] {
  const lines: DiffLine[] = [];
  pushTargetDiff(lines, 'Calorias', current.calories_target, proposed.calories_target, 'kcal');
  pushTargetDiff(lines, 'Proteína', current.protein_target, proposed.protein_target, 'g');
  pushTargetDiff(lines, 'Carboidrato', current.carbs_target, proposed.carbs_target, 'g');
  pushTargetDiff(lines, 'Gordura', current.fat_target, proposed.fat_target, 'g');

  const beforeMeals = new Map(current.meals.map((meal) => [meal.name, meal]));
  const afterMeals = new Map(proposed.meals.map((meal) => [meal.name, meal]));

  for (const meal of proposed.meals) {
    const previous = beforeMeals.get(meal.name);
    if (!previous) {
      lines.push({ kind: 'added', text: `Nova refeição: ${meal.name} (${caloriesOf(meal)} kcal)` });
      continue;
    }
    const beforeItems = new Map(previous.items.map((item) => [item.food_name, item]));
    const afterItems = new Map(meal.items.map((item) => [item.food_name, item]));
    for (const item of meal.items) {
      const before = beforeItems.get(item.food_name);
      if (!before) {
        lines.push({ kind: 'added', text: `${meal.name}: entra ${item.food_name} (${round(item.quantity_g)}g)` });
      } else if (round(before.quantity_g) !== round(item.quantity_g)) {
        lines.push({
          kind: 'changed',
          text: `${meal.name}: ${item.food_name} ${round(before.quantity_g)}g → ${round(item.quantity_g)}g`,
        });
      }
    }
    for (const item of previous.items) {
      if (!afterItems.has(item.food_name)) {
        lines.push({ kind: 'removed', text: `${meal.name}: sai ${item.food_name}` });
      }
    }
  }
  for (const meal of current.meals) {
    if (!afterMeals.has(meal.name)) {
      lines.push({ kind: 'removed', text: `Refeição removida: ${meal.name}` });
    }
  }
  return withDetailFallback(lines, current, proposed);
}

function pushTargetDiff(lines: DiffLine[], label: string, before: number, after: number, unit: string) {
  if (round(before) === round(after)) return;
  const delta = after - before;
  lines.push({
    kind: 'changed',
    text: `${label}: ${round(before)}${unit} → ${round(after)}${unit} (${delta > 0 ? '+' : ''}${round(delta)}${unit})`,
  });
}

function caloriesOf(meal: ProposedNutritionMeal): number {
  return round(meal.items.reduce((total, item) => total + item.calories, 0));
}

function round(value: number): number {
  return Math.round(value);
}
