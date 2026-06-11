/** Client-side helpers for configurator mockup downloads. */

export function downloadDataUrl(dataUrl: string, filename: string) {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  link.click();
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function pickVideoMimeType(): { mimeType: string; extension: "mp4" | "webm" } {
  const candidates: Array<{ mimeType: string; extension: "mp4" | "webm" }> = [
    { mimeType: 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"', extension: "mp4" },
    { mimeType: "video/mp4", extension: "mp4" },
    { mimeType: "video/webm; codecs=vp9", extension: "webm" },
    { mimeType: "video/webm", extension: "webm" },
  ];
  if (typeof MediaRecorder !== "undefined") {
    const hit = candidates.find((c) => MediaRecorder.isTypeSupported(c.mimeType));
    if (hit) return hit;
  }
  return { mimeType: "video/webm", extension: "webm" };
}

export function pngDataUrlToJpeg(dataUrl: string, quality = 0.9): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("canvas unavailable"));
        return;
      }
      ctx.fillStyle = "#f0e9dc";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => reject(new Error("image decode failed"));
    img.src = dataUrl;
  });
}

export function mockupBaseName(colorSku?: string | null) {
  const sku = colorSku?.trim() || "mockup";
  return `albadi-bag-${sku.replace(/[^\w-]+/g, "_")}`;
}
