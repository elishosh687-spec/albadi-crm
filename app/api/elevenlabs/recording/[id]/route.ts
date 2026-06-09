/**
 * ElevenLabs recording proxy.
 *
 * Re-streams a conversation's audio under a `.mp3` URL that GHL's
 * /medias/upload-file whitelist accepts, injecting the xi-api-key
 * server-side (the raw ElevenLabs audio endpoint requires it, and GHL fetches
 * the URL unauthenticated).
 *
 * Path: /api/elevenlabs/recording/<conversation_id>.mp3
 *
 * The conversation id is the only "secret" in the path — same threat model as
 * the existing media proxy at /api/integrations/media (unguessable id, public
 * fetch on purpose so GHL can pull it).
 */
import { NextRequest, NextResponse } from "next/server";
import { fetchConversationAudio } from "@/lib/elevenlabs/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function conversationIdFromParam(raw: string): string {
  // Strip a trailing media extension if present (we publish `<id>.mp3`).
  const dot = raw.lastIndexOf(".");
  return dot > 0 ? raw.slice(0, dot) : raw;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  const conversationId = conversationIdFromParam(decodeURIComponent(id));
  if (!conversationId.startsWith("conv_")) {
    return new NextResponse("invalid conversation id", { status: 400 });
  }

  let audio: { buffer: Buffer; contentType: string };
  try {
    audio = await fetchConversationAudio(conversationId);
  } catch (e) {
    return new NextResponse(
      `upstream error: ${e instanceof Error ? e.message : String(e)}`,
      { status: 502 }
    );
  }

  return new NextResponse(new Uint8Array(audio.buffer), {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "Content-Length": String(audio.buffer.length),
      "Content-Disposition": `inline; filename="${conversationId}.mp3"`,
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=86400",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "Range, Content-Type",
      "Access-Control-Expose-Headers":
        "Content-Length, Content-Range, Accept-Ranges",
    },
  });
}

export async function HEAD(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
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
