/**
 * Media proxy — re-streams a remote file under a URL ending with the right
 * extension and serves with the correct Content-Type header.
 *
 * Why: GHL's /medias/upload-file rejects sources whose path extension
 * isn't in its whitelist. WhatsApp voice notes arrive from GreenAPI as
 * `.oga` (rare for browsers but standard for Ogg Audio) which GHL flags
 * INVALID_FILE_TYPE. By proxying through this route as `voice.ogg` GHL
 * happily accepts it.
 *
 * Path: /api/integrations/media/<base64url>.<ext>
 *   <base64url> = base64url(srcUrl), no padding
 *   <ext>       = ogg | mp3 | mp4 | jpg | png | pdf …
 *
 * Public on purpose — the only "secret" is the source URL embedded in the
 * path, which GHL must be able to fetch unauthenticated. GreenAPI URLs
 * already expose the file by random uuid, so this proxy adds no leakage.
 */
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIME_BY_EXT: Record<string, string> = {
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg; codecs=opus",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
};

function decodeBase64Url(s: string): string {
  const padded = s + "=".repeat((4 - (s.length % 4)) % 4);
  const std = padded.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(std, "base64").toString("utf8");
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
): Promise<Response> {
  const { name } = await params;
  const dot = name.lastIndexOf(".");
  if (dot < 0) {
    return new NextResponse("missing extension", { status: 400 });
  }
  const encoded = name.slice(0, dot);
  const ext = name.slice(dot + 1).toLowerCase();
  let srcUrl: string;
  try {
    srcUrl = decodeBase64Url(encoded);
  } catch {
    return new NextResponse("invalid encoding", { status: 400 });
  }
  if (!/^https?:\/\//i.test(srcUrl)) {
    return new NextResponse("invalid source url", { status: 400 });
  }

  const upstream = await fetch(srcUrl);
  if (!upstream.ok) {
    return new NextResponse(`upstream ${upstream.status}`, {
      status: 502,
    });
  }
  // Buffer the full body so we can set Content-Length — GHL's
  // /medias/upload-file fetcher requires a known size and rejects chunked
  // streams with NaN size error.
  const buf = Buffer.from(await upstream.arrayBuffer());
  const contentType =
    MIME_BY_EXT[ext] ||
    upstream.headers.get("content-type") ||
    "application/octet-stream";

  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(buf.length),
      "Content-Disposition": `inline; filename="${name}"`,
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=86400",
      // Allow GHL Inbox UI (cross-origin) to fetch + decode the media.
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "Range, Content-Type",
      "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges",
    },
  });
}

export async function HEAD(
  req: NextRequest,
  ctx: { params: Promise<{ name: string }> }
): Promise<Response> {
  // Many audio players issue HEAD before GET to discover Content-Length.
  // Reuse the GET path but discard the body.
  const res = await GET(req, ctx);
  return new NextResponse(null, { status: res.status, headers: res.headers });
}

export async function OPTIONS(): Promise<Response> {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "Range, Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}
