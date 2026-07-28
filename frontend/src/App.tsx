import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/useAuthStore';
import { useOnboardingStore } from './stores/useOnboardingStore';
import { BottomNav } from './components/BottomNav';
import { DashboardPage } from './pages/Dashboard';
import { LoginPage } from './pages/Login';
import { WorkoutsPage } from './pages/Workouts';
import { WorkoutDetailPage } from './pages/WorkoutDetail';
import { NewWorkoutPage } from './pages/NewWorkout';
import { NutritionPage } from './pages/Nutrition';
import { NutritionPlanPage } from './pages/NutritionPlan';
import { FoodLogPage } from './pages/FoodLog';
import { ProfilePage } from './pages/Profile';
import { OnboardingPage } from './pages/Onboarding';
import { WorkoutHistoryPage } from './pages/WorkoutHistory';
import { NutritionHistoryPage } from './pages/NutritionHistory';
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
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (isLoading || !state) return <div className="min-h-screen bg-zinc-950 flex items-center justify-center text-zinc-500">Carregando...</div>;
  const onboardingReady = state.completed && Boolean(state.profile?.training_experience);
  if (!allowIncomplete && !onboardingReady) return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}

export default function App() {
  const { isAuthenticated, user, fetchMe } = useAuthStore();
  const { state: onboarding, fetchState, reset } = useOnboardingStore();

  useEffect(() => {
    if (isAuthenticated) {
      fetchMe();
      fetchState();
    } else {
      reset();
    }
  }, [isAuthenticated, user?.id, fetchMe, fetchState, reset]);

  return (
    <div className="min-h-screen bg-zinc-950">
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
        <Route path="/fitness-assessment" element={<ProtectedRoute><FitnessAssessmentPage /></ProtectedRoute>} />

        <Route
          path="/profile"
          element={
            <ProtectedRoute>
              <ProfilePage />
            </ProtectedRoute>
          }
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {isAuthenticated && onboarding?.completed && onboarding.profile?.training_experience && <BottomNav />}
    </div>
  );
}
