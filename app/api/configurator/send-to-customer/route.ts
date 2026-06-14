import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { db } from "@/lib/db";
import { leads } from "@/drizzle/schema";
import { sql } from "drizzle-orm";
import { loadConfiguratorSession } from "@/lib/configurator/sessions";
import { sendBridgeMessage } from "@/lib/bridge/client";
import { logLeadEvent } from "@/lib/events/lead-events";
import { verifyWidgetToken } from "@/integrations/ghl/widget-auth";

export const runtime = "nodejs";

function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

/** Decode a `data:image/png;base64,...` URL to a Buffer + content type. */
function decodeDataUrl(dataUrl: string): { buffer: Buffer; contentType: string } | null {
  const match = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl.trim());
  if (!match) return null;
  try {
    return { contentType: match[1] || "image/png", buffer: Buffer.from(match[2], "base64") };
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json" },
      { status: 400, headers: corsHeaders() }
    );
  }

  const str = (k: string) => (typeof body[k] === "string" ? String(body[k]).trim() : "");
  const sessionToken = str("sessionToken") || null;
  let manychatSubId = str("manychatSubId") || null;
  const imageDataUrl = str("imageDataUrl");
  const widgetToken =
    str("widgetToken") || req.nextUrl.searchParams.get("widget_token")?.trim() || null;

  if (!imageDataUrl) {
    return NextResponse.json(
      { ok: false, error: "missing_image" },
      { status: 400, headers: corsHeaders() }
    );
  }

  // Agent path: a directly-provided manychatSubId can target ANY contact, so
  // it requires a valid widget token. The customer self-serve path (lead
  // resolved from a sessionToken) stays open as before.
  if (manychatSubId && !verifyWidgetToken(widgetToken)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401, headers: corsHeaders() }
    );
  }

  try {
    // Resolve the lead: prefer explicit manychatSubId, else the session token.
    if (!manychatSubId && sessionToken) {
      const session = await loadConfiguratorSession(sessionToken);
      manychatSubId = session?.manychatSubId ?? null;
    }
    if (!manychatSubId) {
      return NextResponse.json(
        { ok: false, error: "no_linked_contact" },
        { status: 400, headers: corsHeaders() }
      );
    }

    const [leadRow] = await db
      .select({ jid: leads.waJid, phone: leads.phoneE164 })
      .from(leads)
      .where(sql`trim(${leads.manychatSubId}) = ${manychatSubId}`)
      .limit(1);
    if (!leadRow) {
      return NextResponse.json(
        { ok: false, error: "lead_not_found" },
        { status: 404, headers: corsHeaders() }
      );
    }
    const recipient = leadRow.jid ?? leadRow.phone;
    if (!recipient) {
      return NextResponse.json(
        { ok: false, error: "no_recipient" },
        { status: 400, headers: corsHeaders() }
      );
    }

    // Decode the screenshot data URL and host it on Vercel Blob → public URL
    // (Green's sendFileByUrl needs a downloadable URL).
    const decoded = decodeDataUrl(imageDataUrl);
    if (!decoded) {
      return NextResponse.json(
        { ok: false, error: "bad_image_data" },
        { status: 400, headers: corsHeaders() }
      );
    }
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return NextResponse.json(
        { ok: false, error: "blob_not_configured" },
        { status: 500, headers: corsHeaders() }
      );
    }

    const { put } = await import("@vercel/blob");
    const key = `configurator-mockups/${manychatSubId}-${randomBytes(6).toString("hex")}.png`;
    const blob = await put(key, decoded.buffer, {
      access: "public",
      contentType: decoded.contentType || "image/png",
      addRandomSuffix: true,
    });

    const caption = "הנה הדמיה של התיק שלך 🎨";
    const result = await sendBridgeMessage(
      recipient,
      caption,
      blob.url,
      "eli",
      "bag-mockup.png"
    );

    void logLeadEvent({
      manychatSubId,
      eventType: "configurator_design_sent",
      actor: "eli",
      payload: { imageUrl: blob.url, waMessageId: result.wa_message_id ?? null },
    });

    return NextResponse.json(
      { ok: true, imageUrl: blob.url, waMessageId: result.wa_message_id ?? null },
      { headers: corsHeaders() }
    );
  } catch (err) {
    console.error("[configurator/send-to-customer] failed", err);
    return NextResponse.json(
      {
        ok: false,
        error: "send_failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500, headers: corsHeaders() }
    );
  }
}
