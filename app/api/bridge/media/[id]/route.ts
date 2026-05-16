/**
 * GET /api/bridge/media/[id]
 *
 * Proxies bridge-side inbound media (logos customers send via WhatsApp) so
 * the dashboard's <img> tag can load it from the same origin. Two reasons
 * we proxy rather than embedding the bridge URL directly:
 *   1. The URL stored in messages.payload (`payload.url`) is hosted on
 *      wa-bridge-yehuda.fly.dev and may require `Authorization: Bearer`.
 *   2. Cross-origin <img> loads can break depending on the bridge's CORS
 *      headers; same-origin proxy sidesteps that entirely.
 *
 * `id` is the numeric primary key from the `messages` table. We look up the
 * row, extract a media URL from the stored payload (the bridge surfaces it
 * on a handful of fields — `url` is the current canonical one), and stream
 * the bytes back with the upstream content-type.
 */
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { messages } from "@/drizzle/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

function pickMediaUrl(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  for (const key of ["url", "media_url", "image_url", "attachment_url", "media_path"]) {
    const v = p[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const msgId = parseInt(id, 10);
  if (!Number.isFinite(msgId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const [row] = await db
    .select({ payload: messages.payload })
    .from(messages)
    .where(eq(messages.id, msgId))
    .limit(1);

  const url = pickMediaUrl(row?.payload);
  if (!url) {
    return NextResponse.json({ error: "no media on message" }, { status: 404 });
  }

  const headers: Record<string, string> = {};
  const token = process.env.BRIDGE_TENANT_TOKEN;
  if (token && /wa-bridge|fly\.dev/i.test(url)) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const upstream = await fetch(url, { headers });
  if (!upstream.ok) {
    return new NextResponse(`upstream ${upstream.status}`, {
      status: upstream.status,
    });
  }

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "Content-Type":
        upstream.headers.get("content-type") ?? "application/octet-stream",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
