/**
 * POST /api/admin/seed-bag-dimensions-template
 *
 * One-off: uploads `/templates/bag-dimensions-he.png` to the WhatsApp bridge
 * media store to get a media_id, then inserts a `message_templates` row that
 * appears in the dashboard's conversations Composer / ExpandedLead template
 * picker. Idempotent — if a template named `bag_dimensions_he` already exists,
 * the endpoint refreshes the media_id (so re-uploading the image works) but
 * does not duplicate the row.
 *
 * Auth: admin cookie (gated by middleware). No body required.
 *
 * Call once from the dashboard (any signed-in tab):
 *   await fetch('/api/admin/seed-bag-dimensions-template', { method: 'POST' })
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { messageTemplates } from "@/drizzle/schema";
import { uploadBridgeMediaFromUrl } from "@/lib/bridge/client";

export const runtime = "nodejs";

const TEMPLATE_NAME = "bag_dimensions_he";
const TEMPLATE_LABEL = "📐 הסבר מידות שקית";
const IMAGE_PATH = "/templates/bag-dimensions-he.png";

const BODY = [
  "לפני שנמלא את השאלון, רצינו ליישר קו ✏️",
  "ככה אנחנו מודדים שקית:",
  "",
  "📏 *רוחב (W)* — פתח השקית מצד לצד",
  "📐 *גובה (H)* — מלמעלה למטה",
  "📦 *עומק (D)* — כמה השקית מתרחבת כשהיא מלאה (גוזט)",
  "",
  "מידות תמיד בפורמט W × H × D (ס״מ).",
  "אם השקית שטוחה — העומק הוא 0.",
].join("\n");

export async function POST(req: NextRequest) {
  // /api/admin/* is NOT covered by the middleware auth gate — enforce the
  // admin cookie here directly (same check the middleware uses on the
  // dashboard). Run this from a signed-in browser tab.
  const cookie = req.cookies.get("albadi_auth");
  if (!cookie || cookie.value !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 }
    );
  }

  try {
    // Build the public URL for the static PNG. The image is served by Vercel
    // straight out of /public, so any deployed host (production or preview)
    // can fetch it back through this same domain.
    const host = req.headers.get("host");
    if (!host) {
      return NextResponse.json(
        { ok: false, error: "no_host_header" },
        { status: 400 }
      );
    }
    const proto = host.startsWith("localhost") ? "http" : "https";
    const imageUrl = `${proto}://${host}${IMAGE_PATH}`;

    const mediaId = await uploadBridgeMediaFromUrl(
      imageUrl,
      "bag-dimensions-he.png"
    );

    const existing = await db
      .select({ id: messageTemplates.id })
      .from(messageTemplates)
      .where(eq(messageTemplates.name, TEMPLATE_NAME))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(messageTemplates)
        .set({
          type: "cta_url",
          body: BODY,
          headerType: "image",
          mediaId,
          ctaLabel: null,
          ctaUrl: null,
          active: true,
          updatedAt: new Date(),
        })
        .where(eq(messageTemplates.id, existing[0].id));
      return NextResponse.json({
        ok: true,
        action: "updated",
        templateId: existing[0].id,
        mediaId,
        label: TEMPLATE_LABEL,
      });
    }

    const inserted = await db
      .insert(messageTemplates)
      .values({
        name: TEMPLATE_NAME,
        type: "cta_url",
        body: BODY,
        headerType: "image",
        mediaId,
        sortOrder: 5,
        active: true,
      })
      .returning({ id: messageTemplates.id });

    return NextResponse.json({
      ok: true,
      action: "inserted",
      templateId: inserted[0]?.id ?? null,
      mediaId,
      label: TEMPLATE_LABEL,
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error("[admin.seed-bag-dimensions-template] failed", detail);
    return NextResponse.json(
      { ok: false, error: "seed_failed", detail },
      { status: 500 }
    );
  }
}
