import { Navigate, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from '../auth/ProtectedRoute';
import { AppShell } from './layout/AppShell';
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/LoginPage';
import { NewRecapPage } from './pages/NewRecapPage';
import { BuyCreditsPage } from './pages/BuyCreditsPage';
import { HistoryPage } from './pages/HistoryPage';
import { SettingsPage } from './pages/SettingsPage';
import { SuperAdminPage } from './pages/SuperAdminPage';
import { UnauthorizedPage } from './pages/UnauthorizedPage';
import { GeminiKeyProvider } from './workspace/GeminiKeyContext';
import { useAuth } from '../auth/AuthProvider';

function DefaultHome() {
  const { profile } = useAuth();
  return <Navigate to={profile?.role === 'super_admin' ? '/admin' : '/new-recap'} replace />;
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
        <Route element={<GeminiKeyProvider><AppShell /></GeminiKeyProvider>}>
            <Route path="/new-recap" element={<NewRecapPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/buy-credits" element={<BuyCreditsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/admin" element={<SuperAdminAccess />} />
            {/* Retired routes (Dashboard/Projects merged into New Recap, History, and the Admin
                Overview tab) — kept as redirects so old bookmarks/links still resolve. */}
            <Route path="/dashboard" element={<DefaultHome />} />
            <Route path="/projects" element={<Navigate to="/new-recap" replace />} />
            <Route path="/projects/new" element={<Navigate to="/new-recap" replace />} />
            <Route path="/projects/:projectId" element={<Navigate to="/new-recap" replace />} />
          </Route>
      </Route>
      <Route path="*" element={<DefaultHome />} />
    </Routes>
  );
}
