import { Router } from 'express';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { requireAuth } from '../../middleware/auth.js';
import { enabledProviderInfo } from './providers/registry.js';

const router = Router();
router.use(requireAuth);

// GET /api/ai/providers — providers usable by the current user (no secrets).
router.get(
  '/providers',
  asyncHandler(async (_req, res) => {
    res.json({ providers: enabledProviderInfo() });
  }),
);

export default router;
