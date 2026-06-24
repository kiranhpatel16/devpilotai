import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';

export function CustomTasksPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Custom Tasks" subtitle="Ad-hoc tasks without a Jira ticket" />
      <EmptyState
        title="No custom tasks"
        description="Start a custom task from a workspace task board."
      />
    </div>
  );
}
