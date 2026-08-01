import { Navigate, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from '../auth/ProtectedRoute';
import { AppShell } from './layout/AppShell';
import { LoginPage } from './pages/LoginPage';
import { NewRecapPage } from './pages/NewRecapPage';
import { BuyCreditsPage } from './pages/BuyCreditsPage';
import { DashboardPage } from './pages/DashboardPage';
import { HistoryPage } from './pages/HistoryPage';
import { ProjectDetailPage } from './pages/ProjectDetailPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { SettingsPage } from './pages/SettingsPage';
import { SuperAdminPage } from './pages/SuperAdminPage';
import { UnauthorizedPage } from './pages/UnauthorizedPage';
import { GeminiKeyProvider } from './workspace/GeminiKeyContext';
import { useAuth } from '../auth/AuthProvider';

function DefaultHome() {
  const { profile } = useAuth();
  return <Navigate to={profile?.role === 'super_admin' ? '/dashboard' : '/new-recap'} replace />;
}

function DashboardAccess() {
  const { profile } = useAuth();
  return profile?.role === 'super_admin' ? <DashboardPage /> : <Navigate to="/new-recap" replace />;
}

function ProjectsAccess() {
  const { profile } = useAuth();
  return profile?.role === 'super_admin' ? <ProjectsPage /> : <Navigate to="/new-recap" replace />;
}

function SuperAdminAccess() {
  const { profile } = useAuth();
  return profile?.role === 'super_admin' ? <SuperAdminPage /> : <Navigate to="/new-recap" replace />;
}

export default function AppFoundation() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/unauthorized" element={<UnauthorizedPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<GeminiKeyProvider><AppShell /></GeminiKeyProvider>}>
            <Route index element={<DefaultHome />} />
            <Route path="/dashboard" element={<DashboardAccess />} />
            <Route path="/new-recap" element={<NewRecapPage />} />
            <Route path="/projects" element={<ProjectsAccess />} />
            <Route path="/projects/new" element={<Navigate to="/new-recap" replace />} />
            <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/buy-credits" element={<BuyCreditsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/admin" element={<SuperAdminAccess />} />
          </Route>
      </Route>
      <Route path="*" element={<DefaultHome />} />
    </Routes>
  );
}
