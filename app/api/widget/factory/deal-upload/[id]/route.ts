/**
 * POST /api/widget/factory/deal-upload/<id>?stage=mockup|invoice|layout&widget_token=...
 * multipart/form-data field "file" — image / PDF / video, up to 25MB.
 *
 * Uploads to Vercel Blob under deal-files/<quote-id>/, appends to the stage's
 * file list in deal_milestones, and mirrors a note with the link to the lead's
 * GHL contact (non-fatal). Returns the merged milestones.
 */

import { NextRequest, NextResponse } from "next/server";
import { widgetAuthed } from "@/lib/widget/auth";
import {
  appendDealFile,
  mirrorDealEventToGhl,
  type FileStage,
} from "@/lib/factory/server/milestones";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 25_000_000;
const STAGE_HE: Record<FileStage, string> = {
  mockup: "הדמיה",
  invoice: "חשבונית",
  layout: "פריסה",
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!widgetAuthed(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const stage = req.nextUrl.searchParams.get("stage") as FileStage | null;
  if (!id || !stage || !(stage in STAGE_HE)) {
    return NextResponse.json({ ok: false, error: "missing id/stage" }, { status: 400 });
  }

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
  const okType =
    file.type.startsWith("image/") ||
    file.type.startsWith("video/") ||
    file.type === "application/pdf";
  if (!okType) {
    return NextResponse.json(
      { ok: false, error: "bad_type", message: "רק תמונה / PDF / וידאו" },
      { status: 400 }
    );
  }
  if (file.size === 0 || file.size > MAX_BYTES) {
    return NextResponse.json(
      { ok: false, error: "bad_size", message: "הקובץ ריק או גדול מ-25MB" },
      { status: 400 }
    );
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({ ok: false, error: "blob_not_configured" }, { status: 500 });
  }

  try {
    const { put } = await import("@vercel/blob");
    const ext = (file.name.split(".").pop() || "bin")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 6);
    const key = `deal-files/${id}/${stage}-${Date.now()}.${ext || "bin"}`;
    const blob = await put(key, file, {
      access: "public",
      contentType: file.type,
      addRandomSuffix: false,
    });
    const merged = await appendDealFile(id, stage, {
      url: blob.url,
      name: file.name || `${stage}.${ext}`,
      uploadedAt: new Date().toISOString(),
    });
    await mirrorDealEventToGhl(id, [
      `📎 קובץ ${STAGE_HE[stage]}: ${file.name || key}`,
      blob.url,
    ]);
    return NextResponse.json({ ok: true, url: blob.url, milestones: merged });
  } catch (e) {
    console.error("[deal-upload] failed", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "upload_failed" },
      { status: 500 }
    );
  }
}
