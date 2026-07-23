export interface User {
  id: number;
  email: string;
  name: string;
  avatar_url?: string;
  google_id?: string;
  created_at: string;
}

export interface WorkoutSet {
  id: number;
  workout_id: number;
  exercise_name: string;
  sets: number;
  reps: number;
  weight_kg: number;
  created_at: string;
}

export interface Workout {
  id: number;
  user_id: number;
  name: string;
  date: string;
  notes?: string;
  sets?: WorkoutSet[];
  created_at: string;
}

export interface WorkoutSetInput {
  exercise_name: string;
  sets: number;
  reps: number;
  weight_kg: number;
}

export interface CreateWorkoutInput {
  name: string;
  date: string;
  notes?: string;
  sets?: WorkoutSetInput[];
}

export interface WorkoutStats {
  total_workouts: number;
  workouts_this_week: number;
  workouts_this_month: number;
  total_sets: number;
  total_volume_kg: number;
  streak_days: number;
}

export interface FoodItem {
  id: number;
  name: string;
  calories_per_100g: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  source?: string;
}

export interface NutritionPlan {
  id: number;
  user_id: number;
  name: string;
  calories_target: number;
  protein_target: number;
  carbs_target: number;
  fat_target: number;
  active: boolean;
}

export interface FoodLog {
  id: number;
  user_id: number;
  food_item_id: number;
  food_item?: FoodItem;
  meal_type: MealType;
  quantity_g: number;
  date: string;
  created_at: string;
  calories?: number;
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
}

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export interface Steps {
  id: number;
  user_id: number;
  date: string;
  count: number;
  calories_burned: number;
  source: string;
}

export interface NutritionSummary {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  logs?: FoodLog[];
}

export interface DashboardData {
  user: User;
  today_workout?: Workout;
  workout_stats: WorkoutStats;
  today_nutrition: NutritionSummary;
  active_plan?: NutritionPlan;
  today_steps?: Steps;
  weekly_workouts: Workout[];
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface ApiError {
  error: string;
}

export interface CreateNutritionPlanInput {
  name: string;
  calories_target: number;
  protein_target: number;
  carbs_target: number;
  fat_target: number;
}

export interface CreateFoodLogInput {
  food_item_id: number;
  meal_type: MealType;
  quantity_g: number;
  date?: string;
}

export interface SyncStepsInput {
  date: string;
  count: number;
  calories_burned: number;
  source: string;
}

export const MEAL_TYPE_LABELS: Record<MealType, string> = {
  breakfast: 'Café da manhã',
  lunch: 'Almoço',
  dinner: 'Jantar',
  snack: 'Lanche',
};
