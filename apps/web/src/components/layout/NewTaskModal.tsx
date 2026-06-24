import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bug, Flame, ListTodo, PenLine, X } from 'lucide-react';
import { api } from '../../lib/api';
import type { ProjectListItem } from '../../lib/projects';

export type TaskType = 'jira' | 'custom' | 'bug' | 'incident';

interface NewTaskModalProps {
  open: boolean;
  onClose: () => void;
  defaultProjectId?: string;
}

const TASK_TYPES: { id: TaskType; label: string; description: string; icon: typeof ListTodo }[] = [
  { id: 'jira', label: 'Jira Ticket', description: 'Work from an existing Jira issue', icon: ListTodo },
  { id: 'custom', label: 'Custom Task', description: 'Ad-hoc task without a Jira key', icon: PenLine },
  { id: 'bug', label: 'Bug Fix', description: 'Targeted bug fix workflow', icon: Bug },
  { id: 'incident', label: 'Production Issue', description: 'Hotfix / incident response', icon: Flame },
];

export function NewTaskModal({ open, onClose, defaultProjectId }: NewTaskModalProps) {
  const navigate = useNavigate();
  const [taskType, setTaskType] = useState<TaskType>('jira');
  const [projectId, setProjectId] = useState(defaultProjectId ?? '');

  const projectsQ = useQuery({
    queryKey: ['projects'],
    queryFn: async () =>
      (await api.get<{ projects: ProjectListItem[] }>('/projects')).data.projects,
    enabled: open,
  });

  if (!open) return null;

  const projects = projectsQ.data ?? [];
  const selectedProject = projectId || projects[0]?.id || '';

  function handleContinue() {
    if (!selectedProject) return;
    if (taskType === 'custom' || taskType === 'bug') {
      navigate(`/workspaces/${selectedProject}/tasks/_custom?type=custom`);
    } else if (taskType === 'incident') {
      navigate('/tasks/incidents');
    } else {
      navigate(`/workspaces/${selectedProject}`);
    }
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden />
      <div className="relative w-full max-w-lg card border-surface-700 bg-surface-900 p-0 shadow-xl">
        <div className="flex items-center justify-between border-b border-surface-700 px-4 py-3">
          <h2 className="font-semibold text-white">New Task</h2>
          <button type="button" className="btn-ghost rounded-lg p-1" onClick={onClose}>
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-4">
          <div>
            <label className="label text-slate-300">Task type</label>
            <div className="grid grid-cols-2 gap-2">
              {TASK_TYPES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTaskType(t.id)}
                  className={[
                    'flex flex-col items-start rounded-lg border p-3 text-left transition-colors',
                    taskType === t.id
                      ? 'border-brand-500 bg-brand-600/10'
                      : 'border-surface-700 hover:border-surface-600',
                  ].join(' ')}
                >
                  <t.icon className="mb-1 h-4 w-4 text-brand-400" />
                  <span className="text-sm font-medium text-slate-200">{t.label}</span>
                  <span className="text-xs text-slate-500">{t.description}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="label text-slate-300" htmlFor="new-task-project">
              Workspace
            </label>
            <select
              id="new-task-project"
              className="input border-surface-700 bg-surface-800 text-slate-200"
              value={selectedProject}
              onChange={(e) => setProjectId(e.target.value)}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-surface-700 px-4 py-3">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!selectedProject}
            onClick={handleContinue}
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
