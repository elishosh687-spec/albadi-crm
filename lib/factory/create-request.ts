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
import { appendRow, buildFactoryRow } from "@/lib/feishu/sheets";
import type { FactoryProductSpec } from "./types";

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
      description: spec.description,
      material: spec.material,
      size: sizeLabel(spec),
      printing: spec.printing,
      finishing: spec.finishing,
      quantity: spec.quantity,
    })
  );

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
