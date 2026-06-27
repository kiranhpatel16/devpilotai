import type {
  AiReviewReport,
  ArchitectureDesign,
  PlanTask,
  RequirementAnalysis,
  WorkflowTestCase,
} from '@cpwork/shared';
import { ChevronDown, ChevronRight, Loader2, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { taskBody, taskMuted, taskPanel, taskPanelHeader, taskStrong, taskTitle } from './taskStyles';

function CollapsibleArtifact({
  title,
  defaultOpen = false,
  headerActions,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  headerActions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={taskPanel}>
      <div className={`${taskPanelHeader} flex w-full items-center justify-between gap-2`}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <h3 className={taskTitle}>{title}</h3>
          {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
        </button>
        {headerActions ? <span className="shrink-0">{headerActions}</span> : null}
      </div>
      {open && <div className="space-y-3 p-4 text-sm">{children}</div>}
    </div>
  );
}

function ComplexityBadge({ value }: { value?: string }) {
  if (!value) return null;
  const colors: Record<string, string> = {
    S: 'bg-emerald-500/20 text-emerald-300',
    M: 'bg-blue-500/20 text-blue-300',
    L: 'bg-amber-500/20 text-amber-300',
    XL: 'bg-red-500/20 text-red-300',
  };
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${colors[value] ?? 'bg-slate-500/20 text-slate-300'}`}
    >
      {value}
    </span>
  );
}

export function RequirementAnalysisBody({
  analysis,
}: {
  analysis: RequirementAnalysis;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <ComplexityBadge value={analysis.estimatedComplexity} />
        {analysis.objective && (
          <span className={`text-xs ${taskMuted}`}>Objective defined</span>
        )}
      </div>
      {analysis.objective && (
        <div>
          <p className={`text-xs font-medium uppercase ${taskMuted}`}>Objective</p>
          <p className={taskBody}>{analysis.objective}</p>
        </div>
      )}
      {analysis.summary && (
        <div>
          <p className={`text-xs font-medium uppercase ${taskMuted}`}>Summary</p>
          <p className={taskBody}>{analysis.summary}</p>
        </div>
      )}
      {analysis.functionalRequirements?.length ? (
        <div>
          <p className={`text-xs font-medium uppercase ${taskMuted}`}>Functional requirements</p>
          <ul className="list-inside list-disc space-y-1">
            {analysis.functionalRequirements.map((r, i) => (
              <li key={i} className={taskBody}>{r}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {analysis.nonFunctionalRequirements?.length ? (
        <div>
          <p className={`text-xs font-medium uppercase ${taskMuted}`}>Non-functional requirements</p>
          <ul className="list-inside list-disc space-y-1">
            {analysis.nonFunctionalRequirements.map((r, i) => (
              <li key={i} className={taskBody}>{r}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {analysis.likelyFiles?.length ? (
        <div>
          <p className={`text-xs font-medium uppercase ${taskMuted}`}>Files likely to change</p>
          <ul className="font-mono text-xs text-slate-300">
            {analysis.likelyFiles.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {analysis.risks?.length ? (
        <div>
          <p className={`text-xs font-medium uppercase ${taskMuted}`}>Risks</p>
          <ul className="space-y-1">
            {analysis.risks.map((r, i) => (
              <li key={i} className="text-xs">
                <span className={taskStrong}>{r.level}</span>: {r.description}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {analysis.assumptions?.length ? (
        <div>
          <p className={`text-xs font-medium uppercase ${taskMuted}`}>Assumptions</p>
          <ul className="list-inside list-disc space-y-1">
            {analysis.assumptions.map((a, i) => (
              <li key={i} className={taskBody}>{a}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {analysis.questions?.length ? (
        <div>
          <p className={`text-xs font-medium uppercase ${taskMuted}`}>Questions</p>
          <ul className="list-inside list-disc text-amber-200/90">
            {analysis.questions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function RequirementAnalysisView({
  analysis,
  defaultOpen,
  onRegenerate,
  regenerating,
}: {
  analysis: RequirementAnalysis | null | undefined;
  defaultOpen?: boolean;
  onRegenerate?: () => void;
  regenerating?: boolean;
}) {
  if (!analysis && !regenerating) {
    return (
      <p className={`text-sm ${taskMuted}`}>Requirement analysis not generated yet.</p>
    );
  }
  return (
    <CollapsibleArtifact
      title="Requirement Analysis"
      defaultOpen={defaultOpen}
      headerActions={
        onRegenerate ? (
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-400 hover:bg-slate-700/40 hover:text-white"
            disabled={regenerating}
            onClick={(e) => {
              e.stopPropagation();
              onRegenerate();
            }}
          >
            {regenerating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Regenerate
          </button>
        ) : undefined
      }
    >
      {analysis ? <RequirementAnalysisBody analysis={analysis} /> : null}
    </CollapsibleArtifact>
  );
}

export function ArchitectureDesignBody({ design }: { design: ArchitectureDesign }) {
  return (
    <div className="space-y-3">
      {design.systemOverview && (
        <div>
          <p className={`text-xs font-medium uppercase ${taskMuted}`}>System overview</p>
          <p className={`whitespace-pre-wrap ${taskBody}`}>{design.systemOverview}</p>
        </div>
      )}
      {design.filesToModify?.length ? (
        <div>
          <p className={`text-xs font-medium uppercase ${taskMuted}`}>Files to modify</p>
          <ul className="font-mono text-xs">{design.filesToModify.map((f) => <li key={f}>{f}</li>)}</ul>
        </div>
      ) : null}
      {design.componentDiagram && (
        <div>
          <p className={`text-xs font-medium uppercase ${taskMuted}`}>Component diagram</p>
          <pre className="overflow-x-auto rounded bg-slate-900/60 p-3 text-xs">{design.componentDiagram}</pre>
        </div>
      )}
      {design.databaseImpact && (
        <div>
          <p className={`text-xs font-medium uppercase ${taskMuted}`}>Database impact</p>
          <p className={taskBody}>{design.databaseImpact}</p>
        </div>
      )}
      {design.apiChanges?.length ? (
        <div>
          <p className={`text-xs font-medium uppercase ${taskMuted}`}>API changes</p>
          <ul className="list-inside list-disc">{design.apiChanges.map((c) => <li key={c}>{c}</li>)}</ul>
        </div>
      ) : null}
      {design.frontendChanges?.length ? (
        <div>
          <p className={`text-xs font-medium uppercase ${taskMuted}`}>Frontend changes</p>
          <ul className="list-inside list-disc">{design.frontendChanges.map((c) => <li key={c}>{c}</li>)}</ul>
        </div>
      ) : null}
      {design.backendChanges?.length ? (
        <div>
          <p className={`text-xs font-medium uppercase ${taskMuted}`}>Backend changes</p>
          <ul className="list-inside list-disc">{design.backendChanges.map((c) => <li key={c}>{c}</li>)}</ul>
        </div>
      ) : null}
      {design.risks?.length ? (
        <div>
          <p className={`text-xs font-medium uppercase ${taskMuted}`}>Risks</p>
          <ul className="space-y-1">
            {design.risks.map((r, i) => (
              <li key={i} className="text-xs">
                <span className={taskStrong}>{r.level}</span>: {r.description}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function ArchitectureDesignView({
  design,
  defaultOpen,
}: {
  design: ArchitectureDesign | null | undefined;
  defaultOpen?: boolean;
}) {
  if (!design) {
    return <p className={`text-sm ${taskMuted}`}>Architecture design not generated yet.</p>;
  }
  return (
    <CollapsibleArtifact title="Architecture Design" defaultOpen={defaultOpen}>
      <ArchitectureDesignBody design={design} />
    </CollapsibleArtifact>
  );
}

export function DevelopmentPlanBody({
  planMarkdown,
  planTasks,
}: {
  planMarkdown: string | null | undefined;
  planTasks: PlanTask[] | null | undefined;
}) {
  const totalMins = planTasks?.reduce((s, t) => s + (t.estimatedMinutes ?? 0), 0) ?? 0;
  return (
    <div className="space-y-3">
      {planTasks?.length ? (
        <ol className="space-y-2">
          {planTasks.map((t) => (
            <li key={t.id} className="flex items-start justify-between gap-2 rounded border border-slate-700/40 px-3 py-2">
              <span className={taskBody}>{t.title}</span>
              {t.estimatedMinutes != null && (
                <span className={`shrink-0 text-xs ${taskMuted}`}>{t.estimatedMinutes} min</span>
              )}
            </li>
          ))}
        </ol>
      ) : null}
      {totalMins > 0 && (
        <p className={`text-xs font-medium ${taskMuted}`}>Total estimated: {totalMins} min</p>
      )}
      {planMarkdown && (
        <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap rounded bg-slate-900/40 p-3 text-xs">
          {planMarkdown}
        </pre>
      )}
    </div>
  );
}

export function DevelopmentPlanView({
  planMarkdown,
  planTasks,
  defaultOpen,
}: {
  planMarkdown: string | null | undefined;
  planTasks: PlanTask[] | null | undefined;
  defaultOpen?: boolean;
}) {
  if (!planMarkdown && !planTasks?.length) {
    return <p className={`text-sm ${taskMuted}`}>Development plan not generated yet.</p>;
  }
  return (
    <CollapsibleArtifact title="Development Plan" defaultOpen={defaultOpen}>
      <DevelopmentPlanBody planMarkdown={planMarkdown} planTasks={planTasks} />
    </CollapsibleArtifact>
  );
}

export function TestCasesBody({ testCases }: { testCases: WorkflowTestCase[] }) {
  return (
    <ul className="space-y-2">
      {testCases.map((tc) => (
        <li key={tc.id} className="rounded border border-slate-700/40 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className={`font-mono text-xs ${taskMuted}`}>{tc.id}</span>
            <span className="text-xs text-emerald-400">Expected: {tc.expected ?? 'PASS'}</span>
          </div>
          <p className={`mt-1 text-sm ${taskBody}`}>{tc.title}</p>
          {tc.type && <p className={`text-xs ${taskMuted}`}>Type: {tc.type}</p>}
          {tc.steps && <p className={`mt-1 text-xs ${taskMuted}`}>{tc.steps}</p>}
        </li>
      ))}
    </ul>
  );
}

export function TestCasesView({
  testCases,
  defaultOpen,
}: {
  testCases: WorkflowTestCase[] | null | undefined;
  defaultOpen?: boolean;
}) {
  if (!testCases?.length) {
    return <p className={`text-sm ${taskMuted}`}>Test cases not generated yet.</p>;
  }
  return (
    <CollapsibleArtifact title="Test Cases" defaultOpen={defaultOpen}>
      <TestCasesBody testCases={testCases} />
    </CollapsibleArtifact>
  );
}

export function AiReviewReportBody({ report }: { report: AiReviewReport }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {report.codeQualityScore != null && (
          <span className="rounded-full bg-brand-600/20 px-2.5 py-1 text-xs font-medium text-brand-300">
            Quality {report.codeQualityScore}%
          </span>
        )}
        {report.securityOk != null && (
          <span className={`rounded-full px-2.5 py-1 text-xs ${report.securityOk ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300'}`}>
            Security {report.securityOk ? '✓' : '✗'}
          </span>
        )}
        {report.magentoStandardsOk != null && (
          <span className={`rounded-full px-2.5 py-1 text-xs ${report.magentoStandardsOk ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'}`}>
            Standards {report.magentoStandardsOk ? '✓' : '✗'}
          </span>
        )}
      </div>
      {report.summary && <p className={taskBody}>{report.summary}</p>}
      {report.issues?.length ? (
        <ul className="space-y-1">
          {report.issues.map((issue, i) => (
            <li key={i} className="text-xs">
              <span className={taskStrong}>{issue.severity}</span>: {issue.message}
              {issue.file && <span className={taskMuted}> ({issue.file})</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-emerald-400">No issues found.</p>
      )}
    </div>
  );
}

export function AiReviewReportView({
  report,
  defaultOpen = true,
}: {
  report: AiReviewReport | null | undefined;
  defaultOpen?: boolean;
}) {
  if (!report) {
    return <p className={`text-sm ${taskMuted}`}>Run AI review to see the report.</p>;
  }
  return (
    <CollapsibleArtifact title="AI Code Review" defaultOpen={defaultOpen}>
      <AiReviewReportBody report={report} />
    </CollapsibleArtifact>
  );
}
