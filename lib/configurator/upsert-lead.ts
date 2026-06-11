/**
 * Register or update a CRM lead when a visitor completes the public configurator
 * (website, no WhatsApp session token). Matches existing leads by phone / JID.
 */

import { db } from "@/lib/db";
import { leads } from "@/drizzle/schema";
import { eq, or, sql } from "drizzle-orm";
import { phoneToJid } from "@/lib/bridge/jid";

const LEAD_SOURCE = "website_configurator";

function digitsOnly(phone: string): string {
  return phone.replace(/[^0-9]/g, "");
}

export interface UpsertConfiguratorLeadInput {
  name: string;
  email: string;
  phone: string;
  quoteTotalIls: number;
  colorName: string;
  quantity: number;
  notes?: string | null;
}

export interface UpsertConfiguratorLeadResult {
  manychatSubId: string;
  created: boolean;
}

export async function upsertLeadFromConfigurator(
  input: UpsertConfiguratorLeadInput
): Promise<UpsertConfiguratorLeadResult | null> {
  const phone = digitsOnly(input.phone);
  if (!phone || phone.length < 7) return null;

  const jid = phoneToJid(phone);
  const name = input.name.trim() || null;
  const email = input.email.trim() || null;
  const quoteTotal = Number.isFinite(input.quoteTotalIls)
    ? String(Math.round(input.quoteTotalIls))
    : null;
  const noteLine =
    `[מעצב 3D] ${new Date().toLocaleDateString("he-IL")} — ` +
    `${input.colorName} · ${input.quantity} יח׳ · ₪${Math.round(input.quoteTotalIls)}` +
    (input.notes?.trim() ? `\n${input.notes.trim()}` : "");

  const [existing] = await db
    .select({
      sid: leads.manychatSubId,
      name: leads.name,
      email: leads.email,
      waJid: leads.waJid,
      leadSource: leads.leadSource,
      pipelineStage: leads.pipelineStage,
      quoteTotal: leads.quoteTotal,
      notes: leads.notes,
    })
    .from(leads)
    .where(or(eq(leads.phoneE164, phone), eq(leads.waJid, jid)))
    .limit(1);

  if (existing) {
    const sid = existing.sid.trim();
    const mergedNotes = [existing.notes?.trim(), noteLine].filter(Boolean).join("\n\n");

    await db
      .update(leads)
      .set({
        name: name ?? existing.name,
        email: email ?? existing.email,
        phoneE164: phone,
        waJid: existing.waJid ?? jid,
        quoteTotal: quoteTotal ?? existing.quoteTotal,
        leadSource: existing.leadSource ?? LEAD_SOURCE,
        pipelineStage: existing.pipelineStage ?? "INTAKE",
        notes: mergedNotes || null,
        updatedAt: new Date(),
      })
      .where(sql`trim(${leads.manychatSubId}) = ${sid}`);

    return { manychatSubId: sid, created: false };
  }

  await db.insert(leads).values({
    manychatSubId: jid,
    waJid: jid,
    phoneE164: phone,
    name,
    email,
    source: "configurator_web",
    leadSource: LEAD_SOURCE,
    pipelineStage: "INTAKE",
    quoteTotal,
    notes: noteLine,
    active: true,
  });

  return { manychatSubId: jid, created: true };
}
