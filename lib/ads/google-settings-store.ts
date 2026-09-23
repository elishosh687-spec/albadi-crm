/**
 * Persistence for "הגדרות ← שיווק · גוגל". One `app_config` row,
 * key `ads.google.settings`: { schemaVersion, revision, settings, updatedAt,
 * actor, history[] } — history kept in the same document (newest first,
 * capped), so a save is ONE conditional statement and needs no new table.
 * Two saves from the same `expectedRevision` cannot both land.
 *
 * Nothing here talks to Google Ads.
 */
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { logger } from "@/lib/observability/log";
import {
  GOOGLE_DEFAULTS_2026_09_23,
  GOOGLE_SETTINGS_SCHEMA_VERSION,
  changedGoogleKeys,
  validateGoogleSettings,
  type GoogleAdsSettings,
  type GoogleSettingsError,
} from "./google-settings";

const log = logger("google");
export const GOOGLE_SETTINGS_KEY = "ads.google.settings";
const HISTORY_CAP = 30;

export interface GoogleRevision {
  revision: number;
  changedKeys: string[];
  actor: string | null;
  createdAt: string;
}

export interface StoredGooglePolicy {
  revision: number;
  settings: GoogleAdsSettings;
  updatedAt: string | null;
  actor: string | null;
  isDefault: boolean;
  history: GoogleRevision[];
}

const DEFAULT: StoredGooglePolicy = {
  revision: 0,
  settings: GOOGLE_DEFAULTS_2026_09_23,
  updatedAt: null,
  actor: null,
  isDefault: true,
  history: [],
};

export async function getGooglePolicy(): Promise<StoredGooglePolicy> {
  const res = await db.execute<{ value: any }>(sql`SELECT value FROM app_config WHERE key = ${GOOGLE_SETTINGS_KEY} LIMIT 1`);
  const doc = res.rows[0]?.value;
  if (!doc) return DEFAULT;
  const v = validateGoogleSettings(doc.settings);
  if (!v.ok) {
    log.error("google_settings.stored_invalid", new Error("invalid stored google settings"), { errors: v.errors.map((e) => e.path) });
    return { ...DEFAULT, revision: Number(doc.revision) || 0, history: Array.isArray(doc.history) ? doc.history : [] };
  }
  return {
    revision: Number(doc.revision) || 0,
    settings: v.value,
    updatedAt: doc.updatedAt ?? null,
    actor: doc.actor ?? null,
    isDefault: false,
    history: Array.isArray(doc.history) ? doc.history : [],
  };
}

export type GoogleSaveResult =
  | { ok: true; policy: StoredGooglePolicy; changedKeys: string[] }
  | { ok: false; kind: "invalid"; errors: GoogleSettingsError[] }
  | { ok: false; kind: "stale_revision"; currentRevision: number }
  | { ok: false; kind: "no_change" };

export async function saveGooglePolicy(raw: unknown, opts: { expectedRevision: number; actor: string | null }): Promise<GoogleSaveResult> {
  const v = validateGoogleSettings(raw);
  if (!v.ok) return { ok: false, kind: "invalid", errors: v.errors };

  const current = await getGooglePolicy();
  if (current.revision !== opts.expectedRevision) return { ok: false, kind: "stale_revision", currentRevision: current.revision };
  const changedKeys = changedGoogleKeys(current.isDefault ? null : current.settings, v.value);
  if (!current.isDefault && changedKeys.length === 0) return { ok: false, kind: "no_change" };

  const revision = opts.expectedRevision + 1;
  const now = new Date().toISOString();
  const history: GoogleRevision[] = [{ revision, changedKeys, actor: opts.actor, createdAt: now }, ...current.history].slice(0, HISTORY_CAP);
  const doc = { schemaVersion: GOOGLE_SETTINGS_SCHEMA_VERSION, revision, settings: v.value, updatedAt: now, actor: opts.actor, history };

  // Insert when absent; update only when the stored revision is still the one
  // the editor started from. One statement → atomic.
  const res = await db.execute<{ revision: number }>(sql`
    INSERT INTO app_config (key, value, updated_at)
    VALUES (${GOOGLE_SETTINGS_KEY}, ${JSON.stringify(doc)}::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      WHERE COALESCE((app_config.value->>'revision')::int, 0) = ${opts.expectedRevision}
    RETURNING (value->>'revision')::int AS revision`);
  if (res.rows.length === 0) {
    const latest = await getGooglePolicy();
    return { ok: false, kind: "stale_revision", currentRevision: latest.revision };
  }
  log.info("google_settings.saved", { revision, changedKeys });
  return {
    ok: true,
    changedKeys,
    policy: { revision, settings: v.value, updatedAt: now, actor: opts.actor, isDefault: false, history },
  };
}
