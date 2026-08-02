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
  tracking_type: 'reps' | 'time';
  duration_seconds?: number;
  weight_kg: number;
  training_plan_exercise_id?: number;
  set_number?: number;
  completed_at?: string;
  created_at: string;
}

export interface Workout {
  id: number;
  user_id: number;
  name: string;
  date: string;
  notes?: string;
  training_plan_day_id?: number;
  duration_minutes?: number;
  status: 'in_progress' | 'completed';
  started_at?: string;
  finished_at?: string;
  /**
   * Identity minted by the app when the session was started. The server dedupes
   * `POST /workouts/start` on it, which is what makes a start queued offline safe
   * to replay (and safe to retry after a timeout).
   */
  client_session_id?: string;
  sets?: WorkoutSet[];
  set_count?: number;
  created_at: string;
}

export interface WorkoutSetInput {
  exercise_name: string;
  sets: number;
  reps: number;
  tracking_type?: 'reps' | 'time';
  duration_seconds?: number;
  weight_kg: number;
}

export interface CreateWorkoutInput {
  name: string;
  date: string;
  notes?: string;
  training_plan_day_id?: number;
  duration_minutes?: number;
  sets?: WorkoutSetInput[];
}

export interface TrainingPlanExercise {
  id?: number;
  exercise_name: string;
  sets: number;
  reps: number;
  tracking_type: 'reps' | 'time';
  duration_seconds?: number;
  rest_seconds: number;
  notes: string;
  last_weight_kg?: number;
}

export interface TrainingPlanDay {
  id?: number;
  day_number?: number;
  name: string;
  focus: string;
  instructions: string;
  last_done_at?: string;
  exercises: TrainingPlanExercise[];
}

export interface TrainingPlan {
  id: number;
  name: string;
  description: string;
  target_date: string;
  days_per_week: number;
  session_duration_minutes: number;
  creation_method: 'manual' | 'automatic';
  adaptation_phase: boolean;
  active: boolean;
  /** "compensation" is a cheat-day plan: a separate row, never the real plan. */
  kind?: 'regular' | 'compensation';
  expires_at?: string;
  days?: TrainingPlanDay[];
  created_at: string;
}

export interface TrainingPlanInput {
  name: string;
  description: string;
  target_date: string;
  days_per_week: number;
  session_duration_minutes: number;
  days: TrainingPlanDay[];
}

export interface AutomaticTrainingPlanInput {
  name: string;
  target_date: string;
  days_per_week: number;
  session_duration_minutes: number;
  preferences: string;
}

export interface TrainingPlanJob {
  id: number;
  status: 'pending' | 'done' | 'failed';
  plan_id?: number;
  error?: string;
  created_at: string;
}

export interface WorkoutStats {
  total_workouts: number;
  workouts_this_week: number;
  workouts_this_month: number;
  total_sets: number;
  total_volume_kg: number;
  streak_days: number;
}

export interface WorkoutCalendarDay {
  date: string;
  count: number;
}

export interface WorkoutCalendarData {
  month: string;
  days: WorkoutCalendarDay[];
}

/** user_id absent/null = shared catalog; present = a personal food. */
export interface FoodItem {
  id: number;
  user_id?: number | null;
  name: string;
  brand?: string;
  calories_per_100g: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
  sodium_mg: number;
  serving_label?: string;
  serving_grams?: number;
  source?: string;
  archived: boolean;
  cover_photo_id?: number;
  created_at: string;
}

export interface NutritionPlanMealItem {
  id: number;
  item_order: number;
  food_item_id?: number;
  food_name: string;
  quantity_g: number;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

export interface NutritionPlanMeal {
  id: number;
  meal_order: number;
  meal_type: MealType;
  name: string;
  suggested_at?: string; // "HH:MM"
  notes?: string;
  items: NutritionPlanMealItem[];
}

export interface NutritionPlan {
  id: number;
  user_id: number;
  name: string;
  calories_target: number;
  protein_target: number;
  carbs_target: number;
  fat_target: number;
  rationale?: string;
  creation_method: 'manual' | 'automatic';
  training_plan_id?: number;
  active: boolean;
  meals?: NutritionPlanMeal[];
  created_at: string;
}

export interface NutritionPlanJob {
  id: number;
  kind: 'generate' | 'adjust';
  status: 'pending' | 'done' | 'failed';
  plan_id?: number;
  error?: string;
  created_at: string;
}

export interface FoodLog {
  id: number;
  user_id: number;
  food_item_id?: number;
  food_item?: FoodItem;
  food_name: string;
  meal_type: MealType;
  quantity_g: number;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  origin: 'manual' | 'plan' | 'photo_plate' | 'photo_label' | 'cheat_day';
  client_log_id?: string;
  photo_id?: number;
  date: string;
  created_at: string;
  updated_at: string;
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

export interface NutritionCalendarDay {
  date: string;
  calories: number;
}

export interface NutritionCalendarData {
  month: string;
  days: NutritionCalendarDay[];
}

export interface NextWorkout {
  plan_id: number;
  plan_name: string;
  day_id: number;
  day_name: string;
  focus: string;
  last_done_at?: string;
}

export interface WeeklyPerformance {
  plan_name: string;
  target_per_week: number;
  done_this_week: number;
  remaining: number;
  days_left_in_week: number;
  on_track: boolean;
  still_possible: boolean;
}

export interface DashboardData {
  user: User;
  today_workout?: Workout;
  workout_stats: WorkoutStats;
  today_nutrition: NutritionSummary;
  active_plan?: NutritionPlan;
  today_steps?: Steps;
  weekly_workouts: Workout[];
  next_workout?: NextWorkout;
  days_since_last_workout?: number;
  weekly_performance?: WeeklyPerformance;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export type BiologicalSex = 'female' | 'male';
export type TrainingExperience = 'beginner' | 'experienced';

export interface UserProfile {
  birth_date: string;
  age: number;
  height_cm: number;
  current_weight_kg: number;
  biological_sex?: BiologicalSex;
  injuries_or_limitations?: string;
  training_experience?: TrainingExperience;
  adaptation_ends_at?: string;
}

export interface OnboardingMessage {
  role: 'user' | 'assistant';
  content: string;
  action?: 'six_minute_walk' | 'confirm_unrealistic_goal';
  created_at: string;
}

export interface UserGoal {
  goal_type: 'lose_weight' | 'gain_muscle' | 'recomposition' | 'maintain' | 'other';
  target_weight_kg?: number;
  target_body_fat_percentage?: number;
  target_muscle_mass_kg?: number;
  target_six_minute_walk_meters?: number;
  conditioning_focus: boolean;
  target_date?: string;
  feasibility: 'realistic' | 'challenging' | 'unrealistic';
  feasibility_warning?: string;
  summary: string;
}

export interface OnboardingState {
  profile?: UserProfile;
  messages: OnboardingMessage[];
  goal?: UserGoal;
  fitness_assessment?: FitnessAssessment;
  completed: boolean;
}

export interface FitnessAssessment {
  distance_meters: number;
  average_heart_rate?: number;
  post_heart_rate?: number;
  perceived_exertion: number;
  performed_at: string;
}

export interface SaveFitnessAssessmentInput {
  distance_meters: number;
  average_heart_rate: number | null;
  post_heart_rate: number | null;
  perceived_exertion: number;
}

export interface SaveProfileInput {
  birth_date: string;
  height_cm: number;
  current_weight_kg: number;
  biological_sex: BiologicalSex | null;
  injuries_or_limitations: string | null;
  training_experience: TrainingExperience;
}

export interface ObjectiveMessageResponse {
  message: OnboardingMessage;
  goal?: UserGoal;
  completed: boolean;
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

export interface AutomaticNutritionPlanInput {
  preferences: string;
}

export interface CreateFoodLogInput {
  food_item_id?: number;
  food_name?: string;
  quantity_g: number;
  meal_type: MealType;
  date?: string;
  origin?: FoodLog['origin'];
  photo_id?: number;
  calories?: number;
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
  /** Idempotency key; the API layer fills it in. */
  client_log_id?: string;
}

export interface UpdateFoodLogInput {
  quantity_g: number;
  meal_type: MealType;
}

export interface CreateFoodItemInput {
  name: string;
  brand?: string;
  calories_per_100g: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g?: number;
  sodium_mg?: number;
  serving_label?: string;
  serving_grams?: number;
  photo_id?: number;
}

export interface PlateAnalysisItem {
  food_name: string;
  estimated_grams: number;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

export interface PlateAnalysis {
  items: PlateAnalysisItem[];
  confidence: 'high' | 'medium' | 'low';
  caveat: string;
}

export interface LabelAnalysis {
  name: string;
  brand: string;
  serving_label: string;
  serving_grams: number;
  calories_per_100g: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
  sodium_mg: number;
}

export interface PhotoUploadResponse<T> {
  photo_id: number;
  kind: 'plate' | 'label';
  analysis: T;
}

export interface NutritionSuggestion {
  remaining_calories: number;
  remaining_protein_g: number;
  remaining_carbs_g: number;
  remaining_fat_g: number;
  suggestions: string[];
}

export interface CheatDayMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

export interface CheatDaySession {
  id: number;
  status: 'open' | 'accepted' | 'discarded';
  happens_on: string;
  estimated_calories?: number;
  summary?: string;
  compensation_plan_id?: number;
  messages: CheatDayMessage[];
  created_at: string;
}

export interface SyncStepsInput {
  date: string;
  count: number;
  calories_burned: number;
  source: string;
}

/**
 * One consolidated row for the "+ Log" screen: something already registered
 * (times_logged reflects the last 90 days), or a favorite whose log history
 * was since deleted (times_logged 0, last_logged_at absent). Everything here
 * — quantity_g, meal_type, macros — is the default the row opens the log form
 * with, taken from the most recent registration of this group_key.
 */
export interface FoodLogHistoryEntry {
  group_key: string;
  food_item_id?: number;
  food_name: string;
  quantity_g: number;
  meal_type: MealType;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  times_logged: number;
  last_logged_at?: string;
  favorite_id?: number;
}

export interface UpsertNutritionFavoriteInput {
  group_key: string;
  food_item_id?: number;
  food_name: string;
  quantity_g: number;
  meal_type: MealType;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

export interface NutritionFavorite {
  id: number;
  user_id: number;
  group_key: string;
  food_item_id?: number;
  food_name: string;
  quantity_g: number;
  meal_type: MealType;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  created_at: string;
  updated_at: string;
}

export const MEAL_TYPE_LABELS: Record<MealType, string> = {
  breakfast: 'Café da manhã',
  lunch: 'Almoço',
  dinner: 'Jantar',
  snack: 'Lanche',
};

export interface ActiveWorkout {
  workout: Workout;
  plan_id?: number;
  day_name: string;
  exercises: TrainingPlanExercise[];
}

export interface CompleteSetInput {
  training_plan_exercise_id?: number;
  exercise_name: string;
  set_number: number;
  reps: number;
  weight_kg: number;
  tracking_type: 'reps' | 'time';
  duration_seconds?: number;
  /** Idempotency key; the API layer fills it in. */
  client_set_id?: string;
}

export interface TrainingSettings {
  countdown_seconds: number;
  vibration_enabled: boolean;
  auto_advance: boolean;
}

export interface CompleteWorkoutExercise {
  training_plan_exercise_id: number;
  sets_done: number;
  weight_kg: number;
}

export interface CompleteWorkoutInput {
  notes?: string;
  exercises: CompleteWorkoutExercise[];
}

export interface BodyMeasurement {
  id: number;
  measured_at: string;
  weight_kg?: number;
  body_fat_percentage?: number;
  muscle_mass_kg?: number;
  waist_cm?: number;
  hip_cm?: number;
  arm_cm?: number;
  thigh_cm?: number;
  chest_cm?: number;
  notes: string;
  created_at: string;
}

export type MeasurementField = Exclude<keyof BodyMeasurement, 'id' | 'measured_at' | 'notes' | 'created_at'>;

export interface MetricPoint {
  date: string;
  value: number;
}

export interface MetricSeries {
  key: string;
  label: string;
  unit: string;
  target?: number;
  points: MetricPoint[];
}

export interface ResultsData {
  measurements: BodyMeasurement[];
  series: MetricSeries[];
  conditioning: FitnessAssessment[];
}

export interface TermsStatus {
  current_version: string;
  accepted: boolean;
  accepted_at?: string;
}

/**
 * Provider ids are kept as plain strings instead of a union: the backend owns the
 * list and may add providers without a frontend release. KNOWN_LLM_PROVIDERS below
 * is only used to render friendly labels/model hints for the ones we know about.
 */
export type LlmSubscriptionStatus = 'free' | 'active' | 'cancelled';

export interface LlmSettings {
  provider: string;
  model: string;
  configured: boolean;
  key_preview: string;
  subscription_status: LlmSubscriptionStatus;
  using_shared_credits: boolean;
}

export interface LlmSettingsInput {
  provider: string;
  model: string;
  /** Empty string removes the stored key and falls back to the shared credits. */
  api_key: string;
}

export interface SubscriptionMockInput {
  action: 'subscribe' | 'cancel';
}

export interface WorkoutChatMessage {
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

export interface SaveBodyMeasurementInput {
  measured_at: string;
  weight_kg?: number | null;
  body_fat_percentage?: number | null;
  muscle_mass_kg?: number | null;
  waist_cm?: number | null;
  hip_cm?: number | null;
  arm_cm?: number | null;
  thigh_cm?: number | null;
  chest_cm?: number | null;
  notes?: string;
}
