import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/useAuthStore';
import { useOnboardingStore } from './stores/useOnboardingStore';
import { offlineReady } from './lib/offline';
import { useOfflineStore } from './lib/offlineStore';
// Side effect only: starts nutrition's local-first background sync (push/pull
// timers — see that module's own comment for why this is imported from here
// and not from `lib/offlineBoot.ts`).
import './lib/local/nutritionSync';
import { registerAndroidBackButton } from './lib/androidBackButton';
import { BottomNav } from './components/BottomNav';
import { ErrorBoundary } from './components/ErrorBoundary';
import { TermsGate } from './components/TermsGate';
import { DashboardPage } from './pages/Dashboard';
import { LoginPage } from './pages/Login';
import { WorkoutsPage } from './pages/Workouts';
import { WorkoutDetailPage } from './pages/WorkoutDetail';
import { NewWorkoutPage } from './pages/NewWorkout';
import { NutritionPage } from './pages/Nutrition';
import { NutritionPlanPage } from './pages/NutritionPlan';
import { FoodLogPage } from './pages/FoodLog';
import { ProfilePage } from './pages/Profile';
import { ProfileDataPage } from './pages/ProfileData';
import { OnboardingPage } from './pages/Onboarding';
import { WorkoutHistoryPage } from './pages/WorkoutHistory';
import { NutritionHistoryPage } from './pages/NutritionHistory';
import { FoodPhotoPage } from './pages/FoodPhoto';
import { CheatDayPage } from './pages/CheatDay';
import { FitnessAssessmentPage } from './pages/FitnessAssessment';
import { NewTrainingPlanPage } from './pages/NewTrainingPlan';
import { TrainingPlanDetailPage } from './pages/TrainingPlanDetail';
import { TrainingPlanDayPage } from './pages/TrainingPlanDay';
import { WorkoutSessionPage } from './pages/WorkoutSession';
import { SettingsPage } from './pages/Settings';
import { ResultsPage } from './pages/Results';

function ProtectedRoute({ children, allowIncomplete = false }: { children: React.ReactNode; allowIncomplete?: boolean }) {
  const { isAuthenticated } = useAuthStore();
  const { state, isLoading } = useOnboardingStore();
  // Waits for `offlineBoot.ts` to finish migrating/exporting the storage
  // engine and rehydrating `useOfflineStore` from it. Skipping this would let
  // a route render with an offline store still at `initialState` — an
  // in-progress workout or a pending mutation would read as if it never
  // existed, for however many renders IndexedDB's async read takes. See
  // `offlineStore.ts`'s `isHydrated` field and `offlineBoot.ts`.
  const isOfflineHydrated = useOfflineStore((offlineState) => offlineState.isHydrated);
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (isLoading || !state || !isOfflineHydrated) return <div className="min-h-screen bg-zinc-950 flex items-center justify-center text-zinc-500">Carregando...</div>;
  const onboardingReady = state.completed && Boolean(state.profile?.training_experience);
  if (!allowIncomplete && !onboardingReady) return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}

export default function App() {
  const { isAuthenticated, user, fetchMe } = useAuthStore();
  const { state: onboarding, fetchState, reset } = useOnboardingStore();

  // Uma vez só, no ciclo de vida do app: sem isto o voltar do Android encerra
  // o app em vez de voltar uma tela. No navegador é inofensivo — o evento
  // nunca dispara.
  useEffect(() => { registerAndroidBackButton(); }, []);

  useEffect(() => {
    if (isAuthenticated) {
      // Waits for `offlineReady` (the offline store's own hydration) before
      // either call touches its cache: both `fetchMe` and `fetchState` read
      // it cache-first (see `useAuthStore`/`useOnboardingStore`), and this
      // effect runs on mount regardless of hydration having finished. Read
      // any earlier and a device that already has this cached reads it as
      // empty, then sits on the (possibly slow) network response instead of
      // showing what it already knew — the exact bug fixed on `TermsGate`'s
      // own effect, which raced the same way for the same reason.
      void offlineReady.then(() => {
        fetchMe();
        fetchState();
      });
    } else {
      reset();
    }
  }, [isAuthenticated, user?.id, fetchMe, fetchState, reset]);

  return (
    <div className="min-h-screen bg-zinc-950">
      {/* Liability disclaimer gate: while it is pending, no protected route renders at all. */}
      <TermsGate active={isAuthenticated}>
        {/* Last line of defense against a render crash — see ErrorBoundary.tsx for why
            it sits here and not inside any individual route, the workout session included. */}
        <ErrorBoundary>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/onboarding" element={<ProtectedRoute allowIncomplete><OnboardingPage /></ProtectedRoute>} />

            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <DashboardPage />
                </ProtectedRoute>
              }
            />

            <Route
              path="/workouts"
              element={
                <ProtectedRoute>
                  <WorkoutsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/workouts/new"
              element={
                <ProtectedRoute>
                  <NewWorkoutPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/workouts/:id"
              element={
                <ProtectedRoute>
                  <WorkoutDetailPage />
                </ProtectedRoute>
              }
            />
            <Route path="/workouts/history" element={<ProtectedRoute><WorkoutHistoryPage /></ProtectedRoute>} />
            <Route path="/workouts/session" element={<ProtectedRoute><WorkoutSessionPage /></ProtectedRoute>} />
            <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
            <Route path="/results" element={<ProtectedRoute><ResultsPage /></ProtectedRoute>} />
            <Route path="/training-plans/new" element={<ProtectedRoute><NewTrainingPlanPage /></ProtectedRoute>} />
            <Route path="/training-plans/:id" element={<ProtectedRoute><TrainingPlanDetailPage /></ProtectedRoute>} />
            <Route path="/training-plans/:planId/days/:dayId" element={<ProtectedRoute><TrainingPlanDayPage /></ProtectedRoute>} />

            <Route
              path="/nutrition"
              element={
                <ProtectedRoute>
                  <NutritionPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/nutrition/plan"
              element={
                <ProtectedRoute>
                  <NutritionPlanPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/nutrition/log"
              element={
                <ProtectedRoute>
                  <FoodLogPage />
                </ProtectedRoute>
              }
            />
            <Route path="/nutrition/history" element={<ProtectedRoute><NutritionHistoryPage /></ProtectedRoute>} />
            <Route path="/nutrition/photo/:kind" element={<ProtectedRoute><FoodPhotoPage /></ProtectedRoute>} />
            <Route path="/nutrition/cheat-day" element={<ProtectedRoute><CheatDayPage /></ProtectedRoute>} />
            <Route path="/fitness-assessment" element={<ProtectedRoute><FitnessAssessmentPage /></ProtectedRoute>} />

            <Route
              path="/profile"
              element={
                <ProtectedRoute>
                  <ProfilePage />
                </ProtectedRoute>
              }
            />

            <Route
              path="/profile/dados"
              element={
                <ProtectedRoute>
                  <ProfileDataPage />
                </ProtectedRoute>
              }
            />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>

          {isAuthenticated && onboarding?.completed && onboarding.profile?.training_experience && <BottomNav />}
        </ErrorBoundary>
      </TermsGate>
    </div>
  );
}
