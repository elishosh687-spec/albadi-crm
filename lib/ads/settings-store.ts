/**
 * Persistence for the ad-recommendation policy ("מודעות → הגדרות בדיקה").
 *
 * Current policy: `app_config` key `ads.recommendation.settings`
 *   { schemaVersion, revision, settings, updatedAt, actor }.
 * History: `ad_recommendation_policy_revisions`, one append-only row per save.
 *
 * A save is ONE SQL statement — a data-modifying CTE that inserts the revision
 * row and upserts app_config together — so the two can never disagree. Neon's
 * HTTP driver has no interactive transaction; a single statement is atomic.
 * The revision is the primary key, so two saves racing from the same
 * `expectedRevision` cannot both land: the loser gets `stale_revision`.
 *
 * Changing the policy changes derived recommendations only. It never touches
 * an approved manual status, and nothing here talks to Meta.
 */
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { logger } from "@/lib/observability/log";
import {
  APPROVED_DEFAULTS_2026_09_18,
  SETTINGS_SCHEMA_VERSION,
  changedSettingKeys,
  normalizeStoredSettings,
  validateSettings,
  type AdRecommendationSettings,
  type SettingsError,
} from "./recommendation-settings";

const log = logger("meta");

export const AD_SETTINGS_KEY = "ads.recommendation.settings";

export interface StoredPolicy {
  revision: number;
  settings: AdRecommendationSettings;
  updatedAt: string | null;
  actor: string | null;
  /** True when nothing was ever saved and these are the approved defaults. */
  isDefault: boolean;
}

export interface RevisionSummary {
  revision: number;
  changedKeys: string[];
  actor: string | null;
  createdAt: string;
}

const DEFAULT_POLICY: StoredPolicy = {
  revision: 0,
  settings: APPROVED_DEFAULTS_2026_09_18,
  updatedAt: null,
  actor: null,
  isDefault: true,
};

export async function getAdRecommendationPolicy(): Promise<StoredPolicy> {
  const res = await db.execute<{ value: any }>(
    sql`SELECT value FROM app_config WHERE key = ${AD_SETTINGS_KEY} LIMIT 1`,
  );
  const doc = res.rows[0]?.value;
  if (!doc) return DEFAULT_POLICY;

  const norm = normalizeStoredSettings(doc.settings);
  if (norm.ok) {
    return {
      revision: Number(doc.revision) || 0,
      settings: norm.value,
      updatedAt: doc.updatedAt ?? null,
      actor: doc.actor ?? null,
      isDefault: false,
    };
  }

  // The stored document is invalid (hand-edited row, or a schema change that
  // broke it). Never run on it — fall back to the newest revision that still
  // validates, and say so loudly.
  log.error("ads_settings.stored_invalid", new Error("invalid stored policy"), {
    revision: doc.revision,
    errors: norm.errors.map((e) => e.path),
  });
  const hist = await db.execute<{ revision: number; settings: unknown; actor: string | null; created_at: string }>(
    sql`SELECT revision, settings, actor, created_at FROM ad_recommendation_policy_revisions
        ORDER BY revision DESC LIMIT 20`,
  );
  for (const row of hist.rows) {
    const r = normalizeStoredSettings(row.settings);
    if (r.ok) {
      return {
        revision: Number(row.revision),
        settings: r.value,
        updatedAt: String(row.created_at),
        actor: row.actor,
        isDefault: false,
      };
    }
  }
  return DEFAULT_POLICY;
}

export type SaveResult =
  | { ok: true; policy: StoredPolicy; changedKeys: string[] }
  | { ok: false; kind: "invalid"; errors: SettingsError[] }
  | { ok: false; kind: "stale_revision"; currentRevision: number }
  | { ok: false; kind: "no_change" };

export async function saveAdRecommendationPolicy(
  raw: unknown,
  opts: { expectedRevision: number; actor: string | null },
): Promise<SaveResult> {
  const v = validateSettings(raw);
  if (!v.ok) {
    log.warn("ads_settings.rejected", { errors: v.errors.map((e) => e.path) });
    return { ok: false, kind: "invalid", errors: v.errors };
  }

  const current = await getAdRecommendationPolicy();
  if (current.revision !== opts.expectedRevision) {
    return { ok: false, kind: "stale_revision", currentRevision: current.revision };
  }
  const changedKeys = changedSettingKeys(current.isDefault ? null : current.settings, v.value);
  if (!current.isDefault && changedKeys.length === 0) return { ok: false, kind: "no_change" };

  const revision = opts.expectedRevision + 1;
  const now = new Date().toISOString();
  const doc = {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    revision,
    settings: v.value,
    updatedAt: now,
    actor: opts.actor,
  };
  const previous = current.isDefault ? null : current.settings;
  const keysLiteral = `{${changedKeys.map((k) => `"${k}"`).join(",")}}`;

  const res = await db.execute<{ revision: number }>(sql`
    WITH ins AS (
      INSERT INTO ad_recommendation_policy_revisions (revision, settings, previous, changed_keys, actor)
      VALUES (${revision}, ${JSON.stringify(v.value)}::jsonb, ${previous === null ? null : JSON.stringify(previous)}::jsonb,
              ${keysLiteral}::text[], ${opts.actor})
      ON CONFLICT (revision) DO NOTHING
      RETURNING revision
    )
    INSERT INTO app_config (key, value, updated_at)
    SELECT ${AD_SETTINGS_KEY}, ${JSON.stringify(doc)}::jsonb, now() FROM ins
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    RETURNING (value->>'revision')::int AS revision`);

  if (res.rows.length === 0) {
    // Someone else took this revision number between our read and our write.
    const latest = await getAdRecommendationPolicy();
    return { ok: false, kind: "stale_revision", currentRevision: latest.revision };
  }

  log.info("ads_settings.saved", { revision, changedKeys });
  return {
    ok: true,
    changedKeys,
    policy: { revision, settings: v.value, updatedAt: now, actor: opts.actor, isDefault: false },
  };
}

export async function listPolicyRevisions(limit = 20): Promise<RevisionSummary[]> {
  const res = await db.execute<{ revision: number; changed_keys: string[]; actor: string | null; created_at: string }>(
    sql`SELECT revision, changed_keys, actor, created_at FROM ad_recommendation_policy_revisions
        ORDER BY revision DESC LIMIT ${limit}`,
  );
  return res.rows.map((r) => ({
    revision: Number(r.revision),
    changedKeys: r.changed_keys ?? [],
    actor: r.actor,
    createdAt: new Date(r.created_at).toISOString(),
  }));
}
