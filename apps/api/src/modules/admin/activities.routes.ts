import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { requireAuth, requireAdmin } from '../../middleware/auth.js';
import { activitiesRepo } from '../../db/repositories/activities.js';

const router = Router();
router.use(requireAuth, requireAdmin);

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(5),
});

// GET /api/admin/activities?limit=5
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { limit } = querySchema.parse(req.query);
    res.json({ activities: activitiesRepo.recent(limit) });
  }),
);

export default router;
