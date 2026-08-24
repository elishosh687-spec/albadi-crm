/**
 * "Albadi Lead Score" — HOT | WARM | COLD.
 *
 * SINGLE SOURCE OF TRUTH: the GHL **CONTACT** custom field
 * `contact.albadi_lead_score` (id `zneBwsG0dSB3ajj8lnjv`). `leads.albadi_lead_score`
 * is a mirror, kept in sync by the GHL resync webhook — same GHL-owns/DB-follows
 * rule as every other shared field (CLAUDE.md §"GHL is single source of truth").
 *
 * History: until 2026-08-24 the same field lived on the OPPORTUNITY
 * (`opportunity.albadi_lead_score`, id `gNojMCZVszE5m2k8jvXh`). It was moved
 * because the score describes the LEAD — a contact holding several
 * opportunities (common here; see reconcileStagesFromGhl) could carry several
 * conflicting scores with no rule for which one meant anything. The
 * opportunity field is retained, unread, as a historical record.
 *
 * ⚠️ Not to be confused with `leads.lead_score`, an unrelated legacy NUMERIC
 * band (0/5/20/30/40/45/55) inherited from the ManyChat scoring engine.
 */
import { db } from "@/lib/db";
import { leads } from "@/drizzle/schema";
import { eq } from "drizzle-orm";

export const ALBADI_LEAD_SCORES = ["HOT", "WARM", "COLD"] as const;
export type AlbadiLeadScore = (typeof ALBADI_LEAD_SCORES)[number];

/**
 * Coerce whatever GHL hands back into a canonical band, or null.
 *
 * Tolerant of decoration on purpose: RADIO values get emoji prefixes when
 * someone edits the option labels in the GHL UI (the sibling `lead_owner`
 * field renders as "🤖 Bot"), and GHL returns array-valued picklists for some
 * field types. Anything unrecognised becomes null rather than a bad band.
 */
export function normalizeAlbadiLeadScore(raw: unknown): AlbadiLeadScore | null {
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (first === null || first === undefined) return null;
  const v = String(first).trim().toUpperCase();
  if (!v) return null;
  for (const band of ALBADI_LEAD_SCORES) {
    if (v.includes(band)) return band;
  }
  return null;
}

/**
 * Write the score for one lead: DB first, then push to the GHL contact field
 * so GHL — the source of truth — agrees.
 *
 * The push reuses `syncLeadToGHL`, which sends the full custom-field payload
 * built by `buildCustomFields`; the resync webhook that GHL fires back is
 * idempotent (it re-reads the same value), so this cannot loop.
 *
 * Imported lazily to keep the client-bundle rule (CLAUDE.md): `sync.ts` pulls
 * in `integrations/ghl/config.ts`, which throws on missing server env vars.
 */
export async function setAlbadiLeadScore(
  sid: string,
  score: AlbadiLeadScore | null
): Promise<void> {
  await db
    .update(leads)
    .set({ albadiLeadScore: score })
    .where(eq(leads.manychatSubId, sid));

  const { syncLeadToGHL } = await import("@/integrations/ghl/sync");
  await syncLeadToGHL(sid);
}
