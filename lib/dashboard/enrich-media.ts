/**
 * Enrich raw `messages` rows with media metadata for ChatThread rendering.
 *
 * The webhook stores the full bridge payload as JSONB in `messages.payload`.
 * ChatThread renders media based on `mediaKind` + `mediaFilename` derived from
 * that payload. This helper is the single source of truth for that derivation
 * so both `/conversations/page.tsx` and the lead card wrappers stay in sync.
 */

import type { ChatMessage } from "@/app/dashboard/v3/conversations/_components/ChatThread";

export interface RawMessageRow {
  id: number;
  direction: string;
  sender: string | null;
  text: string | null;
  receivedAt: Date;
  payload?: unknown;
}

/**
 * Two payload formats coexist in `messages.payload`:
 *
 *  Bridge (whatsapp-bridge-node): flat keys —
 *    { media_type: "image", url: "...", filename: "..." }
 *
 *  GreenAPI: nested —
 *    {
 *      messageData: {
 *        typeMessage: "imageMessage" | "audioMessage" | "videoMessage" | "documentMessage",
 *        fileMessageData: { downloadUrl, fileName, mimeType }
 *      }
 *    }
 *
 * Returns { kind, filename } if media is present, else null.
 */
function detectMedia(
  p: Record<string, unknown> | null
): { kind: "image" | "video" | "audio" | "document"; filename: string | null } | null {
  if (!p) return null;

  // GreenAPI format
  const md = p.messageData as Record<string, unknown> | undefined;
  if (md && typeof md.typeMessage === "string") {
    const t = (md.typeMessage as string).toLowerCase();
    const fmd = md.fileMessageData as Record<string, unknown> | undefined;
    const hasUrl = !!(fmd && typeof fmd.downloadUrl === "string" && (fmd.downloadUrl as string).length);
    if (!hasUrl) return null;
    const filename = typeof fmd?.fileName === "string" ? (fmd.fileName as string) : null;
    const kind: "image" | "video" | "audio" | "document" | null =
      t === "imagemessage"
        ? "image"
        : t === "videomessage"
          ? "video"
          : t === "audiomessage"
            ? "audio"
            : t === "documentmessage"
              ? "document"
              : null;
    if (!kind) return null;
    return { kind, filename };
  }

  // Bridge format
  const rawType =
    typeof p.media_type === "string" ? (p.media_type as string).toLowerCase() : null;
  const hasUrl = ["url", "media_url", "image_url", "attachment_url", "media_path"].some(
    (k) => typeof p[k] === "string" && ((p[k] as string).length ?? 0) > 0
  );
  if (!hasUrl) return null;
  const kind: "image" | "video" | "audio" | "document" | null = rawType
    ? rawType.startsWith("image")
      ? "image"
      : rawType.startsWith("video")
        ? "video"
        : rawType.startsWith("audio")
          ? "audio"
          : rawType === "document" || rawType.includes("pdf")
            ? "document"
            : null
    : null;
  const filename = typeof p.filename === "string" ? (p.filename as string) : null;
  return { kind: kind ?? "document", filename };
}

export function enrichMessagesWithMedia(rows: RawMessageRow[]): ChatMessage[] {
  return rows.map((m) => {
    const p = (m.payload ?? null) as Record<string, unknown> | null;
    const media = detectMedia(p);
    return {
      id: m.id,
      direction: m.direction as "in" | "out",
      sender: (m.sender as "lead" | "bot" | "eli" | null) ?? null,
      text: m.text,
      receivedAt: m.receivedAt.toISOString(),
      mediaKind: media?.kind ?? null,
      mediaFilename: media?.filename ?? null,
    };
  });
}
