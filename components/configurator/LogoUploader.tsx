"use client";

import React, { useEffect, useRef, useState } from "react";
import { ImagePlus, RefreshCcw, Trash2, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { colors, fontStack, radius, size, space, weight } from "@/lib/ui/tokens";

interface LogoUploaderProps {
  onLogoUpload: (dataUrl: string | null) => void;
  uploadedLogoUrl?: string | null;
}

const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/svg+xml"];
const ALLOWED_EXTENSIONS = [".png", ".jpg", ".jpeg", ".svg"];
const MAX_FILE_SIZE = 5 * 1024 * 1024;

function getFileExtension(fileName: string) {
  const lower = fileName.toLowerCase();
  return ALLOWED_EXTENSIONS.find((extension) => lower.endsWith(extension));
}

function isSupportedFile(file: File) {
  return ALLOWED_TYPES.includes(file.type) || Boolean(getFileExtension(file.name));
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("שגיאה בקריאת הקובץ"));
    };

    reader.onerror = () => reject(new Error("שגיאה בקריאת הקובץ"));
    reader.readAsDataURL(file);
  });
}

export const LogoUploader: React.FC<LogoUploaderProps> = ({
  onLogoUpload,
  uploadedLogoUrl,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [fileName, setFileName] = useState("");

  useEffect(() => {
    if (!uploadedLogoUrl) {
      setFileName("");
    }
  }, [uploadedLogoUrl]);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setError(null);
    setLoading(true);

    try {
      if (!isSupportedFile(file)) {
        throw new Error("פורמט קובץ לא תומך. בחר PNG, JPG, JPEG או SVG");
      }

      if (file.size > MAX_FILE_SIZE) {
        throw new Error("הקובץ גדול מדי. גודל מקסימלי: 5MB");
      }

      const dataUrl = await readFileAsDataUrl(file);
      setFileName(file.name);
      onLogoUpload(dataUrl);
    } catch (err) {
      const message = err instanceof Error ? err.message : "שגיאה";
      setError(message);
      onLogoUpload(null);
      setFileName("");
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveLogo = () => {
    onLogoUpload(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    setError(null);
    setFileName("");
  };

  return (
    <div className="space-y-4">
      <input
        ref={fileInputRef}
        type="file"
        accept=".png,.jpg,.jpeg,.svg"
        onChange={handleFileSelect}
        disabled={loading}
        className="hidden"
      />

      {!uploadedLogoUrl ? (
        <div
          style={{
            border: `1px dashed ${colors.rule}`,
            borderRadius: radius.lg,
            padding: space.xl,
            background: colors.surfaceMuted,
            textAlign: "center",
          }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 9999,
              background: colors.surface,
              border: `1px solid ${colors.rule}`,
              display: "grid",
              placeItems: "center",
              margin: "0 auto 12px",
              color: colors.accent,
            }}
          >
            <UploadCloud className="size-5" />
          </div>
          <p
            style={{
              margin: 0,
              color: colors.ink,
              fontSize: size.sm,
              fontWeight: weight.medium,
            }}
          >
            העלה קובץ לוגו לחזית השקית
          </p>
          <p
            style={{
              margin: `${space.sm}px 0 ${space.lg}px`,
              color: colors.inkMuted,
              fontSize: size.xs,
            }}
          >
            PNG, JPG, JPEG או SVG עד 5MB
          </p>
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={() => fileInputRef.current?.click()}
            disabled={loading}
          >
            <span className="inline-flex items-center gap-2">
              <ImagePlus className="size-4" />
              {loading ? "טוען..." : "בחר קובץ"}
            </span>
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div
            style={{
              borderRadius: radius.lg,
              border: `1px solid ${colors.rule}`,
              background: colors.surfaceMuted,
              padding: space.md,
            }}
          >
            <div
              style={{
                height: 128,
                background: colors.surface,
                border: `1px solid ${colors.ruleSoft}`,
                borderRadius: radius.md,
                display: "grid",
                placeItems: "center",
                overflow: "hidden",
              }}
            >
              <img
                src={uploadedLogoUrl}
                alt="Logo preview"
                style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
              />
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: space.sm,
                marginTop: space.md,
                alignItems: "center",
              }}
            >
              <div>
                <div style={{ fontSize: size.xs, color: colors.inkMuted }}>קובץ נבחר</div>
                <div
                  style={{
                    fontSize: size.sm,
                    fontWeight: weight.medium,
                    color: colors.ink,
                    fontFamily: fontStack.body,
                    wordBreak: "break-word",
                  }}
                >
                  {fileName || "Uploaded logo"}
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
            >
              <span className="inline-flex items-center gap-2">
                <RefreshCcw className="size-4" />
                החלף קובץ
              </span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleRemoveLogo}
              style={{ color: colors.danger }}
            >
              <span className="inline-flex items-center gap-2">
                <Trash2 className="size-4" />
                הסר לוגו
              </span>
            </Button>
          </div>
        </div>
      )}

      {error && (
        <div
          style={{
            padding: space.md,
            background: colors.dangerBg,
            border: `1px solid ${colors.danger}`,
            borderRadius: radius.lg,
            color: colors.danger,
            fontSize: size.sm,
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
};

export default LogoUploader;
