"use client";

import React, { useRef, useState } from "react";

interface LogoUploaderProps {
  onLogoUpload: (dataUrl: string | null) => void;
  uploadedLogoUrl?: string | null;
}

const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/svg+xml"];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

export const LogoUploader: React.FC<LogoUploaderProps> = ({
  onLogoUpload,
  uploadedLogoUrl,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setError(null);
    setLoading(true);

    try {
      // Validate file type
      if (!ALLOWED_TYPES.includes(file.type)) {
        throw new Error(
          "Invalid file type. Please upload PNG, JPG, JPEG, or SVG."
        );
      }

      // Validate file size
      if (file.size > MAX_FILE_SIZE) {
        throw new Error("File size too large. Maximum 5MB.");
      }

      // Convert to data URL
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        onLogoUpload(dataUrl);
      };
      reader.onerror = () => {
        throw new Error("Failed to read file");
      };
      reader.readAsDataURL(file);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "An error occurred";
      setError(message);
      onLogoUpload(null);
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveLogo = () => {
    onLogoUpload(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-2">
      <label className="block text-sm font-semibold text-gray-700">
        Upload Logo
      </label>

      <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 hover:border-gray-500 transition">
        <input
          ref={fileInputRef}
          type="file"
          accept=".png,.jpg,.jpeg,.svg"
          onChange={handleFileSelect}
          disabled={loading}
          className="w-full cursor-pointer"
        />
        <p className="text-xs text-gray-500 mt-2">
          PNG, JPG, JPEG, or SVG (Max 5MB)
        </p>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
          {error}
        </div>
      )}

      {loading && (
        <div className="text-center text-sm text-gray-600">Loading...</div>
      )}

      {uploadedLogoUrl && (
        <div className="space-y-2">
          <div className="w-full h-20 bg-gray-100 rounded border border-gray-300 p-2 flex items-center justify-center">
            {uploadedLogoUrl.startsWith("data:image/svg") ? (
              <object
                data={uploadedLogoUrl}
                type="image/svg+xml"
                className="h-full max-w-full"
              />
            ) : (
              <img
                src={uploadedLogoUrl}
                alt="Logo preview"
                className="h-full max-w-full object-contain"
              />
            )}
          </div>
          <button
            onClick={handleRemoveLogo}
            className="w-full px-3 py-2 bg-red-100 hover:bg-red-200 text-red-700 text-sm rounded transition"
          >
            Remove Logo
          </button>
        </div>
      )}
    </div>
  );
};

export default LogoUploader;
