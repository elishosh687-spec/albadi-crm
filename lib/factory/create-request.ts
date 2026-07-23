/**
 * Shared helper for creating a factory quote request: inserts the DB row,
 * appends the spec to Feishu, persists the returned row index. Used by:
 *   - POST /api/factory/quote-request  (clearDraft = true)
 *   - POST /api/factory/[id]/resend    (clearDraft = false — history copy)
 *
 * Throws on Feishu failure; the caller decides the response shape.
 */

import { db } from "@/lib/db";
import { factoryQuoteRequests, leads } from "@/drizzle/schema";
import { eq, sql } from "drizzle-orm";
import {
  appendRow,
  buildFactoryRow,
  setRowHeight,
  setCellDateFormat,
  setCellValue,
  FEISHU_ROW_HEIGHT_PX,
} from "@/lib/feishu/sheets";
import type { FactoryProductSpec, FactoryPricingResult } from "./types";

// The factory works the Feishu sheet in English/Chinese — the description column
// must never carry Hebrew (Eli 2026-07-16). The customer NAME (col A) stays
// Hebrew on purpose (just a label the factory ignores); only the product
// description is forced to English. Custom English text the operator typed is
// kept; any Hebrew (incl. the "שקית אלבדי" default) → a fixed English label.
const HAS_HEBREW = /[֐-׿]/;
function factoryDescription(desc: string | undefined | null): string {
  const d = (desc ?? "").trim();
  if (!d || HAS_HEBREW.test(d)) return "Albadi non-woven bag";
  return d;
}

function sizeLabel(spec: FactoryProductSpec): string {
  const parts: string[] = [];
  if (spec.heightCm) parts.push(`H${spec.heightCm}`);
  if (spec.depthCm) parts.push(`D${spec.depthCm}`);
  if (spec.widthCm) parts.push(`W${spec.widthCm}`);
  return parts.join("*");
}

function shortId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export interface CreateFactoryRequestInput {
  manychatSubId: string;
  productSpec: FactoryProductSpec;
  customerName?: string;
  quotationNo?: string;
  clearDraft: boolean;
}

export interface CreateFactoryRequestResult {
  id: string;
  quotationNo: string;
  feishuRowIndex: string;
}

export async function createFactoryRequest(
  input: CreateFactoryRequestInput
): Promise<CreateFactoryRequestResult> {
  const id = `fq_${Date.now()}_${shortId()}`;
  const quotationNo = input.quotationNo ?? id.slice(-8).toUpperCase();
  const spec = input.productSpec;

  let customerName = input.customerName ?? "";
  if (!customerName) {
    const leadRow = await db
      .select({ name: leads.name })
      .from(leads)
      .where(eq(leads.manychatSubId, input.manychatSubId))
      .limit(1);
    customerName = leadRow[0]?.name ?? "";
  }

  await db.insert(factoryQuoteRequests).values({
    id,
    manychatSubId: input.manychatSubId,
    quotationNo,
    productSpec: spec,
    factoryStatus: "pending",
  });

  const feishuRowIndex = await appendRow(
    buildFactoryRow({
      customer: customerName,
      quotationNo,
      pic: spec.picUrl ?? "",
      description: factoryDescription(spec.description),
      material: spec.material,
      size: sizeLabel(spec),
      printing: spec.printing,
      finishing: spec.finishing,
      quantity: spec.quantity,
    })
  );

  // Visual parity with the older factory-side rows. Non-fatal — the row is
  // already there, height is cosmetic.
  try {
    await setRowHeight(feishuRowIndex, FEISHU_ROW_HEIGHT_PX);
  } catch (err) {
    console.warn(
      "[factory/create-request] setRowHeight failed (non-fatal)",
      err
    );
  }

  // Format column C (the date cell we just wrote as an Excel serial) so it
  // renders as a clickable date that opens the Feishu date picker. Without
  // this the cell shows the raw integer (e.g. "46164"). Non-fatal.
  try {
    await setCellDateFormat(feishuRowIndex, "C");
  } catch (err) {
    console.warn(
      "[factory/create-request] setCellDateFormat failed (non-fatal)",
      err
    );
  }

  // Operator's "הערות למפעל" → the Remark column (S). appendRow only writes
  // A..J, so this needs its own targeted cell write. Non-fatal — the request
  // row already exists; only the remark is missing on failure.
  const factoryNote = (spec.notes ?? "").trim();
  if (factoryNote) {
    try {
      await setCellValue(feishuRowIndex, "S", factoryNote);
    } catch (err) {
      console.warn(
        "[factory/create-request] remark write (col S) failed (non-fatal)",
        err
      );
    }
  }

  await db
    .update(factoryQuoteRequests)
    .set({ feishuRowIndex, updatedAt: new Date() })
    .where(eq(factoryQuoteRequests.id, id));

  if (input.clearDraft) {
    await db
      .update(leads)
      .set({ factorySpecDraft: null, updatedAt: new Date() })
      .where(sql`trim(${leads.manychatSubId}) = ${input.manychatSubId}`);
  }

  return { id, quotationNo, feishuRowIndex };
}

export interface CreateFactoryDraftInput {
  manychatSubId: string;
  productSpec: FactoryProductSpec;
  customerName?: string;
  /** Optional self-calculated pricing snapshot ("שמור כטיוטה" from the
   *  calculator, or the sales-form auto-estimate). Stored in final_pricing so
   *  the quotes list shows the price the boss quoted the customer. This is an
   *  ESTIMATE — the row stays status='draft' until a real factory response
   *  makes it "serious" (received/finalized). */
  finalPricing?: FactoryPricingResult;
}

export interface CreateFactoryDraftResult {
  id: string;
  quotationNo: string;
}

// Creates a draft row (status='draft') without touching Feishu. Used when
// the operator wants to park a parallel quote in the order-summary list and
// send it to the factory later. Promote via promoteDraftToFeishu.
export async function createFactoryDraft(
  input: CreateFactoryDraftInput
): Promise<CreateFactoryDraftResult> {
  const id = `fq_${Date.now()}_${shortId()}`;
  const quotationNo = id.slice(-8).toUpperCase();

  await db.insert(factoryQuoteRequests).values({
    id,
    manychatSubId: input.manychatSubId,
    quotationNo,
    productSpec: input.productSpec,
    factoryStatus: "draft",
    finalPricing: input.finalPricing ?? null,
  });

  return { id, quotationNo };
}

// Recalculate-in-place: updates an EXISTING draft's spec + price snapshot rather
// than creating a new row (Eli 2026-07-23). Used when the calculator was opened
// from a draft ("חשב מחדש"). Returns null if the id doesn't exist. Only touches
// spec/price — status, sentToCustomerAt, deletedAt etc. are left as-is.
export async function updateFactoryDraft(
  id: string,
  input: { productSpec: FactoryProductSpec; finalPricing?: FactoryPricingResult }
): Promise<CreateFactoryDraftResult | null> {
  const updated = await db
    .update(factoryQuoteRequests)
    .set({
      productSpec: input.productSpec,
      finalPricing: input.finalPricing ?? null,
      updatedAt: new Date(),
    })
    .where(eq(factoryQuoteRequests.id, id))
    .returning({ id: factoryQuoteRequests.id, quotationNo: factoryQuoteRequests.quotationNo });
  const row = updated[0];
  if (!row) return null;
  return { id: row.id, quotationNo: row.quotationNo ?? row.id.slice(-8).toUpperCase() };
}

// Promotes an existing draft row to pending: appends to Feishu, stores
// feishuRowIndex, flips status. Throws if the row is missing or not a draft.
export async function promoteDraftToFeishu(
  id: string
): Promise<{ feishuRowIndex: string; quotationNo: string }> {
  const [row] = await db
    .select({
      manychatSubId: factoryQuoteRequests.manychatSubId,
      quotationNo: factoryQuoteRequests.quotationNo,
      productSpec: factoryQuoteRequests.productSpec,
      factoryStatus: factoryQuoteRequests.factoryStatus,
      finalPricing: factoryQuoteRequests.finalPricing,
      draftEstimate: factoryQuoteRequests.draftEstimate,
      customerName: leads.name,
    })
    .from(factoryQuoteRequests)
    .leftJoin(leads, eq(leads.manychatSubId, factoryQuoteRequests.manychatSubId))
    .where(eq(factoryQuoteRequests.id, id))
    .limit(1);

  if (!row) throw new Error("draft not found");
  if (row.factoryStatus !== "draft") {
    throw new Error(`row is not a draft (status=${row.factoryStatus})`);
  }

  const spec = row.productSpec as FactoryProductSpec;
  // A PRICED draft is a self-calculated estimate Eli may have already sent the
  // customer — KEEP it visible as its own quote (Eli 2026-07-22). Send a FRESH
  // row to the factory (new id + quotationNo) carrying the estimate snapshot for
  // the "טיוטה מול הצעת מפעל" comparison, and leave the original draft untouched.
  // A spec-only draft has nothing worth keeping → promote it in place as before.
  const isPriced = !!row.finalPricing;
  const targetId = isPriced ? `fq_${Date.now()}_${shortId()}` : id;
  const quotationNo = isPriced
    ? targetId.slice(-8).toUpperCase()
    : (row.quotationNo ?? id.slice(-8).toUpperCase());

  const feishuRowIndex = await appendRow(
    buildFactoryRow({
      customer: row.customerName ?? "",
      quotationNo,
      pic: spec.picUrl ?? "",
      description: factoryDescription(spec.description),
      material: spec.material,
      size: sizeLabel(spec),
      printing: spec.printing,
      finishing: spec.finishing,
      quantity: spec.quantity,
    })
  );
  try {
    await setRowHeight(feishuRowIndex, FEISHU_ROW_HEIGHT_PX);
  } catch (err) {
    console.warn(
      "[factory/promote-draft] setRowHeight failed (non-fatal)",
      err
    );
  }

  if (isPriced) {
    // New factory-bound row; the original draft row stays as a separate, viewable
    // estimate quote. draftEstimate carries the estimate for the comparison.
    await db.insert(factoryQuoteRequests).values({
      id: targetId,
      manychatSubId: row.manychatSubId,
      quotationNo,
      productSpec: row.productSpec as FactoryProductSpec,
      factoryStatus: "pending",
      feishuRowIndex,
      finalPricing: null,
      draftEstimate: row.draftEstimate ?? row.finalPricing,
      pdfUrl: null,
      sentToCustomerAt: null,
    });
  } else {
    await db
      .update(factoryQuoteRequests)
      .set({ feishuRowIndex, factoryStatus: "pending", updatedAt: new Date() })
      .where(eq(factoryQuoteRequests.id, id));
  }

  return { feishuRowIndex, quotationNo };
}
