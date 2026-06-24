import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { RunDetail, TaskWorkflowStep } from '@cpwork/shared';
import { api } from '../../lib/api';
import { taskInput, taskMuted, taskPanel, taskPanelHeader, taskTitle } from './taskStyles';

interface RequirementNotesPanelProps {
  runId?: string | null;
  currentStep?: TaskWorkflowStep | null;
  value?: string | null;
  taskKey?: string | null;
  onNotesChange?: (text: string) => void;
  onSaved?: (detail: RunDetail) => void;
  readOnly?: boolean;
}

function storageKey(taskKey: string | null | undefined): string {
  return `devpilot-notes:${taskKey ?? 'custom'}`;
}

export function RequirementNotesPanel({
  runId,
  currentStep,
  value,
  taskKey,
  onNotesChange,
  onSaved,
  readOnly,
}: RequirementNotesPanelProps) {
  const controlled = onNotesChange != null;
  const [internalNotes, setInternalNotes] = useState(() => {
    if (value) return value;
    try {
      return localStorage.getItem(storageKey(taskKey)) ?? '';
    } catch {
      return '';
    }
  });
  const notes = controlled ? (value ?? '') : internalNotes;
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!controlled && value != null) setInternalNotes(value);
  }, [controlled, value]);

  const saveM = useMutation({
    mutationFn: async (text: string) => {
      if (!runId || !currentStep) {
        try {
          localStorage.setItem(storageKey(taskKey), text);
        } catch {
          /* ignore */
        }
        return null;
      }
      return (
        await api.patch<{ detail: RunDetail }>(`/workflow/runs/${runId}/step`, {
          step: currentStep,
          userInstructions: text || null,
        })
      ).data.detail;
    },
    onSuccess: (detail) => {
      setDirty(false);
      if (detail) onSaved?.(detail);
    },
  });

  function handleChange(text: string) {
    if (controlled) {
      onNotesChange!(text);
    } else {
      setInternalNotes(text);
    }
    setDirty(true);
    if (!runId) {
      try {
        localStorage.setItem(storageKey(taskKey), text);
      } catch {
        /* ignore */
      }
    }
  }

  return (
    <div className={taskPanel}>
      <header className={`${taskPanelHeader} flex items-center justify-between`}>
        <h3 className={taskTitle}>Additional requirement notes</h3>
        {!readOnly && dirty && runId && !controlled && (
          <button
            type="button"
            className="text-xs font-medium text-brand-400 hover:text-brand-300"
            disabled={saveM.isPending}
            onClick={() => saveM.mutate(notes)}
          >
            {saveM.isPending ? 'Saving…' : 'Save'}
          </button>
        )}
      </header>
      <div className="p-4">
        <p className={`mb-2 text-xs ${taskMuted}`}>
          Add Magento, Hyva, or client-specific context for the AI agents.
        </p>
        <textarea
          className={`${taskInput} min-h-[140px] resize-y`}
          placeholder="e.g. Use Tailwind utilities only, follow existing module patterns…"
          value={notes}
          onChange={(e) => handleChange(e.target.value)}
          readOnly={readOnly}
          onBlur={() => {
            if (dirty && runId && !controlled) saveM.mutate(notes);
          }}
        />
        {saveM.isError && (
          <p className="mt-2 text-xs text-red-400">Could not save notes.</p>
        )}
      </div>
    </div>
  );
}

/** Read notes from localStorage before a workflow run exists. */
export function loadStoredNotes(taskKey: string | null | undefined): string {
  try {
    return localStorage.getItem(storageKey(taskKey)) ?? '';
  } catch {
    return '';
  }
}
