/**
 * Register or update a CRM lead when a visitor completes the public configurator
 * (website, no WhatsApp session token). Matches existing leads by phone / JID.
 */

import { db } from "@/lib/db";
import { leads } from "@/drizzle/schema";
import { eq, or, sql } from "drizzle-orm";
import { ensureAutoTaskForStage } from "@/lib/crm-tasks/auto-task";
import { phoneToJid } from "@/lib/bridge/jid";
import {
  israeliPhoneLookupVariants,
  israeliPhoneSuffix,
  normalizeIsraeliPhoneE164,
} from "@/lib/phone/israel";

const LEAD_SOURCE = "website_configurator";

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
  const phoneE164 = normalizeIsraeliPhoneE164(input.phone);
  if (!phoneE164) return null;

  const jid = phoneToJid(phoneE164);
  const suffix = israeliPhoneSuffix(phoneE164);
  const phoneVariants = israeliPhoneLookupVariants(phoneE164);

  const name = input.name.trim() || null;
  const email = input.email.trim() || null;
  const quoteTotal = Number.isFinite(input.quoteTotalIls)
    ? String(Math.round(input.quoteTotalIls))
    : null;
  const noteLine =
    `[מעצב 3D] ${new Date().toLocaleDateString("he-IL")} — ` +
    `${input.colorName} · ${input.quantity} יח׳ · ₪${Math.round(input.quoteTotalIls)}` +
    (input.notes?.trim() ? `\n${input.notes.trim()}` : "");

  const phoneMatch =
    phoneVariants.length > 0
      ? or(...phoneVariants.map((v) => eq(leads.phoneE164, v)))
      : undefined;

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
    .where(
      or(
        ...(phoneMatch ? [phoneMatch] : []),
        eq(leads.waJid, jid),
        sql`right(regexp_replace(coalesce(${leads.phoneE164}, ''), '[^0-9]', '', 'g'), 9) = ${suffix}`
      )
    )
    .limit(1);

  if (existing) {
    const sid = existing.sid.trim();
    const mergedNotes = [existing.notes?.trim(), noteLine].filter(Boolean).join("\n\n");

    await db
      .update(leads)
      .set({
        name: name ?? existing.name,
        email: email ?? existing.email,
        phoneE164: phoneE164,
        waJid: existing.waJid ?? jid,
        quoteTotal: quoteTotal ?? existing.quoteTotal,
        leadSource: existing.leadSource ?? LEAD_SOURCE,
        pipelineStage: existing.pipelineStage ?? "INTAKE",
        notes: mergedNotes || null,
        active: true,
        updatedAt: new Date(),
      })
      .where(sql`trim(${leads.manychatSubId}) = ${sid}`);

    await ensureAutoTaskForStage(sid, "INTAKE").catch(() => {});
    return { manychatSubId: sid, created: false };
  }

  await db.insert(leads).values({
    manychatSubId: jid,
    waJid: jid,
    phoneE164: phoneE164,
    name,
    email,
    source: "configurator_web",
    leadSource: LEAD_SOURCE,
    pipelineStage: "INTAKE",
    quoteTotal,
    notes: noteLine,
    active: true,
  });

  await ensureAutoTaskForStage(jid, "INTAKE").catch(() => {});
  return { manychatSubId: jid, created: true };
}
