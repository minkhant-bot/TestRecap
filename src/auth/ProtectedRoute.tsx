import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { SessionLoading } from '../ui/pages/SessionLoading';

export function ProtectedRoute({ roles }: { roles?: Array<'super_admin' | 'admin' | 'user'> }) {
    const { profile, loading } = useAuth();
    const location = useLocation();
    if (loading) return <SessionLoading />;
    if (!profile) return <Navigate to="/login" replace state={{ from: location }} />;
    if (profile.status !== 'active') return <Navigate to="/unauthorized" replace state={{ reason: 'disabled' }} />;
    if (roles && !roles.includes(profile.role)) return <Navigate to="/unauthorized" replace />;
    return <Outlet />;
}
