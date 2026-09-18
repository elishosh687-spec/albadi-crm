/**
 * Persistence for Eli's approved per-Ad-ID review state + its audit trail.
 *
 * One statement per save: the CTE reads the prior row, upserts the new values
 * and appends one audit row per field that actually changed — so a status is
 * never saved without its history, and the history always shows the real
 * previous value. Recalculating recommendations never calls this.
 */
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { logger } from "@/lib/observability/log";
import type { ApprovedStatus, ReviewState, ReviewStatePatch } from "./review-state";
import type { AdRole, AdSegment } from "./structure-check";

const log = logger("meta");

type Row = {
  ad_id: string;
  ad_set_id: string | null;
  segment: string | null;
  role: string | null;
  approved_status: string;
  decision_reason: string | null;
  decided_by: string | null;
  decided_at: string | null;
  updated_at: string | null;
};

const iso = (v: string | null) => (v ? new Date(v).toISOString() : null);

function toState(r: Row): ReviewState {
  return {
    adId: r.ad_id,
    adSetId: r.ad_set_id,
    segment: r.segment as AdSegment | null,
    role: r.role as AdRole | null,
    approvedStatus: r.approved_status as ApprovedStatus,
    decisionReason: r.decision_reason,
    decidedBy: r.decided_by,
    decidedAt: iso(r.decided_at),
    updatedAt: iso(r.updated_at),
  };
}

export async function listReviewState(): Promise<ReviewState[]> {
  const res = await db.execute<Row>(sql`SELECT * FROM ad_review_state ORDER BY ad_id`);
  return res.rows.map(toState);
}

export interface AuditEntry {
  field: string;
  oldValue: string | null;
  newValue: string | null;
  reason: string | null;
  actor: string | null;
  createdAt: string;
}

export async function getReviewState(
  adId: string,
): Promise<{ state: ReviewState | null; audit: AuditEntry[] }> {
  const [row, audit] = await Promise.all([
    db.execute<Row>(sql`SELECT * FROM ad_review_state WHERE ad_id = ${adId}`),
    db.execute<{ field: string; old_value: string | null; new_value: string | null; reason: string | null; actor: string | null; created_at: string }>(
      sql`SELECT field, old_value, new_value, reason, actor, created_at FROM ad_review_state_audit
          WHERE ad_id = ${adId} ORDER BY created_at DESC, id DESC LIMIT 50`,
    ),
  ]);
  return {
    state: row.rows[0] ? toState(row.rows[0]) : null,
    audit: audit.rows.map((a) => ({
      field: a.field,
      oldValue: a.old_value,
      newValue: a.new_value,
      reason: a.reason,
      actor: a.actor,
      createdAt: new Date(a.created_at).toISOString(),
    })),
  };
}

/** Column names are fixed here — never interpolated from input. */
const COLUMNS: Record<keyof ReviewStatePatch, { col: string; field: string }> = {
  approvedStatus: { col: "approved_status", field: "approved_status" },
  segment: { col: "segment", field: "segment" },
  role: { col: "role", field: "role" },
  adSetId: { col: "ad_set_id", field: "ad_set_id" },
};

export async function setReviewState(
  adId: string,
  patch: ReviewStatePatch,
  opts: { reason: string | null; actor: string | null },
): Promise<{ state: ReviewState; changedFields: string[] }> {
  const keys = (Object.keys(patch) as (keyof ReviewStatePatch)[]).filter((k) => patch[k] !== undefined);
  const val = (k: keyof ReviewStatePatch) => (patch[k] === undefined ? null : (patch[k] as string | null));
  const has = (k: keyof ReviewStatePatch) => keys.includes(k);
  const statusChanging = has("approvedStatus");

  // For each column: take the patched value when present, else keep the old one.
  const pick = (k: keyof ReviewStatePatch) =>
    has(k) ? sql`${val(k)}::text` : sql.raw(`(SELECT ${COLUMNS[k].col} FROM old)`);

  const changes = keys.map(
    (k) => sql`(${COLUMNS[k].field}::text, (SELECT ${sql.raw(COLUMNS[k].col)} FROM old), ${val(k)}::text)`,
  );

  const res = await db.execute<Row & { changed: string[] | null }>(sql`
    WITH old AS (
      SELECT * FROM ad_review_state WHERE ad_id = ${adId}
    ),
    up AS (
      INSERT INTO ad_review_state (ad_id, ad_set_id, segment, role, approved_status,
                                   decision_reason, decided_by, decided_at, updated_at)
      VALUES (
        ${adId},
        ${pick("adSetId")},
        ${pick("segment")},
        ${pick("role")},
        COALESCE(${pick("approvedStatus")}, 'untested'),
        ${statusChanging ? sql`${opts.reason}::text` : sql`(SELECT decision_reason FROM old)`},
        ${statusChanging ? sql`${opts.actor}::text` : sql`(SELECT decided_by FROM old)`},
        ${statusChanging ? sql`now()` : sql`(SELECT decided_at FROM old)`},
        now()
      )
      ON CONFLICT (ad_id) DO UPDATE SET
        ad_set_id = excluded.ad_set_id,
        segment = excluded.segment,
        role = excluded.role,
        approved_status = excluded.approved_status,
        decision_reason = excluded.decision_reason,
        decided_by = excluded.decided_by,
        decided_at = excluded.decided_at,
        updated_at = excluded.updated_at
      RETURNING *
    ),
    changes(field, old_value, new_value) AS (VALUES ${sql.join(changes, sql`, `)}),
    aud AS (
      INSERT INTO ad_review_state_audit (ad_id, field, old_value, new_value, reason, actor)
      SELECT ${adId}, c.field, c.old_value, c.new_value, ${opts.reason}, ${opts.actor}
      FROM changes c
      WHERE c.old_value IS DISTINCT FROM c.new_value
        -- A brand-new row starts at 'untested'; recording that as a change is noise.
        AND NOT (c.field = 'approved_status' AND c.old_value IS NULL AND c.new_value = 'untested')
      RETURNING field
    )
    SELECT up.*, (SELECT array_agg(field) FROM aud) AS changed FROM up`);

  const row = res.rows[0];
  const changedFields = row.changed ?? [];
  log.info("ads_review_state.changed", { adId, fields: changedFields });
  return { state: toState(row), changedFields };
}
