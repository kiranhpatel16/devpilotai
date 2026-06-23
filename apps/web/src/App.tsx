import { Navigate, Route, Routes } from 'react-router-dom';
import { isAdminRole } from '@cpwork/shared';
import { useAuth } from './auth/AuthContext';
import { AppLayout } from './components/AppLayout';
import { LoginPage } from './pages/LoginPage';
import { AdminDashboard } from './pages/admin/AdminDashboard';
import { AdminUsersPage } from './pages/admin/AdminUsersPage';
import { AdminProjectsPage } from './pages/admin/AdminProjectsPage';
import { AdminAiProvidersPage } from './pages/admin/AdminAiProvidersPage';
import { MyWorkPage } from './pages/MyWorkPage';
import { AgentPortPage } from './pages/AgentPortPage';
import { MyEnvironmentsPage } from './pages/MyEnvironmentsPage';

function FullScreen({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center text-slate-500">
      {children}
    </div>
  );
}

export default function App() {
  const { session, loading } = useAuth();

  if (loading) return <FullScreen>Loading CPWork…</FullScreen>;

  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  const admin = isAdminRole(session.user.globalRole);
  const home = admin ? '/admin' : '/agent';

  return (
    <Routes>
      <Route path="/login" element={<Navigate to={home} replace />} />
      <Route element={<AppLayout />}>
        {admin && (
          <>
            <Route path="/admin" element={<AdminDashboard />} />
            <Route path="/admin/users" element={<AdminUsersPage />} />
            <Route path="/admin/projects" element={<AdminProjectsPage />} />
            <Route path="/admin/ai-providers" element={<AdminAiProvidersPage />} />
          </>
        )}
        <Route path="/agent" element={<MyWorkPage />} />
        <Route path="/agent/:projectId" element={<AgentPortPage />} />
        <Route path="/my-environments" element={<MyEnvironmentsPage />} />
        <Route path="*" element={<Navigate to={home} replace />} />
      </Route>
    </Routes>
  );
}
