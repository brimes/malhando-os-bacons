import { describe, expect, it } from 'vitest';
import { nutritionDiffLines, trainingDiffLines } from '../planDiff';
import type { ProposedNutritionPlan, ProposedTrainingPlan } from '../../types';

/**
 * O caso que quebrou a tela inteira em produção: o plano nutricional criado
 * pelo caminho manual não tem cardápio, e `Meals` é slice nil em Go — que
 * serializa como `null`, não como `[]`. O diff chamava `.map` direto e o
 * ErrorBoundary tomava o lugar da análise.
 */
const planoNutricionalManual = {
  name: 'Recomposição',
  calories_target: 2450,
  protein_target: 175,
  carbs_target: 250,
  fat_target: 75,
  rationale: '',
  meals: null,
} as unknown as ProposedNutritionPlan;

const planoNutricionalProposto: ProposedNutritionPlan = {
  name: 'Recomposição',
  calories_target: 2300,
  protein_target: 185,
  carbs_target: 230,
  fat_target: 70,
  rationale: '',
  meals: [
    {
      meal_type: 'breakfast',
      name: 'Café da manhã',
      suggested_at: '07:00',
      notes: '',
      items: [{ food_name: 'Ovos', quantity_g: 150, calories: 220, protein_g: 19, carbs_g: 2, fat_g: 15 }],
    },
  ],
};

describe('nutritionDiffLines', () => {
  it('não quebra quando o plano atual veio sem cardápio (meals null)', () => {
    const lines = nutritionDiffLines(planoNutricionalManual, planoNutricionalProposto);
    expect(lines.some((l) => l.text.includes('2450kcal → 2300kcal'))).toBe(true);
    expect(lines.some((l) => l.kind === 'added' && l.text.includes('Café da manhã'))).toBe(true);
  });

  it('não quebra quando os dois lados vêm sem cardápio', () => {
    expect(() => nutritionDiffLines(planoNutricionalManual, planoNutricionalManual)).not.toThrow();
  });
});

const planoTreino = (days: unknown): ProposedTrainingPlan => ({
  name: 'Projeto Outubro',
  description: '',
  target_date: '2026-10-23',
  days_per_week: 4,
  session_duration_minutes: 55,
  days,
} as unknown as ProposedTrainingPlan);

describe('trainingDiffLines', () => {
  it('não quebra com days null dos dois lados', () => {
    expect(() => trainingDiffLines(planoTreino(null), planoTreino(null))).not.toThrow();
  });

  it('não quebra quando um dia vem sem exercícios', () => {
    const atual = planoTreino(null);
    const proposto = planoTreino([{ name: 'Treino A', focus: '', instructions: '', exercises: null }]);
    const lines = trainingDiffLines(atual, proposto);
    expect(lines.some((l) => l.text.includes('Novo dia: Treino A (0 exercícios)'))).toBe(true);
  });
});
