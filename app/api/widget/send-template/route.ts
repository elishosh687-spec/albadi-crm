/**
 * POST /api/widget/send-template?widget_token=...
 *
 * Body: { sid: string; templateId: number }
 *
 * Fires a message_templates row at a lead from inside the GHL widget inbox —
 * same code path as the dashboard's `sendTemplateAction`, just gated by the
 * widget_token instead of the admin cookie. Used by the inbox row's quick
 * template buttons.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { widgetAuthed } from "@/lib/widget/auth";
import { db } from "@/lib/db";
import { leads, messageTemplates } from "@/drizzle/schema";
import { sendBridgeMessage, sendCtaUrlMessage } from "@/lib/bridge/client";

export const runtime = "nodejs";
export const maxDuration = 30;

const BodySchema = z.object({
  sid: z.string().min(1),
  templateId: z.number().int().positive(),
});

export async function POST(req: NextRequest) {
  if (!widgetAuthed(req)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 }
    );
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json().catch(() => ({})));
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: "invalid_body", detail: String(err) },
      { status: 400 }
    );
  }

  const cleanSid = body.sid.trim();
  try {
    const [[leadRow], [tmpl]] = await Promise.all([
      db
        .select({ jid: leads.waJid, phone: leads.phoneE164 })
        .from(leads)
        .where(sql`trim(${leads.manychatSubId}) = ${cleanSid}`)
        .limit(1),
      db
        .select()
        .from(messageTemplates)
        .where(eq(messageTemplates.id, body.templateId))
        .limit(1),
    ]);

    if (!leadRow) {
      return NextResponse.json(
        { ok: false, error: "lead_not_found" },
        { status: 404 }
      );
    }
    if (!tmpl) {
      return NextResponse.json(
        { ok: false, error: "template_not_found" },
        { status: 404 }
      );
    }
    const jid = leadRow.jid ?? leadRow.phone;
    if (!jid) {
      return NextResponse.json(
        { ok: false, error: "no_jid_or_phone" },
        { status: 422 }
      );
    }

    if (tmpl.type === "cta_url") {
      await sendCtaUrlMessage(jid, {
        body: tmpl.body,
        headerType: (tmpl.headerType as "video" | "image" | null) ?? null,
        mediaId: tmpl.mediaId,
        ctaLabel: tmpl.ctaLabel,
        ctaUrl: tmpl.ctaUrl,
      });
    } else if (tmpl.type === "restart_questionnaire") {
      const { restartQuestionnaire } = await import(
        "@/lib/autoresponder/questionnaire"
      );
      await restartQuestionnaire(cleanSid, tmpl.body);
    } else {
      await sendBridgeMessage(jid, tmpl.body);
    }

    return NextResponse.json({ ok: true, sent: true, name: tmpl.name });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[widget.send-template] failed", { sid: cleanSid, templateId: body.templateId, detail });
    return NextResponse.json(
      { ok: false, error: "send_failed", detail },
      { status: 500 }
    );
  }
}
