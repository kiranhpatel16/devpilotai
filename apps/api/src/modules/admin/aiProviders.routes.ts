import { Router } from 'express';
import { z } from 'zod';
import type { AiProviderId } from '@cpwork/shared';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { requireAuth, requireAdmin } from '../../middleware/auth.js';
import { HttpError } from '../../lib/httpError.js';
import { encryptSecret } from '../../lib/crypto.js';
import { aiSettingsRepo } from '../../db/repositories/aiSettings.js';
import { PROVIDER_CATALOG, PROVIDER_IDS } from '../ai/providers/catalog.js';
import {
  getAdapter,
  listProviderInfo,
  resolveCreds,
} from '../ai/providers/registry.js';

const router = Router();
router.use(requireAuth, requireAdmin);

function assertProviderId(id: string): AiProviderId {
  if (!PROVIDER_IDS.includes(id as AiProviderId)) {
    throw HttpError.notFound('Unknown provider');
  }
  return id as AiProviderId;
}

const updateSchema = z.object({
  enabled: z.boolean().optional(),
  apiKey: z.string().nullable().optional(),
  baseUrl: z.string().nullable().optional(),
  defaultModel: z.string().nullable().optional(),
});

// GET /api/admin/ai-providers
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({ providers: listProviderInfo() });
  }),
);

// PUT /api/admin/ai-providers/:id
router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = assertProviderId(req.params.id);
    const input = updateSchema.parse(req.body);

    const fields: Parameters<typeof aiSettingsRepo.upsert>[1] = {};
    if (input.enabled !== undefined) fields.enabled = input.enabled;
    if (input.baseUrl !== undefined) fields.baseUrl = input.baseUrl;
    if (input.defaultModel !== undefined) fields.defaultModel = input.defaultModel;
    if (input.apiKey !== undefined) {
      fields.apiKeyEnc = input.apiKey ? encryptSecret(input.apiKey) : null;
    }

    aiSettingsRepo.upsert(id, fields, req.auth!.sub);
    res.json({ providers: listProviderInfo() });
  }),
);

// POST /api/admin/ai-providers/:id/test
router.post(
  '/:id/test',
  asyncHandler(async (req, res) => {
    const id = assertProviderId(req.params.id);
    const { creds } = resolveCreds(id);
    await getAdapter(id).verify(creds);
    res.json({ ok: true, provider: id, label: PROVIDER_CATALOG[id].label });
  }),
);

export default router;
