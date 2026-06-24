import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
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
      <Route element={<AppShell />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/workspaces" element={<WorkspacesRedirectPage />} />
        <Route path="/workspaces/empty" element={<WorkspacesEmptyPage />} />
        <Route path="/workspaces/:projectId" element={<WorkspaceTaskBoardPage />} />
        <Route
          path="/workspaces/:projectId/tasks/:taskKey"
          element={<TaskExecutionCenterPage />}
        />
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/tasks/custom" element={<CustomTasksPage />} />
        <Route path="/tasks/incidents" element={<IncidentsPage />} />
        <Route path="/tasks/history" element={<TaskHistoryPage />} />
        <Route path="/agents" element={<AgentsPage />} />
        <Route path="/knowledge" element={<KnowledgePage />} />
        <Route path="/knowledge/rules" element={<KnowledgePage />} />
        <Route path="/knowledge/standards" element={<KnowledgePage />} />
        <Route path="/knowledge/architecture" element={<KnowledgePage />} />
        <Route path="/deployments" element={<DeploymentsPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/settings" element={<SettingsPage />}>
          {admin && (
            <>
              <Route path="users" element={<AdminUsersPage />} />
              <Route path="projects" element={<AdminProjectsPage />} />
              <Route path="ai-providers" element={<AdminAiProvidersPage />} />
              <Route path="ai-rules" element={<AdminAiRulesPage />} />
            </>
          )}
          <Route path="environments" element={<MyEnvironmentsPage />} />
        </Route>
        {/* Legacy redirects */}
        <Route path="/agent" element={<Navigate to="/workspaces" replace />} />
        <Route path="/agent/:projectId" element={<LegacyAgentRedirect />} />
        <Route path="/workspaces/:projectId/tasks" element={<LegacyTasksRedirect />} />
        <Route path="/my-environments" element={<Navigate to="/settings/environments" replace />} />
        <Route path="/admin" element={<Navigate to="/settings/users" replace />} />
        <Route path="/admin/users" element={<Navigate to="/settings/users" replace />} />
        <Route path="/admin/projects" element={<Navigate to="/settings/projects" replace />} />
        <Route path="/admin/ai-providers" element={<Navigate to="/settings/ai-providers" replace />} />
        <Route path="/admin/ai-rules" element={<LegacyAiRulesRedirect />} />
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

function LegacyAiRulesRedirect() {
  const { search } = useLocation();
  return <Navigate to={`/settings/ai-rules${search}`} replace />;
}
