"use client";

import React, { useState } from "react";
import { Camera, Film, ImageIcon, Loader2 } from "lucide-react";
import { colors, fontStack, radius, size, space, weight } from "@/lib/ui/tokens";
import {
  downloadBlob,
  downloadDataUrl,
  mockupBaseName,
  pickVideoMimeType,
  pngDataUrlToJpeg,
} from "@/lib/configurator/download-mockup";
import type { ViewerApi } from "./BagViewer3D";

interface CustomerMediaExportsProps {
  captureReady: boolean;
  colorSku?: string | null;
  getScreenshot: () => Promise<string>;
  viewerApiRef: React.RefObject<ViewerApi | null>;
  compact?: boolean;
}

export function CustomerMediaExports({
  captureReady,
  colorSku,
  getScreenshot,
  viewerApiRef,
  compact = false,
}: CustomerMediaExportsProps) {
  const [busy, setBusy] = useState<"png" | "jpg" | "video" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [messageIsError, setMessageIsError] = useState(false);

  const base = mockupBaseName(colorSku);

  const flash = (text: string, isError = false) => {
    setMessage(text);
    setMessageIsError(isError);
    window.setTimeout(() => {
      setMessage(null);
      setMessageIsError(false);
    }, isError ? 5000 : 3000);
  };

  const handlePng = async () => {
    if (!captureReady || busy) return;
    setBusy("png");
    try {
      const dataUrl = await getScreenshot();
      if (!dataUrl) throw new Error("לא ניתן לצלם את התצוגה");
      downloadDataUrl(dataUrl, `${base}.png`);
      flash("תמונת PNG הורדה — מוכנה לשליחה ללקוח");
    } catch (err) {
      flash(err instanceof Error ? err.message : "שגיאה בהורדת תמונה", true);
    } finally {
      setBusy(null);
    }
  };

  const handleJpg = async () => {
    if (!captureReady || busy) return;
    setBusy("jpg");
    try {
      const dataUrl = await getScreenshot();
      if (!dataUrl) throw new Error("לא ניתן לצלם את התצוגה");
      const jpeg = await pngDataUrlToJpeg(dataUrl);
      downloadDataUrl(jpeg, `${base}.jpg`);
      flash("תמונת JPG הורדה — מומלצת לוואטסאפ");
    } catch (err) {
      flash(err instanceof Error ? err.message : "שגיאה בהורדת תמונה", true);
    } finally {
      setBusy(null);
    }
  };

  const handleVideo = async () => {
    if (!captureReady || busy) return;
    const api = viewerApiRef.current;
    if (!api?.recordVideo) return;
    setBusy("video");
    try {
      flash("מקליט סיבוב 360° (כ-8 שניות)…");
      const blob = await api.recordVideo({ seconds: 8, fps: 30 });
      const { extension } = pickVideoMimeType();
      const ext = blob.type.includes("mp4") ? "mp4" : extension;
      downloadBlob(blob, `${base}.${ext}`);
      flash(
        ext === "mp4"
          ? "וידאו MP4 הורד — מוכן לשליחה בוואטסאפ"
          : "וידאו WebM הורד — אם וואטסאפ דוחה, המירו ל-MP4"
      );
    } catch (err) {
      flash(err instanceof Error ? err.message : "שגיאה בהקלטת וידאו", true);
    } finally {
      setBusy(null);
    }
  };

  const btnStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
    flex: compact ? "1 1 100%" : "1 1 auto",
    minWidth: compact ? undefined : 0,
    padding: `${space.sm}px ${space.md}px`,
    borderRadius: radius.md,
    border: `1px solid ${colors.rule}`,
    background: colors.surface,
    color: colors.ink,
    fontFamily: fontStack.body,
    fontSize: size.sm,
    fontWeight: weight.medium,
    cursor: captureReady && !busy ? "pointer" : "not-allowed",
    opacity: captureReady && !busy ? 1 : 0.55,
  };

  return (
    <section
      style={{
        borderRadius: radius.lg,
        border: `1px solid ${colors.rule}`,
        background: colors.surfaceMuted,
        padding: space.lg,
        display: "flex",
        flexDirection: "column",
        gap: space.md,
      }}
    >
      <div>
        <h3
          style={{
            margin: 0,
            fontSize: size.md,
            fontWeight: weight.semibold,
            color: colors.ink,
          }}
        >
          קבצים לשליחה ללקוח
        </h3>
        <p style={{ margin: `${space.xs}px 0 0`, fontSize: size.sm, color: colors.inkMuted }}>
          תמונה או וידאו סיבוב של השקית עם הצבע והלוגו הנוכחיים — בלי PDF.
        </p>
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: space.sm,
        }}
      >
        <button type="button" style={btnStyle} disabled={!captureReady || !!busy} onClick={handlePng}>
          {busy === "png" ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />}
          תמונה PNG
        </button>
        <button type="button" style={btnStyle} disabled={!captureReady || !!busy} onClick={handleJpg}>
          {busy === "jpg" ? <Loader2 className="size-4 animate-spin" /> : <ImageIcon className="size-4" />}
          תמונה JPG
        </button>
        <button type="button" style={btnStyle} disabled={!captureReady || !!busy} onClick={handleVideo}>
          {busy === "video" ? <Loader2 className="size-4 animate-spin" /> : <Film className="size-4" />}
          וידאו סיבוב
        </button>
      </div>

      {message ? (
        <p
          style={{
            margin: 0,
            fontSize: size.sm,
            color: messageIsError ? colors.danger : colors.success,
          }}
        >
          {message}
        </p>
      ) : null}
    </section>
  );
}
