import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { isAdminRole } from '@cpwork/shared';
import { useAuth } from '../../auth/AuthContext';
import type { ProjectListItem } from '../../lib/projects';
import { StatusBadge } from '../ui/StatusBadge';

interface ProjectSidebarProps {
  projects: ProjectListItem[];
  activeProjectId: string;
  onSelectProject: (projectId: string) => void;
}

export function ProjectSidebar({
  projects,
  activeProjectId,
  onSelectProject,
}: ProjectSidebarProps) {
  const { session } = useAuth();
  const admin = session ? isAdminRole(session.user.globalRole) : false;

  return (
    <aside className="w-full shrink-0 space-y-2 lg:w-56">
      <p className="px-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
        Projects
      </p>

      <div className="space-y-1">
        {projects.map((p) => {
          const active = p.id === activeProjectId;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onSelectProject(p.id)}
              className={[
                'flex w-full flex-col rounded-lg border px-3 py-2 text-left transition-colors',
                active
                  ? 'border-brand-400 bg-brand-50 dark:border-brand-500 dark:bg-brand-600/15'
                  : 'border-slate-200 bg-white hover:border-brand-300 dark:border-neutral-800 dark:bg-neutral-900/80 dark:hover:border-brand-500/40',
              ].join(' ')}
            >
              <span className="text-sm font-medium text-slate-900 dark:text-white">{p.name}</span>
              <span className="text-xs text-slate-500">
                {p.jira.projectKey ? `Jira: ${p.jira.projectKey}` : 'No Jira key'}
              </span>
              {active && (
                <span className="mt-1">
                  {p.environmentVerified ? (
                    <StatusBadge label="Env verified" variant="online" dot />
                  ) : p.hasEnvironment ? (
                    <StatusBadge label="Env unverified" />
                  ) : (
                    <StatusBadge label="Setup required" variant="busy" />
                  )}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {admin ? (
        <Link
          to="/settings/projects"
          className="btn-secondary flex w-full items-center justify-center gap-2 text-sm"
        >
          <Plus className="h-4 w-4" />
          Add project
        </Link>
      ) : (
        <p className="px-2 text-xs text-slate-500">
          Ask an admin to add a new project.
        </p>
      )}
    </aside>
  );
}
