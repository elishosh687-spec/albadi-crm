/**
 * POST /api/factory/upload-image   (multipart/form-data, field "file")
 *
 * Uploads a product image to Vercel Blob and returns its public URL, which the
 * FinalizeModal stores as productSpec.picUrl. The PDF then embeds the actual
 * image (via fetchImageDataUri) — so the customer sees the photo, not a link.
 *
 * Auth: dashboard cookie OR ?widget_token=<T> (both allowed by middleware for
 * /api/factory/*). Works from the widget and the dashboard with one route.
 */

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_BYTES = 8_000_000;

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "bad_form" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "no_file" }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ ok: false, error: "not_an_image" }, { status: 400 });
  }
  if (file.size === 0 || file.size > MAX_BYTES) {
    return NextResponse.json(
      { ok: false, error: "bad_size", message: "התמונה ריקה או גדולה מ-8MB" },
      { status: 400 }
    );
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { ok: false, error: "blob_not_configured" },
      { status: 500 }
    );
  }

  try {
    const { put } = await import("@vercel/blob");
    const ext = (file.name.split(".").pop() || "jpg")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 5);
    const key = `factory-product-images/${Date.now()}-${Math.round(
      Math.random() * 1_000_000
    )}.${ext || "jpg"}`;
    const blob = await put(key, file, {
      access: "public",
      contentType: file.type,
      addRandomSuffix: false,
    });
    return NextResponse.json({ ok: true, url: blob.url });
  } catch (e) {
    console.error("[factory/upload-image] failed", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "upload_failed" },
      { status: 500 }
    );
  }
}
