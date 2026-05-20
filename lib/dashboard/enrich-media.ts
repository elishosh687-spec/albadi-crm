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

export function enrichMessagesWithMedia(rows: RawMessageRow[]): ChatMessage[] {
  return rows.map((m) => {
    const p = (m.payload ?? null) as Record<string, unknown> | null;
    const rawType =
      typeof p?.media_type === "string"
        ? (p.media_type as string).toLowerCase()
        : null;
    const mediaKind = rawType
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
    const hasUrl =
      !!p &&
      ["url", "media_url", "image_url", "attachment_url", "media_path"].some(
        (k) => typeof p[k] === "string" && ((p[k] as string).length ?? 0) > 0
      );
    const filename =
      typeof p?.filename === "string" ? (p.filename as string) : null;
    return {
      id: m.id,
      direction: m.direction as "in" | "out",
      sender: (m.sender as "lead" | "bot" | "eli" | null) ?? null,
      text: m.text,
      receivedAt: m.receivedAt.toISOString(),
      mediaKind: hasUrl ? mediaKind ?? "document" : null,
      mediaFilename: filename,
    };
  });
}
