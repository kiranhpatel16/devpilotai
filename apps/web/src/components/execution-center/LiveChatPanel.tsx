import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Send } from 'lucide-react';
import { api, getApiErrorMessage } from '../../lib/api';
import {
  taskBtnPrimary,
  taskInput,
  taskMuted,
  taskPanel,
  taskPanelHeader,
  taskTitle,
} from './taskStyles';

interface LiveChatPanelProps {
  projectId: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

const SUGGESTED_PROMPTS = [
  'Explain this task',
  'Explain this code',
  'Add unit test',
  'Check Magento standards',
];

export function LiveChatPanel({ projectId }: LiveChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');

  const askM = useMutation({
    mutationFn: async (question: string) => {
      const res = await api.post<{ answer: string }>(`/projects/${projectId}/chat`, {
        message: question,
        mode: 'ask',
      });
      return res.data.answer ?? 'No response.';
    },
    onSuccess: (text, question) => {
      setMessages((m) => [
        ...m,
        { role: 'user', text: question },
        { role: 'assistant', text },
      ]);
      setInput('');
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || askM.isPending) return;
    askM.mutate(input.trim());
  }

  function askPrompt(prompt: string) {
    if (askM.isPending) return;
    askM.mutate(prompt);
  }

  return (
    <div className={taskPanel}>
      <header className={taskPanelHeader}>
        <h3 className={taskTitle}>Ask DevPilot</h3>
      </header>
      <div className="flex max-h-72 flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap gap-1.5 border-b border-slate-700/60 p-2">
          {SUGGESTED_PROMPTS.map((p) => (
            <button
              key={p}
              type="button"
              className="rounded-full border border-slate-600 bg-[#0f0f1a] px-2.5 py-1 text-[11px] text-slate-400 transition-colors hover:border-brand-500/50 hover:text-brand-300"
              onClick={() => askPrompt(p)}
            >
              {p}
            </button>
          ))}
        </div>
        <div className="flex-1 space-y-2 overflow-y-auto p-3">
          {messages.length === 0 && (
            <p className={`text-xs ${taskMuted}`}>
              Ask about this codebase, Magento patterns, or the current task.
            </p>
          )}
          {messages.map((m, i) => (
            <div
              key={i}
              className={[
                'rounded-lg px-3 py-2 text-xs',
                m.role === 'user'
                  ? 'ml-4 bg-brand-600/20 text-slate-200'
                  : 'mr-4 bg-[#0f0f1a] text-slate-400',
              ].join(' ')}
            >
              {m.text}
            </div>
          ))}
          {askM.isError && (
            <p className="text-xs text-red-400">{getApiErrorMessage(askM.error)}</p>
          )}
        </div>
        <form onSubmit={handleSubmit} className="border-t border-slate-700/60 p-2">
          <div className="flex gap-2">
            <input
              className={`${taskInput} flex-1 text-sm`}
              placeholder="Ask about this codebase…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
            <button type="submit" className={`${taskBtnPrimary} px-3`} disabled={askM.isPending}>
              <Send className="h-4 w-4" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
