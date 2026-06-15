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

/** Pick a sensible content type + extension for the media being sent. */
function resolveMedia(
  mediaType: string,
  filename: string,
  fallbackContentType?: string
): { contentType: string; extension: string } {
  const lower = (filename || "").toLowerCase();
  if (mediaType === "video" || /\.(mp4|webm|mov)$/.test(lower)) {
    if (lower.endsWith(".webm") || fallbackContentType?.includes("webm")) {
      return { contentType: "video/webm", extension: "webm" };
    }
    return { contentType: "video/mp4", extension: "mp4" };
  }
  return { contentType: fallbackContentType || "image/png", extension: "png" };
}

export async function POST(req: NextRequest) {
  // Payload bound by parsing either multipart/form-data (raw bytes — preferred
  // for video) or the legacy JSON body with a base64 image data URL.
  let sessionToken: string | null = null;
  let manychatSubId: string | null = null;
  let widgetToken: string | null = null;
  let fileBuffer: Buffer | null = null;
  let contentType = "image/png";
  let extension = "png";
  let mediaType: "image" | "video" = "image";
  let filename = "bag-mockup.png";

  const reqContentType = req.headers.get("content-type") || "";

  if (reqContentType.includes("multipart/form-data")) {
    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return NextResponse.json(
        { ok: false, error: "invalid_form" },
        { status: 400, headers: corsHeaders() }
      );
    }
    const fstr = (k: string) => {
      const v = formData.get(k);
      return typeof v === "string" ? v.trim() : "";
    };
    sessionToken = fstr("sessionToken") || null;
    manychatSubId = fstr("manychatSubId") || null;
    widgetToken =
      fstr("widgetToken") || req.nextUrl.searchParams.get("widget_token")?.trim() || null;
    mediaType = fstr("mediaType") === "video" ? "video" : "image";
    filename = fstr("filename") || (mediaType === "video" ? "bag-mockup.mp4" : "bag-mockup.png");

    const file = formData.get("file");
    if (!(file instanceof Blob) || file.size === 0) {
      return NextResponse.json(
        { ok: false, error: "missing_file" },
        { status: 400, headers: corsHeaders() }
      );
    }
    fileBuffer = Buffer.from(await file.arrayBuffer());
    const resolved = resolveMedia(mediaType, filename, file.type);
    contentType = resolved.contentType;
    extension = resolved.extension;
  } else {
    // Legacy JSON path: { sessionToken?, manychatSubId?, imageDataUrl, widgetToken? }
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
    sessionToken = str("sessionToken") || null;
    manychatSubId = str("manychatSubId") || null;
    widgetToken =
      str("widgetToken") || req.nextUrl.searchParams.get("widget_token")?.trim() || null;
    const imageDataUrl = str("imageDataUrl");
    if (!imageDataUrl) {
      return NextResponse.json(
        { ok: false, error: "missing_image" },
        { status: 400, headers: corsHeaders() }
      );
    }
    const decoded = decodeDataUrl(imageDataUrl);
    if (!decoded) {
      return NextResponse.json(
        { ok: false, error: "bad_image_data" },
        { status: 400, headers: corsHeaders() }
      );
    }
    fileBuffer = decoded.buffer;
    contentType = decoded.contentType || "image/png";
    extension = "png";
    mediaType = "image";
    filename = "bag-mockup.png";
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

    // Host the media bytes on Vercel Blob → public URL (Green's sendFileByUrl
    // needs a downloadable URL). Works for both the PNG image and the recorded
    // rotation video.
    if (!fileBuffer) {
      return NextResponse.json(
        { ok: false, error: "missing_file" },
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
    const key = `configurator-mockups/${manychatSubId}-${randomBytes(6).toString("hex")}.${extension}`;
    const blob = await put(key, fileBuffer, {
      access: "public",
      contentType,
      addRandomSuffix: true,
    });

    const caption =
      mediaType === "video"
        ? "הנה סרטון של התיק שלך 🎨"
        : "הנה הדמיה של התיק שלך 🎨";
    const sendFilename = filename || `bag-mockup.${extension}`;
    const result = await sendBridgeMessage(
      recipient,
      caption,
      blob.url,
      "eli",
      sendFilename
    );

    void logLeadEvent({
      manychatSubId,
      eventType: "configurator_design_sent",
      actor: "eli",
      payload: {
        mediaType,
        mediaUrl: blob.url,
        imageUrl: blob.url,
        waMessageId: result.wa_message_id ?? null,
      },
    });

    return NextResponse.json(
      { ok: true, mediaType, mediaUrl: blob.url, imageUrl: blob.url, waMessageId: result.wa_message_id ?? null },
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
