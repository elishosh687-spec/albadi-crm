/**
 * Deal-file ("תיק עסקה") milestone helpers — merge-save the post-WON timeline
 * and mirror every event to the lead's GHL contact as a note (non-fatal), so
 * Itay sees mockup/invoice/layout progress without opening the widget.
 */

import { db } from "@/lib/db";
import { factoryQuoteRequests, leads } from "@/drizzle/schema";
import { eq, sql } from "drizzle-orm";
import type { DealMilestoneFile, DealMilestones } from "@/lib/factory/types";

const STAMP_KEYS = [
  "mockupSentAt",
  "invoiceSentAt",
  "layoutReceivedAt",
  "layoutApprovedAt",
  "productionStartedAt",
  "shippedAt",
  "deliveredAt",
] as const;
type StampKey = (typeof STAMP_KEYS)[number];

const FILE_KEYS = ["mockupFiles", "invoiceFiles", "layoutFiles"] as const;
export type FileStage = "mockup" | "invoice" | "layout";

export const STAGE_LABELS_HE: Record<StampKey, string> = {
  mockupSentAt: "הדמיה נשלחה ללקוח",
  invoiceSentAt: "חשבונית הונפקה",
  layoutReceivedAt: "פריסה התקבלה מהמפעל",
  layoutApprovedAt: "פריסה אושרה",
  productionStartedAt: "ייצור התחיל",
  shippedAt: "יצא למשלוח",
  deliveredAt: "הגיע ללקוח",
};

function isIsoOrNull(v: unknown): v is string | null {
  return v === null || (typeof v === "string" && !Number.isNaN(Date.parse(v)));
}

/**
 * Merge a partial patch into the stored deal_milestones. Returns the merged
 * object + which stamps newly flipped ON (for the GHL mirror).
 */
export async function saveDealMilestones(
  id: string,
  patch: Partial<DealMilestones>
): Promise<{ merged: DealMilestones; newlyStamped: StampKey[] }> {
  const [row] = await db
    .select({ dealMilestones: factoryQuoteRequests.dealMilestones })
    .from(factoryQuoteRequests)
    .where(eq(factoryQuoteRequests.id, id))
    .limit(1);
  if (!row) throw new Error("quote not found");

  const current = (row.dealMilestones ?? {}) as DealMilestones;
  const merged: DealMilestones = { ...current };
  const newlyStamped: StampKey[] = [];

  for (const k of STAMP_KEYS) {
    if (k in patch && isIsoOrNull(patch[k] ?? null)) {
      const next = patch[k] ?? null;
      if (next && !current[k]) newlyStamped.push(k);
      merged[k] = next;
    }
  }
  for (const k of FILE_KEYS) {
    if (k in patch && Array.isArray(patch[k])) {
      merged[k] = (patch[k] as DealMilestoneFile[])
        .filter((f) => f && typeof f.url === "string" && f.url)
        .slice(0, 30)
        .map((f) => ({
          url: String(f.url).slice(0, 600),
          name: String(f.name ?? "").slice(0, 140),
          uploadedAt: isIsoOrNull(f.uploadedAt) && f.uploadedAt ? f.uploadedAt : new Date().toISOString(),
        }));
    }
  }
  if ("invoiceZohoId" in patch) {
    merged.invoiceZohoId = patch.invoiceZohoId ? String(patch.invoiceZohoId).slice(0, 80) : undefined;
  }
  if ("notes" in patch) {
    merged.notes = patch.notes ? String(patch.notes).slice(0, 2000) : undefined;
  }
  merged.updatedAt = new Date().toISOString();

  await db
    .update(factoryQuoteRequests)
    .set({ dealMilestones: merged, updatedAt: new Date() })
    .where(eq(factoryQuoteRequests.id, id));

  return { merged, newlyStamped };
}

/** Append one uploaded file to a stage's file list. Returns the merged object. */
export async function appendDealFile(
  id: string,
  stage: FileStage,
  file: DealMilestoneFile
): Promise<DealMilestones> {
  const key = `${stage}Files` as (typeof FILE_KEYS)[number];
  const [row] = await db
    .select({ dealMilestones: factoryQuoteRequests.dealMilestones })
    .from(factoryQuoteRequests)
    .where(eq(factoryQuoteRequests.id, id))
    .limit(1);
  if (!row) throw new Error("quote not found");
  const current = (row.dealMilestones ?? {}) as DealMilestones;
  const merged: DealMilestones = {
    ...current,
    [key]: [...(current[key] ?? []), file].slice(0, 30),
    updatedAt: new Date().toISOString(),
  };
  await db
    .update(factoryQuoteRequests)
    .set({ dealMilestones: merged, updatedAt: new Date() })
    .where(eq(factoryQuoteRequests.id, id));
  return merged;
}

/**
 * Mirror a deal-file event to the lead's GHL contact as a note. NON-FATAL —
 * a GHL hiccup must never fail the save/upload. No-op when the lead has no
 * ghl_contact_id or GHL sync is off.
 */
export async function mirrorDealEventToGhl(
  quoteId: string,
  lines: string[]
): Promise<void> {
  try {
    const [row] = await db
      .select({
        leadSid: factoryQuoteRequests.manychatSubId,
        quotationNo: factoryQuoteRequests.quotationNo,
      })
      .from(factoryQuoteRequests)
      .where(eq(factoryQuoteRequests.id, quoteId))
      .limit(1);
    if (!row) return;
    const [lead] = await db
      .select({ ghlContactId: leads.ghlContactId })
      .from(leads)
      .where(sql`trim(${leads.manychatSubId}) = trim(${row.leadSid})`)
      .limit(1);
    if (!lead?.ghlContactId) return;
    const { addContactNote } = await import("@/integrations/ghl/client");
    const body = [
      `[תיק עסקה] הצעה #${row.quotationNo ?? quoteId.slice(-6)}`,
      ...lines,
    ].join("\n");
    await addContactNote(lead.ghlContactId, body);
  } catch (err) {
    console.warn("[deal-file] GHL mirror failed (non-fatal)", err);
  }
}
