/**
 * POST /api/leads/facebook-import
 *
 * Replaces the old Google Apps Script → ManyChat pipeline. Called from a
 * Google Apps Script attached to the Facebook lead-form spreadsheet.
 *
 * Auth: `Authorization: Bearer ${FB_IMPORT_SECRET}` — a dedicated secret so
 * we never expose the bridge tenant token to Apps Script.
 *
 * Body:
 *   { phone: "+972XXXXXXXXX" | "972XXXXXXXXX", fullName: "First Last" }
 *
 * Behaviour (mirrors the old ManyChat dedupe — important: don't double-text
 * customers who already initiated WhatsApp via the FB form's WA button):
 *   - Lead exists in DB (by waJid or phoneE164)
 *       → add tag "ליד_חדש" if missing, set leadSource="facebook" if null.
 *         Do NOT send OPENING. Return { status: "tagged_only" }.
 *   - Lead does not exist
 *       → insert leads row, add tag, set leadSource, send OPENING via bridge.
 *         Return { status: "sent" }.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { leads, leadTags } from "@/drizzle/schema";
import { and, eq, or, sql } from "drizzle-orm";
import { z } from "zod";
import { sendBridgeMessage } from "@/lib/bridge/client";
import { OPENING, kickstartQuestionnaire } from "@/lib/autoresponder/questionnaire";
import { getBotSettings } from "@/lib/bot-settings/store";
import { syncLeadToGHL } from "@/integrations/ghl/sync";

export const runtime = "nodejs";
export const maxDuration = 30;

const BodySchema = z.object({
  phone: z.string().min(7),
  fullName: z.string().min(1),
  // Meta Lead Ads attribution (optional — older Apps Script versions don't send
  // these). The leadgen id is what Meta needs to attribute a CAPI conversion
  // back to the ad. See memory meta-conversion-loop.
  leadgenId: z.string().optional(),
  adId: z.string().optional(),
  adName: z.string().optional(),
  campaignId: z.string().optional(),
  campaignName: z.string().optional(),
  email: z.string().optional(),
});

/** Trim to a non-empty string or null (drops "", whitespace, undefined). */
function clean(v: string | undefined): string | null {
  const t = (v ?? "").trim();
  return t.length ? t : null;
}

const FB_LEAD_TAG = "ליד_חדש";
const FB_LEAD_SOURCE = "facebook";

function digitsOnly(phone: string): string {
  return phone.replace(/[^0-9]/g, "");
}

function jidFromPhone(phone: string): string {
  return `${digitsOnly(phone)}@s.whatsapp.net`;
}

export async function POST(req: NextRequest) {
  const secret = (process.env.FB_IMPORT_SECRET ?? "").trim();
  if (!secret) {
    return NextResponse.json(
      { error: "FB_IMPORT_SECRET not configured" },
      { status: 503 }
    );
  }
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json().catch(() => ({})));
  } catch (err) {
    return NextResponse.json(
      { error: "invalid_body", detail: String(err) },
      { status: 400 }
    );
  }

  const phone = digitsOnly(body.phone);
  if (!phone || phone.length < 7) {
    return NextResponse.json(
      { error: "invalid_phone", detail: body.phone },
      { status: 400 }
    );
  }
  const jid = jidFromPhone(phone);
  const name = body.fullName.trim();

  const meta = {
    leadgenId: clean(body.leadgenId),
    adId: clean(body.adId),
    adName: clean(body.adName),
    campaignId: clean(body.campaignId),
    campaignName: clean(body.campaignName),
    email: clean(body.email),
  };
  const hasMeta = Object.values(meta).some((v) => v !== null);

  // 1. Check existing lead. WhatsApp leads come in via the bridge as a @lid
  //    or @s.whatsapp.net JID — match either, and also by stored phone.
  const existing = await db
    .select({
      sid: leads.manychatSubId,
      name: leads.name,
      phone: leads.phoneE164,
      leadSource: leads.leadSource,
    })
    .from(leads)
    .where(
      or(
        eq(leads.phoneE164, phone),
        eq(leads.waJid, jid)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    const row = existing[0];
    // Add tag idempotently.
    const hasTag = await db
      .select({ id: leadTags.id })
      .from(leadTags)
      .where(
        and(
          sql`trim(${leadTags.manychatSubId}) = ${row.sid.trim()}`,
          eq(leadTags.tag, FB_LEAD_TAG)
        )
      )
      .limit(1);
    if (hasTag.length === 0) {
      await db
        .insert(leadTags)
        .values({ manychatSubId: row.sid, tag: FB_LEAD_TAG });
    }
    // Set leadSource only if not already set — preserve manual overrides.
    if (!row.leadSource) {
      await db
        .update(leads)
        .set({ leadSource: FB_LEAD_SOURCE, updatedAt: new Date() })
        .where(sql`trim(${leads.manychatSubId}) = ${row.sid.trim()}`);
    }
    // Backfill Meta attribution where still empty — COALESCE preserves any
    // value already stored (e.g. from the sheet backfill). Idempotent.
    if (hasMeta) {
      await db
        .update(leads)
        .set({
          metaLeadgenId: sql`COALESCE(${leads.metaLeadgenId}, ${meta.leadgenId})`,
          metaAdId: sql`COALESCE(${leads.metaAdId}, ${meta.adId})`,
          metaAdName: sql`COALESCE(${leads.metaAdName}, ${meta.adName})`,
          metaCampaignId: sql`COALESCE(${leads.metaCampaignId}, ${meta.campaignId})`,
          metaCampaignName: sql`COALESCE(${leads.metaCampaignName}, ${meta.campaignName})`,
          metaFormEmail: sql`COALESCE(${leads.metaFormEmail}, ${meta.email})`,
        })
        .where(sql`trim(${leads.manychatSubId}) = ${row.sid.trim()}`);
    }
    return NextResponse.json({
      status: "tagged_only",
      sid: row.sid,
      reason: "lead_already_exists",
    });
  }

  // 2. New lead — insert, tag, send OPENING.
  //    We key the lead on the @s.whatsapp.net JID. When/if the customer
  //    later sends a real message and the bridge resolves to a different
  //    LID, the webhook's upsert reconciles via `waJid = sid`.
  try {
    await db.insert(leads).values({
      manychatSubId: jid,
      waJid: jid,
      name,
      phoneE164: phone,
      source: "facebook_import",
      leadSource: FB_LEAD_SOURCE,
      active: true,
      // null = pre-questionnaire; the bot will run intake on first inbound.
      pipelineStage: null,
      // Meta Lead Ads attribution (null when the Apps Script doesn't send it).
      metaLeadgenId: meta.leadgenId,
      metaAdId: meta.adId,
      metaAdName: meta.adName,
      metaCampaignId: meta.campaignId,
      metaCampaignName: meta.campaignName,
      metaFormEmail: meta.email,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "lead_insert_failed", detail: String(err) },
      { status: 500 }
    );
  }

  try {
    await db.insert(leadTags).values({ manychatSubId: jid, tag: FB_LEAD_TAG });
  } catch (err) {
    // Tag insert failure is non-fatal — the lead row exists.
    console.warn("[fb-import] tag insert failed", err);
  }

  // Push to GHL right after the row lands so the lead shows up in the
  // pipeline kanban immediately, even if they never reply to the OPENING.
  // pickStageId in integrations/ghl/mapping.ts maps NULL stage → INTAKE so
  // the opportunity is created in the first visible column. Fire-and-forget
  // (no await) so Apps Script doesn't pay the GHL latency on each row.
  void syncLeadToGHL(jid).catch((e) =>
    console.warn("[fb-import] syncLeadToGHL failed", jid, e),
  );

  try {
    await sendBridgeMessage(
      jid,
      (await getBotSettings()).openingMessage,
      undefined,
      "bot"
    );
    await kickstartQuestionnaire(jid);
  } catch (err) {
    // Bridge send failure: lead row + tag are persisted, but the customer
    // didn't get the opening. Caller (Apps Script) sees `send_failed` and
    // can retry; the dedupe path will not re-send because the lead already
    // exists, so a retry needs different handling — emit explicit error.
    return NextResponse.json(
      {
        status: "lead_created_send_failed",
        sid: jid,
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 502 }
    );
  }

  return NextResponse.json({
    status: "sent",
    sid: jid,
    phone,
    name,
  });
}
