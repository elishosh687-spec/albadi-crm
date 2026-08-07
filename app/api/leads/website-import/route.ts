/**
 * POST /api/leads/website-import
 *
 * Entry point for leads from the albadi.ecobrotherss.com landing page (Google
 * Ads traffic). Deliberately a near-copy of `facebook-import` so website leads
 * land in exactly the same place as Meta leads: same `leads` row shape, same
 * `ליד_חדש` tag, same GHL contact + opportunity, same bot questionnaire.
 *
 * Auth: `Authorization: Bearer ${WEBSITE_IMPORT_SECRET}` — a dedicated secret,
 * separate from FB_IMPORT_SECRET so either can be rotated on its own.
 *
 * Body:
 *   {
 *     phone: "+972XXXXXXXXX",       // required — the whole pipeline is keyed on it
 *     fullName: "First Last",
 *     email?, business?, quantity?, delivery?,
 *     gclid?, gbraid?, wbraid?,
 *     utmSource?, utmMedium?, utmCampaign?, utmTerm?, utmContent?,
 *     landingUrl?, referrer?
 *   }
 *
 * Behaviour (mirrors facebook-import):
 *   - Lead exists (by phoneE164 or waJid)
 *       → add "ליד_חדש" if missing, set leadSource if null, append the
 *         attribution note. Do NOT re-send OPENING. → { status: "tagged_only" }
 *   - New lead
 *       → insert, tag, push to GHL, optionally send OPENING.
 *         → { status: "sent" | "created" }
 *
 * The Google click id is NOT stored in its own column — it lives in the
 * website's own Postgres, which is what the Google Ads offline-conversion
 * export queries. Here it goes into `notes` so it is visible on the GHL contact
 * card when Eli closes the deal.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { leads, leadTags } from "@/drizzle/schema";
import { and, eq, or, sql } from "drizzle-orm";
import { z } from "zod";
import { sendBridgeMessage } from "@/lib/bridge/client";
import { OPENING, kickstartQuestionnaire } from "@/lib/autoresponder/questionnaire";
import { syncLeadToGHL } from "@/integrations/ghl/sync";

export const runtime = "nodejs";
export const maxDuration = 30;

const BodySchema = z.object({
  phone: z.string().min(7),
  fullName: z.string().min(1),
  email: z.string().optional(),
  business: z.string().optional(),
  quantity: z.string().optional(),
  delivery: z.string().optional(),
  gclid: z.string().optional(),
  // Meta click id (+ browser pixel cookie). The site captures these on landing;
  // the CRM stores them and is the ONE place that talks to Meta's CAPI, so the
  // website never needs a Meta token or DB access. See memory meta-conversion-loop.
  fbclid: z.string().optional(),
  fbp: z.string().optional(),
  gbraid: z.string().optional(),
  wbraid: z.string().optional(),
  utmSource: z.string().optional(),
  utmMedium: z.string().optional(),
  utmCampaign: z.string().optional(),
  utmTerm: z.string().optional(),
  utmContent: z.string().optional(),
  landingUrl: z.string().optional(),
  referrer: z.string().optional(),
});

type Body = z.infer<typeof BodySchema>;

const NEW_LEAD_TAG = "ליד_חדש";
const PIPELINE_SOURCE = "website_import";

/**
 * Website leads get the same WhatsApp OPENING + questionnaire as Meta leads
 * (Eli, 2026-08-06). Kept behind an env var so it can be switched off from
 * Vercel without a deploy — set WEBSITE_IMPORT_SEND_OPENING=0.
 */
const SEND_OPENING = (process.env.WEBSITE_IMPORT_SEND_OPENING ?? "1").trim() === "1";

function digitsOnly(phone: string): string {
  return phone.replace(/[^0-9]/g, "");
}

function jidFromPhone(phone: string): string {
  return `${digitsOnly(phone)}@s.whatsapp.net`;
}

/**
 * Normalise an Israeli number to bare country-coded digits, matching what
 * facebook-import's Apps Script `fixPhone` produces.
 */
function normalisePhone(raw: string): string | null {
  let digits = digitsOnly(raw);
  if (!digits) return null;
  if (digits.startsWith("00")) digits = digits.slice(2);
  // Local Israeli form: 05X… → 9725X…
  if (digits.startsWith("0")) digits = `972${digits.slice(1)}`;
  // A bare 9-digit mobile with no country code (5XXXXXXXX).
  else if (digits.length === 9 && digits.startsWith("5")) digits = `972${digits}`;
  return digits.length >= 10 ? digits : null;
}

/** `leadSource` is the attribution label Eli filters on in the dashboard. */
function pickLeadSource(body: Body): string {
  if (body.gclid || body.gbraid || body.wbraid) return "google";
  // An fbclid means the visitor arrived from a Meta ad click.
  if (body.fbclid) return "facebook";
  if (body.utmSource) return body.utmSource.toLowerCase();
  return "website";
}

/** Human-readable attribution block for the lead notes / GHL contact card. */
function buildAttributionNote(body: Body): string {
  const lines = ["📥 ליד מהאתר"];
  const campaign = [body.utmCampaign, body.utmSource, body.utmMedium].filter(Boolean).join(" · ");
  if (campaign) lines.push(`קמפיין: ${campaign}`);
  if (body.utmTerm) lines.push(`מילת חיפוש: ${body.utmTerm}`);
  const clickId = body.gclid ?? body.gbraid ?? body.wbraid;
  if (clickId) lines.push(`gclid: ${clickId}`);
  if (body.fbclid) lines.push(`fbclid: ${body.fbclid}`);
  if (!clickId && !body.fbclid) lines.push("ללא click ID (תנועה אורגנית)");
  if (body.business) lines.push(`עסק: ${body.business}`);
  if (body.quantity) lines.push(`כמות מבוקשת: ${body.quantity}`);
  if (body.delivery) lines.push(`אספקה: ${body.delivery}`);
  if (body.landingUrl) lines.push(`דף נחיתה: ${body.landingUrl}`);
  if (body.referrer) lines.push(`מפנה: ${body.referrer}`);
  return lines.join("\n");
}

export async function POST(req: NextRequest) {
  const secret = (process.env.WEBSITE_IMPORT_SECRET ?? "").trim();
  if (!secret) {
    return NextResponse.json(
      { error: "WEBSITE_IMPORT_SECRET not configured" },
      { status: 503 }
    );
  }
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: Body;
  try {
    body = BodySchema.parse(await req.json().catch(() => ({})));
  } catch (err) {
    return NextResponse.json(
      { error: "invalid_body", detail: String(err) },
      { status: 400 }
    );
  }

  const phone = normalisePhone(body.phone);
  if (!phone) {
    return NextResponse.json(
      { error: "invalid_phone", detail: body.phone },
      { status: 400 }
    );
  }
  const jid = jidFromPhone(phone);
  const name = body.fullName.trim();
  const email = body.email?.trim() || null;
  const note = buildAttributionNote(body);
  const leadSource = pickLeadSource(body);

  // 1. Dedupe — someone who already messaged us on WhatsApp and then filled the
  //    form is one lead, not two.
  const existing = await db
    .select({
      sid: leads.manychatSubId,
      leadSource: leads.leadSource,
      notes: leads.notes,
      email: leads.email,
    })
    .from(leads)
    .where(or(eq(leads.phoneE164, phone), eq(leads.waJid, jid)))
    .limit(1);

  if (existing.length > 0) {
    const row = existing[0];
    const hasTag = await db
      .select({ id: leadTags.id })
      .from(leadTags)
      .where(
        and(
          sql`trim(${leadTags.manychatSubId}) = ${row.sid.trim()}`,
          eq(leadTags.tag, NEW_LEAD_TAG)
        )
      )
      .limit(1);
    if (hasTag.length === 0) {
      await db.insert(leadTags).values({ manychatSubId: row.sid, tag: NEW_LEAD_TAG });
    }

    // Append rather than overwrite: an existing lead may already carry notes
    // from the bot or from Eli, and the new attribution is additive history.
    // Skip if it's already there — the website's retry sweep can re-send a lead
    // whose first attempt failed late, and we don't want the note stacked up.
    const alreadyNoted = row.notes?.includes(note) ?? false;
    const mergedNotes = alreadyNoted
      ? row.notes!
      : row.notes
        ? `${row.notes}\n\n${note}`
        : note;
    await db
      .update(leads)
      .set({
        notes: mergedNotes,
        // Only fill blanks — never clobber a manual override.
        ...(row.leadSource ? {} : { leadSource }),
        ...(row.email ? {} : email ? { email } : {}),
        updatedAt: new Date(),
      })
      .where(sql`trim(${leads.manychatSubId}) = ${row.sid.trim()}`);

    // pushEmail: the customer just typed this address into the form, so it is
    // newer than whatever the GHL contact card holds.
    void syncLeadToGHL(row.sid, { pushEmail: Boolean(email) }).catch((e) =>
      console.warn("[website-import] syncLeadToGHL failed", row.sid, e),
    );

    return NextResponse.json({
      status: "tagged_only",
      sid: row.sid,
      reason: "lead_already_exists",
    });
  }

  // 2. New lead.
  try {
    await db.insert(leads).values({
      manychatSubId: jid,
      waJid: jid,
      name,
      phoneE164: phone,
      email,
      quantity: body.quantity ?? null,
      notes: note,
      source: PIPELINE_SOURCE,
      leadSource,
      active: true,
      // null = pre-questionnaire; pickStageId maps this to the INTAKE column so
      // the lead is visible in the GHL kanban straight away.
      pipelineStage: null,
      // Meta click attribution — lets the CAPI sender report web-sourced leads
      // back to the right ad even though they never touched an Instant Form.
      metaFbclid: body.fbclid ?? null,
      metaFbp: body.fbp ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "lead_insert_failed", detail: String(err) },
      { status: 500 }
    );
  }

  try {
    await db.insert(leadTags).values({ manychatSubId: jid, tag: NEW_LEAD_TAG });
  } catch (err) {
    // Non-fatal — the lead row exists, which is what matters.
    console.warn("[website-import] tag insert failed", err);
  }

  // Push to GHL immediately so the lead appears in the pipeline even if the
  // customer never replies. Fire-and-forget: the website shouldn't wait on GHL.
  void syncLeadToGHL(jid, { pushEmail: Boolean(email) }).catch((e) =>
    console.warn("[website-import] syncLeadToGHL failed", jid, e),
  );

  if (!SEND_OPENING) {
    return NextResponse.json({ status: "created", sid: jid, phone, name });
  }

  try {
    await sendBridgeMessage(jid, OPENING, undefined, "bot");
    await kickstartQuestionnaire(jid);
  } catch (err) {
    // The row and the GHL push already happened, so the lead is not lost — but
    // the customer got no greeting. Report it distinctly so the caller can tell
    // this apart from a total failure.
    return NextResponse.json(
      {
        status: "lead_created_send_failed",
        sid: jid,
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 502 }
    );
  }

  return NextResponse.json({ status: "sent", sid: jid, phone, name });
}
