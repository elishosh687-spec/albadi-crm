/**
 * Download an embedded Feishu sheet-cell image (stored as a Drive media with a
 * fileToken) and re-host it on Vercel Blob so it's publicly fetchable — the
 * customer PDF can then embed it. Feishu's own image link is auth-gated, so we
 * download with the tenant token and copy it to Blob.
 */

import { getFeishuBaseUrl, getTenantAccessToken } from "./client";

/** Pull the fileToken out of a sheet image cell (object or array of objects). */
export function extractFeishuFileToken(cell: unknown): string | null {
  if (!cell) return null;
  if (Array.isArray(cell)) {
    for (const it of cell) {
      const t = extractFeishuFileToken(it);
      if (t) return t;
    }
    return null;
  }
  if (typeof cell === "object") {
    const o = cell as Record<string, unknown>;
    if (typeof o.fileToken === "string") return o.fileToken;
    if (typeof o.file_token === "string") return o.file_token;
  }
  return null;
}

export async function downloadFeishuMedia(
  fileToken: string
): Promise<{ buffer: Buffer; contentType: string } | null> {
  if (!fileToken) return null;
  try {
    const token = await getTenantAccessToken();
    const url = `${getFeishuBaseUrl()}/open-apis/drive/v1/medias/${encodeURIComponent(
      fileToken
    )}/download`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) {
      console.warn(`[feishu/media] download ${fileToken} → HTTP ${resp.status}`);
      return null;
    }
    const ctRaw = resp.headers.get("content-type") ?? "";
    const contentType = ctRaw.startsWith("image/") ? ctRaw : "image/jpeg";
    const buffer = Buffer.from(await resp.arrayBuffer());
    if (buffer.byteLength === 0 || buffer.byteLength > 12_000_000) return null;
    return { buffer, contentType };
  } catch (e) {
    console.warn("[feishu/media] download failed", e);
    return null;
  }
}

/** Download a Feishu media by fileToken and re-host on Blob → public URL. */
export async function feishuImageToBlobUrl(
  fileToken: string
): Promise<string | null> {
  const media = await downloadFeishuMedia(fileToken);
  if (!media) return null;
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  try {
    const { put } = await import("@vercel/blob");
    const ext =
      media.contentType.split("/")[1]?.replace(/[^a-z0-9]/gi, "").slice(0, 5) ||
      "jpg";
    const blob = await put(
      `factory-product-images/feishu-${fileToken.slice(0, 16)}.${ext}`,
      media.buffer,
      { access: "public", contentType: media.contentType, addRandomSuffix: true }
    );
    return blob.url;
  } catch (e) {
    console.warn("[feishu/media] blob upload failed", e);
    return null;
  }
}
