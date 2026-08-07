import { lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from '../auth/ProtectedRoute';
import { AppShell } from './layout/AppShell';
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/LoginPage';
import { SettingsPage } from './pages/SettingsPage';
import { UnauthorizedPage } from './pages/UnauthorizedPage';
import { useAuth } from '../auth/AuthProvider';

// Landing/Login/Settings/Unauthorized stay eager (small, and Landing/Login
// are the first thing an unauthenticated visitor needs -- lazy-loading them
// would add a chunk round-trip to the very page this task optimizes for).
// The heavier, per-role screens split into their own chunks instead, so a
// user who only ever visits New Recap/History never downloads the Super
// Admin console (and vice versa).
const DashboardPage = lazy(() => import('./pages/DashboardPage').then(m => ({ default: m.DashboardPage })));
const NewRecapPage = lazy(() => import('./pages/NewRecapPage').then(m => ({ default: m.NewRecapPage })));
const HistoryPage = lazy(() => import('./pages/HistoryPage').then(m => ({ default: m.HistoryPage })));
const BuyCreditsPage = lazy(() => import('./pages/BuyCreditsPage').then(m => ({ default: m.BuyCreditsPage })));
const SuperAdminPage = lazy(() => import('./pages/SuperAdminPage').then(m => ({ default: m.SuperAdminPage })));

function DefaultHome() {
  const { profile } = useAuth();
  return <Navigate to={profile?.role === 'super_admin' ? '/dashboard' : '/new-recap'} replace />;
}

// Same permission as before (Dashboard is the former Admin Overview tab,
// unchanged audience): Owner/Super Admin only, everyone else bounces to
// New Recap exactly like the Admin route already does.
function DashboardAccess() {
  const { profile } = useAuth();
  return profile?.role === 'super_admin' ? <DashboardPage /> : <Navigate to="/new-recap" replace />;
}

function SuperAdminAccess() {
  const { profile } = useAuth();
  return profile?.role === 'super_admin' ? <SuperAdminPage /> : <Navigate to="/new-recap" replace />;
}

export default function AppFoundation() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/unauthorized" element={<UnauthorizedPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
            <Route path="/dashboard" element={<DashboardAccess />} />
            <Route path="/new-recap" element={<NewRecapPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/buy-credits" element={<BuyCreditsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/admin" element={<SuperAdminAccess />} />
            {/* Retired routes (Projects merged into New Recap and History) —
                kept as redirects so old bookmarks/links still resolve. */}
            <Route path="/projects" element={<Navigate to="/new-recap" replace />} />
            <Route path="/projects/new" element={<Navigate to="/new-recap" replace />} />
            <Route path="/projects/:projectId" element={<Navigate to="/new-recap" replace />} />
          </Route>
      </Route>
      <Route path="*" element={<DefaultHome />} />
    </Routes>
  );
}
