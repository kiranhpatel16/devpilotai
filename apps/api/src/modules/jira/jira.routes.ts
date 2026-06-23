import { Router } from 'express';
import { isAdminRole, type GlobalRole } from '@cpwork/shared';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { requireAuth } from '../../middleware/auth.js';
import { HttpError } from '../../lib/httpError.js';
import { projectRolesRepo } from '../../db/repositories/projectRoles.js';
import { usersRepo } from '../../db/repositories/users.js';
import { getBoard, getIssueDetail, resolveJira } from './jira.service.js';

// mergeParams so :projectId from the mount path is available here.
const router = Router({ mergeParams: true });
router.use(requireAuth);

function assertAccess(req: { auth?: { sub: string; role: string } }, projectId: string) {
  const auth = req.auth!;
  if (isAdminRole(auth.role as GlobalRole)) return;
  if (!projectRolesRepo.getRole(auth.sub, projectId)) {
    throw HttpError.forbidden('You are not assigned to this project');
  }
}

// GET /api/projects/:projectId/jira/tasks?scope=mine|all
router.get(
  '/tasks',
  asyncHandler(async (req, res) => {
    const projectId = req.params.projectId;
    assertAccess(req, projectId);

    const scope = req.query.scope === 'all' ? 'all' : 'mine';

    if (scope === 'mine') {
      const me = usersRepo.findById(req.auth!.sub);
      const assigneeValue = me?.jiraAccountId ?? null;
      if (!assigneeValue) {
        // No Jira identity yet: don't guess, prompt the user to set it.
        const resolved = resolveJira(projectId);
        return res.json({
          board: {
            configured: !!resolved,
            projectKey: resolved?.project.jira.projectKey ?? null,
            message: resolved
              ? 'Set your Jira account to see tasks assigned to you.'
              : 'Jira is not configured for this project. Ask an admin to add credentials.',
            groups: [],
            total: 0,
            scope,
            needsJiraIdentity: true,
          },
        });
      }
      const board = await getBoard(projectId, { assigneeValue });
      return res.json({ board: { ...board, scope, needsJiraIdentity: false } });
    }

    const board = await getBoard(projectId, {});
    return res.json({ board: { ...board, scope, needsJiraIdentity: false } });
  }),
);

// GET /api/projects/:projectId/jira/issues/:key
router.get(
  '/issues/:key',
  asyncHandler(async (req, res) => {
    const projectId = req.params.projectId;
    assertAccess(req, projectId);
    res.json({ issue: await getIssueDetail(projectId, req.params.key) });
  }),
);

export default router;
