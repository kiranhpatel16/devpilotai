import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { isAdminRole, type JiraBoard, type Project } from '@cpwork/shared';
import { BookOpen, History, ListTodo, PenLine, Settings, Sparkles } from 'lucide-react';
import { api, getApiErrorMessage } from '../lib/api';
import type { ProjectListItem } from '../lib/projects';
import { setLastWorkspaceId } from '../lib/lastWorkspace';
import { useAuth } from '../auth/AuthContext';
import { EmptyState } from '../components/ui/EmptyState';
import { StatusBadge } from '../components/ui/StatusBadge';
import { TaskBoardPanel } from '../components/workspace/TaskBoardPanel';
import { WorkspaceSettingsPanel } from '../components/workspace/WorkspaceSettingsPanel';
import { WorkspaceTaskHistoryPanel } from '../components/workspace/WorkspaceTaskHistoryPanel';
import { WorkspaceCustomTasksPanel } from '../components/workspace/WorkspaceCustomTasksPanel';
import { WorkspaceLlmConfigPanel } from '../components/workspace/WorkspaceLlmConfigPanel';

type WorkspaceTab = 'tasks' | 'knowledge' | 'history' | 'custom' | 'settings' | 'llm';

interface ProjectDetail {
  project: Project;
  myRole: string | null;
}

function countByStatus(board: JiraBoard | undefined, matcher: (status: string) => boolean): number {
  if (!board?.groups) return 0;
  return board.groups
    .filter((g) => matcher(g.status))
    .reduce((sum, g) => sum + g.tasks.length, 0);
}

function WorkspaceStatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="min-w-[7rem] rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900/60">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-0.5 text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
        {value}
      </p>
    </div>
  );
}

export function WorkspaceTaskBoardPage() {
  const { projectId = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { session, refresh } = useAuth();
  const admin = session ? isAdminRole(session.user.globalRole) : false;
  const [scope, setScope] = useState<'mine' | 'all'>('mine');

  const tab = (searchParams.get('tab') as WorkspaceTab) || 'tasks';

  const projectsQ = useQuery({
    queryKey: ['projects'],
    queryFn: async () =>
      (await api.get<{ projects: ProjectListItem[] }>('/projects')).data.projects,
  });

  const projectQ = useQuery({
    queryKey: ['project', projectId],
    queryFn: async () => (await api.get<ProjectDetail>(`/projects/${projectId}`)).data,
    enabled: !!projectId,
  });

  const boardQ = useQuery({
    queryKey: ['jira-board', projectId, scope],
    queryFn: async () =>
      (
        await api.get<{ board: JiraBoard }>(
          `/projects/${projectId}/jira/tasks?scope=${scope}`,
        )
      ).data.board,
    enabled: !!projectId,
  });

  const inProgressCount = useMemo(
    () =>
      countByStatus(boardQ.data, (status) => status.toLowerCase().includes('progress')),
    [boardQ.data],
  );

  useEffect(() => {
    if (projectId) {
      setLastWorkspaceId(projectId);
    }
  }, [projectId]);

  if (projectsQ.isLoading) {
    return <p className="text-sm text-slate-500">Loading workspaces…</p>;
  }

  const projects = projectsQ.data ?? [];

  if (projects.length === 0) {
    return (
      <EmptyState
        title="No workspaces assigned"
        description="Ask an administrator to assign you to a project, or add one with New Project in the top bar."
      />
    );
  }

  if (!projectId || !projects.some((p) => p.id === projectId)) {
    return <Navigate to={`/workspaces/${projects[0].id}`} replace />;
  }

  const activeProject = projects.find((p) => p.id === projectId)!;
  const p = projectQ.data?.project;

  async function handleDetectJira() {
    try {
      await api.post('/auth/me/jira-account/detect', { projectId });
      await refresh();
      await queryClient.invalidateQueries({ queryKey: ['jira-board', projectId] });
    } catch (err) {
      console.error(getApiErrorMessage(err));
    }
  }

  function setTab(next: WorkspaceTab) {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('tab', next);
    setSearchParams(nextParams, { replace: true });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
              {p?.name ?? activeProject.name}
            </h1>
            {activeProject.environmentVerified ? (
              <StatusBadge label="Environment verified" variant="online" dot />
            ) : (
              <StatusBadge label="Environment not verified" variant="busy" />
            )}
          </div>
          <p className="text-sm text-slate-500">
            {p?.description ?? 'No project description'}
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <WorkspaceStatCard
            label="Open Tasks"
            value={boardQ.isLoading ? '—' : (boardQ.data?.total ?? 0)}
          />
          <WorkspaceStatCard
            label="In Progress"
            value={boardQ.isLoading ? '—' : inProgressCount}
          />
          <WorkspaceStatCard label="Pending Reviews" value={0} />
        </div>
      </div>

      <div className="flex gap-1 border-b border-slate-200 dark:border-neutral-800">
        {(
          [
            { id: 'tasks' as const, label: 'Tasks', icon: ListTodo },
            { id: 'knowledge' as const, label: 'Knowledge', icon: BookOpen },
            { id: 'history' as const, label: 'Task history', icon: History },
            { id: 'custom' as const, label: 'Custom tasks', icon: PenLine },
            { id: 'settings' as const, label: 'Settings', icon: Settings },
            { id: 'llm' as const, label: 'LLM configuration', icon: Sparkles },
          ] as const
        ).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={[
              'flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
              tab === id
                ? 'border-brand-600 text-brand-600 dark:border-brand-400 dark:text-brand-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200',
            ].join(' ')}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === 'tasks' && (
        <TaskBoardPanel
          projectId={projectId}
          board={boardQ.data}
          boardLoading={boardQ.isLoading}
          boardError={boardQ.isError ? getApiErrorMessage(boardQ.error) : null}
          scope={scope}
          onScopeChange={setScope}
          onDetectJira={handleDetectJira}
          needsJiraIdentity={boardQ.data?.needsJiraIdentity}
          jiraMessage={boardQ.data?.message}
        />
      )}

      {tab === 'knowledge' && (
        <div className="card space-y-3 p-6 shadow-card">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            Project knowledge
          </h2>
          <p className="text-sm text-slate-500">
            Docs, client rules, coding standards, and architecture notes for this workspace.
          </p>
          <Link
            to={`/knowledge?project=${projectId}`}
            className="btn-primary inline-flex w-fit"
          >
            Open knowledge base →
          </Link>
        </div>
      )}

      {tab === 'history' && <WorkspaceTaskHistoryPanel projectId={projectId} />}

      {tab === 'custom' && (
        <WorkspaceCustomTasksPanel
          projectId={projectId}
          autoOpenCreate={searchParams.get('create') === '1'}
          onCreateModalClose={() => {
            if (searchParams.get('create')) {
              setSearchParams({ tab: 'custom' }, { replace: true });
            }
          }}
        />
      )}

      {tab === 'settings' && (
        <WorkspaceSettingsPanel
          projectId={projectId}
          admin={admin}
          project={p ?? null}
        />
      )}

      {tab === 'llm' && (
        <WorkspaceLlmConfigPanel projectId={projectId} project={p} />
      )}
    </div>
  );
}
