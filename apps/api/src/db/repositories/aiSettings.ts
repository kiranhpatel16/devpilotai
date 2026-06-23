import { v4 as uuid } from 'uuid';
import type { AiProviderId, AiUsage } from '@cpwork/shared';
import { getDb, nowIso } from '../index.js';

export interface AiProviderSettingRow {
  provider_id: string;
  enabled: number;
  api_key_enc: string | null;
  base_url: string | null;
  default_model: string | null;
  extra_json: string | null;
  updated_by: string | null;
  updated_at: string;
}

export interface AiProviderSetting {
  providerId: AiProviderId;
  enabled: boolean;
  apiKeyEnc: string | null;
  baseUrl: string | null;
  defaultModel: string | null;
  extra: Record<string, unknown>;
}

function mapRow(row: AiProviderSettingRow): AiProviderSetting {
  let extra: Record<string, unknown> = {};
  if (row.extra_json) {
    try {
      extra = JSON.parse(row.extra_json);
    } catch {
      extra = {};
    }
  }
  return {
    providerId: row.provider_id as AiProviderId,
    enabled: !!row.enabled,
    apiKeyEnc: row.api_key_enc,
    baseUrl: row.base_url,
    defaultModel: row.default_model,
    extra,
  };
}

export const aiSettingsRepo = {
  get(providerId: AiProviderId): AiProviderSetting | null {
    const row = getDb()
      .prepare('SELECT * FROM ai_provider_settings WHERE provider_id = ?')
      .get(providerId) as AiProviderSettingRow | undefined;
    return row ? mapRow(row) : null;
  },

  list(): AiProviderSetting[] {
    const rows = getDb()
      .prepare('SELECT * FROM ai_provider_settings')
      .all() as AiProviderSettingRow[];
    return rows.map(mapRow);
  },

  upsert(
    providerId: AiProviderId,
    fields: {
      enabled?: boolean;
      apiKeyEnc?: string | null;
      baseUrl?: string | null;
      defaultModel?: string | null;
      extra?: Record<string, unknown>;
    },
    updatedBy: string | null,
  ): AiProviderSetting {
    const existing = this.get(providerId);
    const merged = {
      enabled: fields.enabled ?? existing?.enabled ?? false,
      apiKeyEnc:
        fields.apiKeyEnc !== undefined ? fields.apiKeyEnc : (existing?.apiKeyEnc ?? null),
      baseUrl: fields.baseUrl !== undefined ? fields.baseUrl : (existing?.baseUrl ?? null),
      defaultModel:
        fields.defaultModel !== undefined
          ? fields.defaultModel
          : (existing?.defaultModel ?? null),
      extra: fields.extra ?? existing?.extra ?? {},
    };
    getDb()
      .prepare(
        `INSERT INTO ai_provider_settings
          (provider_id, enabled, api_key_enc, base_url, default_model, extra_json, updated_by, updated_at)
         VALUES (?,?,?,?,?,?,?,?)
         ON CONFLICT(provider_id) DO UPDATE SET
           enabled=excluded.enabled,
           api_key_enc=excluded.api_key_enc,
           base_url=excluded.base_url,
           default_model=excluded.default_model,
           extra_json=excluded.extra_json,
           updated_by=excluded.updated_by,
           updated_at=excluded.updated_at`,
      )
      .run(
        providerId,
        merged.enabled ? 1 : 0,
        merged.apiKeyEnc,
        merged.baseUrl,
        merged.defaultModel,
        JSON.stringify(merged.extra),
        updatedBy,
        nowIso(),
      );
    return this.get(providerId)!;
  },
};

export const runUsageRepo = {
  record(runId: string, usage: AiUsage): void {
    getDb()
      .prepare(
        `INSERT INTO run_ai_usage
          (id, run_id, provider_id, model, input_tokens, output_tokens, latency_ms, created_at)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(
        uuid(),
        runId,
        usage.provider,
        usage.model,
        usage.inputTokens,
        usage.outputTokens,
        usage.latencyMs,
        nowIso(),
      );
  },
};
