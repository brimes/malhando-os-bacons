import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/useAuthStore';
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

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  const { isAuthenticated, fetchMe } = useAuthStore();

  useEffect(() => {
    if (isAuthenticated) {
      fetchMe();
    }
  }, [isAuthenticated, fetchMe]);

  return (
    <div className="min-h-screen bg-zinc-950">
      <Routes>
        <Route path="/login" element={<LoginPage />} />

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

      {isAuthenticated && <BottomNav />}
    </div>
  );
}
