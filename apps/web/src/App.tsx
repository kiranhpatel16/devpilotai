import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { isAdminRole } from '@cpwork/shared';
import { useAuth } from './auth/AuthContext';
import { AppShell } from './components/layout/AppShell';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { WorkspacesRedirectPage } from './pages/WorkspacesRedirectPage';
import { WorkspacesEmptyPage } from './pages/WorkspacesEmptyPage';
import { WorkspaceTaskBoardPage } from './pages/WorkspaceTaskBoardPage';
import { TaskExecutionCenterPage } from './pages/TaskExecutionCenterPage';
import { TasksPage } from './pages/TasksPage';
import { CustomTasksPage } from './pages/CustomTasksPage';
import { IncidentsPage } from './pages/IncidentsPage';
import { TaskHistoryPage } from './pages/TaskHistoryPage';
import { AgentsPage } from './pages/AgentsPage';
import { KnowledgePage } from './pages/KnowledgePage';
import { DeploymentsPage } from './pages/DeploymentsPage';
import { ReportsPage } from './pages/ReportsPage';
import { SettingsPage } from './pages/SettingsPage';
import { AdminUsersPage } from './pages/admin/AdminUsersPage';
import { AdminProjectsPage } from './pages/admin/AdminProjectsPage';
import { AdminAiProvidersPage } from './pages/admin/AdminAiProvidersPage';
import { AdminAiRulesPage } from './pages/admin/AdminAiRulesPage';
import { MyWorkPage } from './pages/MyWorkPage';
import { AgentPortPage } from './pages/AgentPortPage';
import { MyEnvironmentsPage } from './pages/MyEnvironmentsPage';

export default function App() {
  const { session } = useAuth();

  // No session → login immediately (never block on /auth/me).
  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  const admin = isAdminRole(session.user.globalRole);
  const home = '/workspaces';

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
            <Route path="/admin/ai-rules" element={<AdminAiRulesPage />} />
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

function LegacyAgentRedirect() {
  const { projectId } = useParams();
  return <Navigate to={`/workspaces/${projectId}`} replace />;
}

function LegacyTasksRedirect() {
  const { projectId } = useParams();
  return <Navigate to={`/workspaces/${projectId}`} replace />;
}
