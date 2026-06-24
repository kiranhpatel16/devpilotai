import { EmptyState } from '../components/ui/EmptyState';
import { isAdminRole } from '@cpwork/shared';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export function WorkspacesEmptyPage() {
  const { session } = useAuth();
  const admin = session ? isAdminRole(session.user.globalRole) : false;

  return (
    <EmptyState
      title="No workspaces yet"
      description={
        admin
          ? 'Create a project to start working with Jira tasks and agents.'
          : 'Ask an administrator to assign you to a project.'
      }
      action={
        admin ? (
          <Link to="/settings/projects" className="btn-primary">
            Add project →
          </Link>
        ) : undefined
      }
    />
  );
}
