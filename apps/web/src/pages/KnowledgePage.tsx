import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { api } from '../lib/api';
import type { ProjectListItem } from '../lib/projects';

const CATEGORIES = [
  { id: 'project_docs', label: 'Project Documentation' },
  { id: 'client_rules', label: 'Client Rules' },
  { id: 'coding_standards', label: 'Coding Standards' },
  { id: 'architecture', label: 'Architecture Notes' },
  { id: 'decisions', label: 'Previous Decisions' },
];

export function KnowledgePage() {
  const [params] = useSearchParams();
  const projectFilter = params.get('project');

  const projectsQ = useQuery({
    queryKey: ['projects'],
    queryFn: async () =>
      (await api.get<{ projects: ProjectListItem[] }>('/projects')).data.projects,
  });

  const knowledgeQ = useQuery({
    queryKey: ['knowledge', projectFilter],
    queryFn: async () => {
      const url = projectFilter
        ? `/knowledge?projectId=${projectFilter}`
        : '/knowledge';
      return (await api.get<{ documents: { id: string; title: string; category: string }[] }>(url)).data;
    },
    retry: false,
  });

  const docs = knowledgeQ.data?.documents ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Knowledge Base"
        subtitle="Project documentation, standards, and rules the AI searches before coding"
      />

      <div className="grid gap-4 lg:grid-cols-4">
        <aside className="card border-surface-700 bg-surface-800/80 p-4 lg:col-span-1">
          <h3 className="mb-3 text-sm font-medium text-slate-300">Categories</h3>
          <ul className="space-y-1 text-sm">
            {CATEGORIES.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className="w-full rounded-lg px-3 py-2 text-left text-slate-400 hover:bg-surface-700 hover:text-white"
                >
                  {c.label}
                </button>
              </li>
            ))}
          </ul>
          <h3 className="mb-2 mt-4 text-sm font-medium text-slate-300">Projects</h3>
          <ul className="space-y-1 text-sm">
            {(projectsQ.data ?? []).map((p) => (
              <li key={p.id}>
                <a
                  href={`/knowledge?project=${p.id}`}
                  className={`block rounded-lg px-3 py-2 hover:bg-surface-700 ${
                    projectFilter === p.id ? 'bg-brand-600/20 text-brand-400' : 'text-slate-400'
                  }`}
                >
                  {p.name}
                </a>
              </li>
            ))}
          </ul>
        </aside>

        <div className="lg:col-span-3">
          {docs.length === 0 ? (
            <EmptyState
              title="No knowledge documents yet"
              description="Add project docs, Magento standards, and client rules so agents produce better code with less hallucination."
              action={
                <button type="button" className="btn-primary" disabled>
                  Add Document (coming soon)
                </button>
              }
            />
          ) : (
            <ul className="space-y-2">
              {docs.map((d) => (
                <li key={d.id} className="card border-surface-700 bg-surface-800/80 p-4">
                  <p className="font-medium text-white">{d.title}</p>
                  <p className="text-xs text-slate-500">{d.category}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
