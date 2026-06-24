import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bell, ChevronDown, GitBranch, Menu, Moon, Plus, Search, Sun } from 'lucide-react';
import { isAdminRole } from '@cpwork/shared';
import { useAuth } from '../../auth/AuthContext';
import { useExecution } from '../../context/ExecutionContext';
import { useTheme } from '../../theme/ThemeContext';
import { api } from '../../lib/api';
import type { ProjectListItem } from '../../lib/projects';
import { setLastWorkspaceId } from '../../lib/lastWorkspace';

interface TopBarProps {
  onMenuClick: () => void;
}

export function TopBar({ onMenuClick }: TopBarProps) {
  const { session, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { branchName } = useExecution();
  const navigate = useNavigate();
  const { projectId } = useParams();
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);

  const projectsQ = useQuery({
    queryKey: ['projects'],
    queryFn: async () =>
      (await api.get<{ projects: ProjectListItem[] }>('/projects')).data.projects,
  });

  const projects = projectsQ.data ?? [];
  const activeProject =
    projects.find((p) => p.id === projectId) ?? projects[0];
  const admin = session ? isAdminRole(session.user.globalRole) : false;

  function selectProject(p: ProjectListItem) {
    setLastWorkspaceId(p.id);
    setProjectMenuOpen(false);
    navigate(`/workspaces/${p.id}`);
  }

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur dark:border-slate-700 dark:bg-slate-800/95 lg:pl-6">
      <button
        type="button"
        className="btn-ghost rounded-xl p-2 lg:hidden"
        onClick={onMenuClick}
        aria-label="Open menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      <div className="relative flex items-center gap-2">
        <button
          type="button"
          className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:border-brand-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
          onClick={() => setProjectMenuOpen((o) => !o)}
        >
          <span className="font-medium">{activeProject?.name ?? 'Select workspace'}</span>
          {activeProject?.jira.projectKey && (
            <span className="text-slate-400">({activeProject.jira.projectKey})</span>
          )}
          <ChevronDown className="h-4 w-4 text-slate-400" />
        </button>

        {admin && (
          <Link
            to="/settings/projects"
            className="btn-secondary hidden items-center gap-1.5 whitespace-nowrap text-sm sm:inline-flex"
          >
            <Plus className="h-4 w-4" />
            New Project
          </Link>
        )}

        {projectMenuOpen && projects.length > 0 && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setProjectMenuOpen(false)}
              aria-hidden
            />
            <div className="absolute left-0 top-full z-50 mt-1 min-w-[220px] rounded-xl border border-slate-200 bg-white py-1 shadow-card dark:border-slate-700 dark:bg-slate-800 dark:shadow-card-dark">
              {projects.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={[
                    'flex w-full flex-col px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-700',
                    p.id === activeProject?.id ? 'bg-brand-50 dark:bg-brand-900/30' : '',
                  ].join(' ')}
                  onClick={() => selectProject(p)}
                >
                  <span className="font-medium text-slate-800 dark:text-slate-100">{p.name}</span>
                  {p.jira.projectKey && (
                    <span className="text-xs text-slate-500">{p.jira.projectKey}</span>
                  )}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {branchName && (
        <div className="hidden items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs md:flex dark:border-slate-700 dark:bg-slate-900">
          <GitBranch className="h-3.5 w-3.5 text-brand-600 dark:text-brand-400" />
          <span className="max-w-[200px] truncate font-mono text-slate-700 dark:text-slate-300">
            {branchName}
          </span>
        </div>
      )}

      <div className="hidden flex-1 md:flex md:max-w-md">
        <div className="relative w-full">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            placeholder="Search tasks, files, knowledge…"
            className="input w-full bg-slate-50 pl-9 text-sm dark:bg-slate-900"
          />
        </div>
      </div>

      <div className="ml-auto flex items-center gap-1 sm:gap-2">
        <button
          type="button"
          className="btn-ghost relative rounded-xl p-2"
          aria-label="Notifications"
        >
          <Bell className="h-5 w-5" />
          <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
            8
          </span>
        </button>

        <button
          type="button"
          onClick={toggleTheme}
          className="btn-ghost rounded-xl p-2"
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </button>

        <div className="hidden items-center gap-2 border-l border-slate-200 pl-3 sm:flex dark:border-slate-700">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-sm font-medium text-white">
            {session?.user.displayName?.charAt(0) ?? '?'}
          </div>
          <div className="hidden lg:block">
            <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
              {session?.user.displayName}
            </p>
            <p className="text-xs capitalize text-slate-500">{session?.user.globalRole}</p>
          </div>
          <button type="button" className="btn-ghost text-xs" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </div>
    </header>
  );
}
