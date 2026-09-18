/**
 * Eli's approved, per-exact-Ad-ID review state — the historical business
 * decision, separate from the live recommendation (which is derived and never
 * stored as a status). Client-safe types + validation; persistence lives in
 * review-state-store.ts.
 *
 * Changing it is an internal CRM decision only. It never calls Meta.
 */
import { normalizeAdId } from "./ad-id";
import type { AdRole, AdSegment } from "./structure-check";

export const APPROVED_STATUSES = ["untested", "testing", "winner", "loser"] as const;
export type ApprovedStatus = (typeof APPROVED_STATUSES)[number];

export const APPROVED_STATUS_LABELS: Record<ApprovedStatus, string> = {
  untested: "לא נוסתה",
  testing: "בבדיקה / אין הכרעה",
  winner: "מנצחת",
  loser: "מפסידה",
};

export const SEGMENTS: readonly AdSegment[] = ["prospecting", "remarketing"];
export const ROLES: readonly AdRole[] = ["control", "challenger", "remarketing"];

export interface ReviewState {
  adId: string;
  adSetId: string | null;
  segment: AdSegment | null;
  role: AdRole | null;
  approvedStatus: ApprovedStatus;
  decisionReason: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  updatedAt: string | null;
}

/** Fields a save may change. `null` clears segment/role/adSetId. */
export interface ReviewStatePatch {
  approvedStatus?: ApprovedStatus;
  segment?: AdSegment | null;
  role?: AdRole | null;
  adSetId?: string | null;
}

export type PatchValidation =
  | { ok: true; adId: string; patch: ReviewStatePatch; reason: string | null }
  | { ok: false; error: string };

export function validateReviewPatch(rawAdId: string, body: unknown): PatchValidation {
  const adId = normalizeAdId(rawAdId);
  if (!adId) return { ok: false, error: "Ad ID לא תקין — נדרש מזהה מספרי מדויק של מודעה" };
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "גוף הבקשה חסר" };
  }
  const b = body as Record<string, unknown>;
  const allowed = new Set(["approvedStatus", "segment", "role", "adSetId", "reason"]);
  const unknown = Object.keys(b).filter((k) => !allowed.has(k));
  if (unknown.length) return { ok: false, error: `שדה לא מוכר: ${unknown.join(", ")}` };

  const patch: ReviewStatePatch = {};
  if ("approvedStatus" in b) {
    if (!APPROVED_STATUSES.includes(b.approvedStatus as ApprovedStatus)) {
      return { ok: false, error: "סטטוס מאושר לא תקין" };
    }
    patch.approvedStatus = b.approvedStatus as ApprovedStatus;
  }
  if ("segment" in b) {
    if (b.segment !== null && !SEGMENTS.includes(b.segment as AdSegment)) {
      return { ok: false, error: "סגמנט לא תקין" };
    }
    patch.segment = b.segment as AdSegment | null;
  }
  if ("role" in b) {
    if (b.role !== null && !ROLES.includes(b.role as AdRole)) {
      return { ok: false, error: "תפקיד לא תקין" };
    }
    patch.role = b.role as AdRole | null;
  }
  if ("adSetId" in b) {
    const set = b.adSetId === null ? null : normalizeAdId(String(b.adSetId));
    if (b.adSetId !== null && !set) return { ok: false, error: "Ad Set ID לא תקין" };
    patch.adSetId = set;
  }
  if (Object.keys(patch).length === 0) return { ok: false, error: "אין מה לשמור" };

  const reason = typeof b.reason === "string" && b.reason.trim() ? b.reason.trim() : null;
  if (patch.approvedStatus !== undefined && !reason) {
    return { ok: false, error: "שינוי סטטוס מאושר מחייב סיבה" };
  }
  return { ok: true, adId, patch, reason };
}
