/**
 * GET /api/bridge/media/[id]
 *
 * Proxy + decrypt for inbound WhatsApp media. The browser cannot load the
 * URL stored in messages.payload directly because WA serves it as an
 * AES-256-CBC encrypted blob (the `.enc` extension). The bridge keeps the
 * raw plaintext on a private volume but exposes no HTTP route to retrieve
 * it. So this route:
 *
 *   1. Looks up the message in our DB to find waMessageId + chat_jid.
 *   2. Fetches the bridge's single-message detail to get `media_key`,
 *      `url`, and `media_type`.
 *   3. Downloads the encrypted bytes from the WA CDN URL.
 *   4. Decrypts using HKDF-SHA256 → AES-256-CBC per the WhatsApp media
 *      protocol (same scheme Baileys uses in `downloadMediaMessage`).
 *   5. Streams the plaintext back with a best-effort content-type.
 *
 * `id` is the numeric primary key from the `messages` table.
 */
import { NextResponse } from "next/server";
import crypto from "crypto";
import { db } from "@/lib/db";
import { messages } from "@/drizzle/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";
// Node runtime — we need `node:crypto` for HKDF + AES.
export const runtime = "nodejs";

const HKDF_INFO: Record<string, string> = {
  image: "WhatsApp Image Keys",
  sticker: "WhatsApp Image Keys",
  video: "WhatsApp Video Keys",
  audio: "WhatsApp Audio Keys",
  document: "WhatsApp Document Keys",
};

function hkdfExpand(key: Buffer, info: string, length: number): Buffer {
  // RFC 5869, salt = 32 zero bytes (WhatsApp convention).
  const prk = crypto.createHmac("sha256", Buffer.alloc(32)).update(key).digest();
  const out = Buffer.alloc(length);
  let t = Buffer.alloc(0);
  let off = 0;
  let ctr = 1;
  const infoBuf = Buffer.from(info);
  while (off < length) {
    t = crypto
      .createHmac("sha256", prk)
      .update(Buffer.concat([t, infoBuf, Buffer.from([ctr])]))
      .digest();
    const take = Math.min(t.length, length - off);
    t.copy(out, off, 0, take);
    off += take;
    ctr++;
  }
  return out;
}

function decryptWaMedia(
  encrypted: Buffer,
  mediaKey: Buffer,
  mediaType: string
): Buffer {
  const info = HKDF_INFO[mediaType] ?? HKDF_INFO.image;
  const expanded = hkdfExpand(mediaKey, info, 112);
  const iv = expanded.subarray(0, 16);
  const cipherKey = expanded.subarray(16, 48);
  const macKey = expanded.subarray(48, 80);

  const ciphertext = encrypted.subarray(0, encrypted.length - 10);
  const mac = encrypted.subarray(encrypted.length - 10);

  const expectedMac = crypto
    .createHmac("sha256", macKey)
    .update(Buffer.concat([iv, ciphertext]))
    .digest()
    .subarray(0, 10);
  if (!expectedMac.equals(mac)) {
    throw new Error("MAC verification failed");
  }

  const decipher = crypto.createDecipheriv("aes-256-cbc", cipherKey, iv);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function contentTypeFor(mediaType: string, filename: string | null): string {
  const ext = (filename ?? "").toLowerCase().split(".").pop() ?? "";
  if (mediaType === "image") {
    if (ext === "png") return "image/png";
    if (ext === "gif") return "image/gif";
    if (ext === "webp") return "image/webp";
    return "image/jpeg";
  }
  if (mediaType === "video") {
    if (ext === "webm") return "video/webm";
    return "video/mp4";
  }
  if (mediaType === "audio") {
    if (ext === "mp3") return "audio/mpeg";
    if (ext === "wav") return "audio/wav";
    return "audio/ogg";
  }
  if (mediaType === "sticker") return "image/webp";
  return "application/octet-stream";
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
    .select({ payload: messages.payload, waMessageId: messages.waMessageId })
    .from(messages)
    .where(eq(messages.id, msgId))
    .limit(1);
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  const p = (row.payload ?? {}) as Record<string, unknown>;
  const waId =
    row.waMessageId ??
    (typeof p.id === "string" ? (p.id as string) : null);
  const chatJid = typeof p.chat_jid === "string" ? (p.chat_jid as string) : null;
  if (!waId || !chatJid) {
    return NextResponse.json(
      { error: "message has no bridge id / chat_jid" },
      { status: 404 }
    );
  }

  const base = process.env.BRIDGE_BASE;
  const token = process.env.BRIDGE_TENANT_TOKEN;
  if (!base || !token) {
    return NextResponse.json(
      { error: "BRIDGE_BASE / BRIDGE_TENANT_TOKEN not set" },
      { status: 500 }
    );
  }

  // Fetch single-message detail to obtain media_key + URL.
  const detailRes = await fetch(
    `${base}/v1/messages/${encodeURIComponent(waId)}?chat_jid=${encodeURIComponent(chatJid)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!detailRes.ok) {
    return NextResponse.json(
      { error: `bridge detail ${detailRes.status}` },
      { status: 502 }
    );
  }
  const detail = (await detailRes.json()) as {
    url?: string;
    media_type?: string;
    media_key?: { type: string; data: number[] };
    filename?: string;
  };
  const url = detail.url;
  const mediaType = (detail.media_type ?? "image").toLowerCase();
  const mediaKeyData = detail.media_key?.data;
  if (!url || !mediaKeyData) {
    return NextResponse.json(
      { error: "bridge detail missing url / media_key" },
      { status: 404 }
    );
  }
  const mediaKey = Buffer.from(mediaKeyData);

  // Download encrypted bytes from WA CDN.
  const encRes = await fetch(url);
  if (!encRes.ok) {
    return NextResponse.json(
      { error: `wa-cdn ${encRes.status}` },
      { status: 502 }
    );
  }
  const encrypted = Buffer.from(await encRes.arrayBuffer());

  let plaintext: Buffer;
  try {
    plaintext = decryptWaMedia(encrypted, mediaKey, mediaType);
  } catch (e) {
    return NextResponse.json(
      { error: `decrypt failed: ${(e as Error).message}` },
      { status: 500 }
    );
  }

  // Cast Buffer → Uint8Array for the BodyInit-compatible response body.
  return new NextResponse(new Uint8Array(plaintext), {
    status: 200,
    headers: {
      "Content-Type": contentTypeFor(mediaType, detail.filename ?? null),
      "Content-Length": String(plaintext.length),
      // Private cache — media URL is per-user and contains keys.
      "Cache-Control": "private, max-age=86400",
    },
  });
}
