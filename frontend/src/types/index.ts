export interface User {
  id: number;
  email: string;
  name: string;
  avatar_url?: string;
  google_id?: string;
  apple_id?: string;
  /** Falso para contas criadas só com Google/Apple. Ausente = assume que tem. */
  has_password?: boolean;
  created_at: string;
}

/** Um lugar onde a pessoa treina, com os aparelhos disponíveis ali. */
export interface Gym {
  id: number;
  name: string;
  notes: string;
  equipment: string[];
  created_at: string;
}

export interface GymInput {
  name: string;
  notes: string;
  /** Substitui a lista inteira no servidor — não há PATCH incremental. */
  equipment: string[];
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
  video?: ExerciseVideo;
  /**
   * 'not_found' só quando o servidor já decidiu que o catálogo não tem este
   * exercício (recusa gravada). Ausente = ainda não associado: NÃO é "não
   * localizado".
   */
  video_status?: 'not_found';
  /** Ilustração gerada por IA já pronta para este nome. */
  illustration?: { status: 'ready' | 'outdated'; frames?: number };
  /**
   * Presente só na sessão ativa, e só quando o exercício foi trocado com
   * "Trocar só hoje": o nome original, para a tela explicar a troca sem a
   * pessoa achar que o plano mudou sozinho. `id` continua o do exercício do
   * plano — é o que o app usa para registrar série.
   */
  substituted_from?: string;
}

/**
 * Apontamento para o vídeo demonstrativo do exercício no bucket.
 *
 * Ausente quando não há vídeo — o nome que o assistente escreveu não existe no
 * catálogo, ou o vínculo ainda não foi resolvido. A tela trata os dois casos
 * igual: mostra o exercício sem vídeo.
 *
 * `catalog_name` costuma ser diferente de `exercise_name`: são vocabulários
 * distintos, e é justamente por isso que existe a tabela de vínculo no
 * servidor. Aqui ele serve como chave do arquivo local.
 */
export interface ExerciseVideo {
  catalog_name: string;
  webm: string;
  mp4: string;
}

export interface TrainingPlanDay {
  id?: number;
  day_number?: number;
  name: string;
  focus: string;
  instructions: string;
  last_done_at?: string;
  /** Só em dia de plano dinâmico: a data para a qual aquele dia foi gerado. */
  generated_for?: string;
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
  /**
   * "compensation" is a cheat-day plan: a separate row, never the real plan.
   * "dynamic" não tem dias fixos: cada um é gerado sob demanda, um de cada vez.
   */
  kind?: 'regular' | 'compensation' | 'dynamic';
  expires_at?: string;
  /** Presente quando o plano foi encerrado (fechado manualmente após a data-alvo). `null`/ausente enquanto ativo. */
  archived_at?: string | null;
  gym_id?: number | null;
  gym_name?: string | null;
  /** Preferências usadas na criação automática/dinâmica; ausente num plano manual. */
  preferences?: string;
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
  gym_id?: number;
}

export interface AutomaticTrainingPlanInput {
  name: string;
  target_date: string;
  days_per_week: number;
  session_duration_minutes: number;
  preferences: string;
  gym_id?: number;
}

/** Sem `days`: a criação é instantânea, e cada dia nasce depois, sob demanda (`POST /training-plans/:id/dynamic-day`). */
export interface DynamicTrainingPlanInput {
  name: string;
  target_date: string;
  days_per_week: number;
  session_duration_minutes: number;
  preferences: string;
  gym_id?: number;
}

export interface TrainingPlanJob {
  id: number;
  status: 'pending' | 'done' | 'failed';
  plan_id?: number;
  /** Preenchido quando o job é a geração de um dia dinâmico, para navegar direto até ele. */
  plan_day_id?: number;
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
  /**
   * `assistant` é o registro que nasceu da conversa do modo IA (migration 026).
   * `routine` é a confirmação de um dia normal destilado do histórico
   * (migration 031) — estimativa, não medição item a item.
   */
  origin: 'manual' | 'plan' | 'photo_plate' | 'photo_label' | 'cheat_day' | 'assistant' | 'routine';
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
  exercises: NextWorkoutExercise[];
  total_sets: number;
  session_duration_minutes?: number;
}

export interface NextWorkoutExercise {
  name: string;
  sets: number;
  reps: number;
  tracking_type: string;
  duration_seconds?: number;
  last_weight_kg?: number;
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

// quantity_g/meal_type stay required; the rest are optional so the server
// can tell "not sent" (rescale macros by quantity, keep the catalog link)
// apart from "sent" (use as typed, detach from the catalog) — see
// UpdateFoodLogRequest on the backend. EditFoodLogModal always sends all of
// them, since it edits every field at once.
export interface UpdateFoodLogInput {
  quantity_g: number;
  meal_type: MealType;
  food_name?: string;
  calories?: number;
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
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

export interface WorkoutChatMessage {
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

/**
 * Proposta de troca de exercício que o chat pode devolver junto da resposta —
 * só quando a pessoa pediu para trocar ou disse que não consegue fazer o
 * exercício. Nada muda no treino sozinho: a tela mostra um cartão com
 * "Trocar só hoje" / "Trocar no plano", e só aplica depois da confirmação via
 * `workoutsApi.substitute`.
 */
export interface WorkoutChatSubstitution {
  training_plan_exercise_id: number;
  new_name: string;
  sets: number;
  reps: number;
  tracking_type: 'reps' | 'time';
  duration_seconds?: number | null;
  rest_seconds: number;
  notes: string;
  /** Frase curta explicando por que esse substituto serve — mostrada no cartão. */
  reason: string;
}

/** Corpo de POST /workouts/{id}/substitutions. */
export interface WorkoutSubstitutionInput {
  training_plan_exercise_id: number;
  new_name: string;
  sets: number;
  reps: number;
  tracking_type: 'reps' | 'time';
  duration_seconds?: number | null;
  rest_seconds: number;
  notes: string;
  /** "session" só vale para este treino; "plan" reescreve o exercício do plano. */
  scope: 'session' | 'plan';
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

/**
 * Avaliação do resultado: a leitura do período contra o objetivo e, quando o
 * histórico justifica, a alteração de plano já pronta esperando confirmação.
 * Nada é escrito até a pessoa confirmar.
 */
export interface ProgressReview {
  id: number;
  /** `pending` é a análise rodando — a mesma linha é o job. */
  status: 'pending' | 'ready' | 'applied' | 'discarded' | 'failed';
  period_start: string;
  period_end: string;
  performance: string;
  goal_assessment: string;
  goal_status: 'on_track' | 'needs_change' | 'at_risk';
  /** Ausente quando não há o que mudar naquele plano — o caso comum. */
  training_change?: ProgressReviewTrainingChange;
  nutrition_change?: ProgressReviewNutritionChange;
  /**
   * Preenchido quando o assistente disse que aquele plano tinha que mudar e a
   * reescrita não saiu. Sem isso a tela não distingue "não há o que mudar" de
   * "havia o que mudar e falhou" — e afirmava que estava tudo bem nos dois.
   */
  training_proposal_error?: string;
  nutrition_proposal_error?: string;
  applied_training: boolean;
  applied_nutrition: boolean;
  error?: string;
  created_at: string;
  applied_at?: string;
}

export interface ProgressReviewTrainingChange {
  plan_id: number;
  plan_name: string;
  summary: string;
  /** O plano que será gravado se confirmado, e `current_plan` o que ele substitui. */
  plan: ProposedTrainingPlan;
  current_plan: ProposedTrainingPlan;
}

export interface ProgressReviewNutritionChange {
  plan_id: number;
  plan_name: string;
  summary: string;
  plan: ProposedNutritionPlan;
  current_plan: ProposedNutritionPlan;
}

// Os tipos abaixo espelham TrainingPlanInput/NutritionPlanInput do backend, que
// são as formas SEM id — uma proposta ainda não existe no banco. Por isso não
// dá para reaproveitar TrainingPlan/NutritionPlan aqui.
export interface ProposedTrainingPlan {
  name: string;
  description: string;
  target_date: string;
  days_per_week: number;
  session_duration_minutes: number;
  /** `null` quando o plano veio sem dias: slice nil em Go serializa assim, não como []. */
  days: ProposedTrainingDay[] | null;
}

export interface ProposedTrainingDay {
  name: string;
  focus: string;
  instructions: string;
  exercises: ProposedTrainingExercise[] | null;
}

export interface ProposedTrainingExercise {
  exercise_name: string;
  sets: number;
  reps: number;
  tracking_type: 'reps' | 'time';
  duration_seconds?: number | null;
  rest_seconds: number;
  notes: string;
}

export interface ProposedNutritionPlan {
  name: string;
  calories_target: number;
  protein_target: number;
  carbs_target: number;
  fat_target: number;
  rationale: string;
  /** `null` num plano manual, que não tem cardápio nenhum. */
  meals: ProposedNutritionMeal[] | null;
}

export interface ProposedNutritionMeal {
  meal_type: MealType;
  name: string;
  suggested_at?: string | null;
  notes: string;
  items: ProposedNutritionMealItem[] | null;
}

export interface ProposedNutritionMealItem {
  food_name: string;
  quantity_g: number;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

export interface ApplyProgressReviewInput {
  apply_training: boolean;
  apply_nutrition: boolean;
}

export interface ProgressReviewMessage {
  id: number;
  review_id: number;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

export interface ProgressReviewChatResponse {
  user_message: ProgressReviewMessage;
  message: ProgressReviewMessage;
}

/**
 * Um turno do modo IA de registrar refeição. `entries` só vem com
 * `complete: true`, e nada foi gravado: a lista vai para conferência e é a
 * pessoa que manda registrar — mesma regra da estimativa por foto.
 */
export interface NutritionLogDraft {
  reply: string;
  complete: boolean;
  entries: NutritionLogDraftEntry[];
}

export interface NutritionLogDraftEntry {
  food_name: string;
  quantity_g: number;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  meal_type: MealType;
  /** AAAA-MM-DD, resolvida pelo assistente a partir de "ontem à noite" e afins. */
  date: string;
}

export interface NutritionLogAssistantMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * "Dia normal" destilado do histórico, sem IA — mesma entrada, mesma saída
 * sempre (ver `backend/internal/services/nutrition_routine.go`). `enough`
 * falso significa que ainda não há rotina para propor; `meals` vem vazio
 * nesse caso.
 */
export interface NutritionRoutine {
  enough: boolean;
  based_on_days: number;
  meals: NutritionRoutineMeal[];
  totals: NutritionRoutineTotals;
}

export interface NutritionRoutineMeal {
  meal_type: MealType;
  items: NutritionRoutineItem[];
  calories: number;
}

export interface NutritionRoutineItem {
  food_item_id?: number;
  food_name: string;
  quantity_g: number;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  days_seen: number;
  days_considered: number;
}

export interface NutritionRoutineTotals {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

/** GET /api/nutrition/missing-days: os últimos 30 dias de calendário sem nenhum food_log. */
export interface MissingDaysResponse {
  days: string[];
}
