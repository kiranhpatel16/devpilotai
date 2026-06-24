import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { isAdminRole } from '@cpwork/shared';
import { useAuth } from '../auth/AuthContext';

export function SettingsPage() {
  const { session } = useAuth();
  const location = useLocation();
  const admin = session ? isAdminRole(session.user.globalRole) : false;
  const isIndex = location.pathname === '/settings';

  if (isIndex) {
    return <Navigate to={admin ? '/settings/users' : '/settings/environments'} replace />;
  }

  return <Outlet />;
}
