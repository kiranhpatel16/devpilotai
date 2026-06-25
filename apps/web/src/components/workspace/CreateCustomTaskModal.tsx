import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import type { RunDetail } from '@cpwork/shared';
import { api, getApiErrorMessage } from '../../lib/api';

interface CreateCustomTaskModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  onCreated?: (detail: RunDetail) => void;
}

export function CreateCustomTaskModal({
  open,
  onClose,
  projectId,
  onCreated,
}: CreateCustomTaskModalProps) {
  const queryClient = useQueryClient();
  const [taskId, setTaskId] = useState('');
  const [title, setTitle] = useState('');
  const [requirements, setRequirements] = useState('');

  const createM = useMutation({
    mutationFn: async () =>
      (
        await api.post<{ detail: RunDetail }>('/workflow/runs', {
          projectId,
          customTitle: title.trim(),
          customTaskKey: taskId.trim() || null,
          customRequirements: requirements.trim() || null,
        })
      ).data.detail,
    onSuccess: (detail) => {
      void queryClient.invalidateQueries({ queryKey: ['workflow-history', projectId] });
      setTaskId('');
      setTitle('');
      setRequirements('');
      onCreated?.(detail);
      onClose();
    },
  });

  if (!open) return null;

  const canSave = title.trim().length > 0 && !createM.isPending;

  function handleClose() {
    if (createM.isPending) return;
    setTaskId('');
    setTitle('');
    setRequirements('');
    createM.reset();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={handleClose} aria-hidden />
      <div
        className="relative w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-xl dark:border-neutral-800 dark:bg-black"
        role="dialog"
        aria-labelledby="create-custom-task-title"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-neutral-800">
          <h2
            id="create-custom-task-title"
            className="text-lg font-semibold text-slate-900 dark:text-white"
          >
            New custom task
          </h2>
          <button type="button" className="btn-ghost rounded-lg p-1" onClick={handleClose}>
            <X className="h-5 w-5" />
          </button>
        </div>

        <form
          className="space-y-4 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSave) createM.mutate();
          }}
        >
          <div>
            <label className="label" htmlFor="custom-task-id">
              Task ID
            </label>
            <input
              id="custom-task-id"
              className="input font-mono"
              placeholder="e.g. FM-1005"
              value={taskId}
              onChange={(e) => setTaskId(e.target.value)}
              autoFocus
            />
            <p className="mt-1 text-xs text-slate-500">
              Optional short identifier. Leave blank to auto-generate one.
            </p>
          </div>

          <div>
            <label className="label" htmlFor="custom-task-title">
              Task title
            </label>
            <input
              id="custom-task-title"
              className="input"
              placeholder="Describe what needs to be done…"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="label" htmlFor="custom-task-requirements">
              Requirements
            </label>
            <textarea
              id="custom-task-requirements"
              className="input min-h-[140px] resize-y"
              placeholder="Describe the requirements, acceptance criteria, and any technical context…"
              value={requirements}
              onChange={(e) => setRequirements(e.target.value)}
            />
          </div>

          {createM.isError && (
            <p className="text-sm text-red-600 dark:text-red-400">
              {getApiErrorMessage(createM.error)}
            </p>
          )}

          <div className="flex justify-end gap-2 border-t border-slate-200 pt-4 dark:border-neutral-800">
            <button type="button" className="btn-secondary" onClick={handleClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={!canSave}>
              {createM.isPending ? 'Saving…' : 'Save task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
