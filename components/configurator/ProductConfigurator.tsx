"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import {
  Camera,
  Check,
  Copy,
  Download,
  Film,
  Hand,
  ImagePlus,
  Loader2,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  Send,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { BAG_COLORS } from "@/lib/constants/bagColors";
import { colors, fontStack, radius, size, space, weight } from "@/lib/ui/tokens";
import type { LogoPlacementMode, ViewerApi } from "./BagViewer3D";
import { LOGO_POSITION_LIMITS } from "./BagViewer3D";
import { CustomerMediaExports } from "./CustomerMediaExports";
import {
  downloadBlob,
  downloadDataUrl,
  mockupBaseName,
  pickVideoMimeType,
} from "@/lib/configurator/download-mockup";
import {
  DEFAULT_CUSTOMER_INFO,
  type CustomerInfo,
} from "./configurator-state";
import ColorSwatchRail from "./ColorSwatchRail";
import { processLogoFile } from "./logo-assets";
import { useCompactLayout } from "./useCompactLayout";
import { getConfiguratorApiBase } from "@/lib/configurator/urls";
import {
  BAG_SIZE_OPTIONS,
  DEFAULT_BAG_SIZE_OPTION,
} from "@/lib/configurator/bag-models";

const BagViewer3D = dynamic(() => import("./BagViewer3D"), { ssr: false });

const DEFAULT_BAG_COLOR =
  BAG_COLORS.find((color) => color.sku === "C07-115") ?? BAG_COLORS[0];

const DEFAULT_LOGO_STATE = {
  scale: 1,
  positionX: 0,
  positionY: 0.05,
  rotation: 0,
} as const;

type DockTab = "color" | "logo";

const DOCK_TABS: Array<{ id: DockTab; label: string }> = [
  { id: "color", label: "בד וצבע" },
  { id: "logo", label: "לוגו" },
];

const PILL_STYLE: React.CSSProperties = {
  background: "rgba(255,255,255,0.92)",
  backdropFilter: "blur(10px)",
  WebkitBackdropFilter: "blur(10px)",
  borderRadius: radius.full,
  border: `1px solid ${colors.ruleSoft}`,
  boxShadow: "0 8px 28px rgba(28,24,21,0.12)",
};

function ToolbarButton({
  label,
  onClick,
  active = false,
  disabled = false,
  compact = false,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  compact?: boolean;
  children: React.ReactNode;
}) {
  const buttonSize = compact ? 34 : 38;

  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="transition-colors"
      style={{
        width: buttonSize,
        height: buttonSize,
        borderRadius: radius.full,
        border: "none",
        display: "grid",
        placeItems: "center",
        cursor: disabled ? "default" : "pointer",
        background: active ? colors.ink : "transparent",
        color: active ? colors.surface : disabled ? colors.inkSubtle : colors.inkMuted,
      }}
      onMouseEnter={(event) => {
        if (!active && !disabled) event.currentTarget.style.background = colors.surfaceMuted;
      }}
      onMouseLeave={(event) => {
        if (!active) event.currentTarget.style.background = "transparent";
      }}
    >
      {children}
    </button>
  );
}

function MiniSlider({
  label,
  value,
  display,
  min,
  max,
  step,
  onChange,
  compact = false,
}: {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  compact?: boolean;
}) {
  return (
    <label
      className="shrink-0"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 3,
        width: compact ? 78 : 96,
        minWidth: compact ? 78 : 96,
      }}
    >
      <span
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: space.xs,
          fontSize: 10,
          color: colors.inkMuted,
          whiteSpace: "nowrap",
        }}
      >
        {label}
        <span style={{ fontVariantNumeric: "tabular-nums" }}>{display}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        style={{ width: "100%", accentColor: colors.accent, margin: 0 }}
      />
    </label>
  );
}

export const ProductConfigurator: React.FC = () => {
  const searchParams = useSearchParams();
  const sessionToken = searchParams.get("t")?.trim() || null;

  const [selectedColorHex, setSelectedColorHex] = useState<string>(
    DEFAULT_BAG_COLOR?.hex ?? "#2B2A28"
  );
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoFileName, setLogoFileName] = useState("");
  const [logoError, setLogoError] = useState<string | null>(null);
  const [logoScale, setLogoScale] = useState<number>(DEFAULT_LOGO_STATE.scale);
  const [logoPositionX, setLogoPositionX] = useState<number>(DEFAULT_LOGO_STATE.positionX);
  const [logoPositionY, setLogoPositionY] = useState<number>(DEFAULT_LOGO_STATE.positionY);
  const [logoRotation, setLogoRotation] = useState<number>(DEFAULT_LOGO_STATE.rotation);
  const [logoPlacementMode, setLogoPlacementMode] = useState<LogoPlacementMode>("drag");
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo>(DEFAULT_CUSTOMER_INFO);
  const [sizeProductId, setSizeProductId] = useState<string>(
    DEFAULT_BAG_SIZE_OPTION.productId
  );
  const [linkedLeadSid, setLinkedLeadSid] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<DockTab>("color");
  const [autoRotate, setAutoRotate] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [captureReady, setCaptureReady] = useState(false);
  const [logoLoading, setLogoLoading] = useState(false);
  const [colorCopied, setColorCopied] = useState(false);
  const [exportingVideo, setExportingVideo] = useState(false);
  const [exportsOpen, setExportsOpen] = useState(false);
  const [sendState, setSendState] = useState<"idle" | "sending" | "sent" | "error">(
    "idle"
  );
  const [sendError, setSendError] = useState<string | null>(null);

  const isCompact = useCompactLayout();

  const wrapperRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const viewerApiRef = useRef<ViewerApi | null>(null);

  const selectedColor = useMemo(
    () => BAG_COLORS.find((color) => color.hex === selectedColorHex),
    [selectedColorHex]
  );
  const selectedColorClipboardText = selectedColor
    ? `${selectedColor.sku} · ${selectedColor.hex.toUpperCase()}`
    : selectedColorHex.toUpperCase();

  useEffect(() => {
    setColorCopied(false);
  }, [selectedColorHex]);

  useEffect(() => {
    if (!sessionToken) return;
    const apiBase = getConfiguratorApiBase();
    void fetch(`${apiBase}/api/configurator/session/${encodeURIComponent(sessionToken)}`)
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as {
          ok: boolean;
          name?: string;
          phone?: string;
          email?: string;
          manychatSubId?: string;
        };
        if (!data.ok) return;
        setLinkedLeadSid(data.manychatSubId?.trim() || null);
        setCustomerInfo((current) => ({
          ...current,
          name: data.name?.trim() || current.name,
          phone: data.phone?.trim() || current.phone,
          email: data.email?.trim() || current.email,
        }));
      })
      .catch(() => {
        /* prefill is best-effort */
      });
  }, [sessionToken]);

  const handleCopyColorDetails = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(selectedColorClipboardText);
      setColorCopied(true);
      window.setTimeout(() => setColorCopied(false), 1500);
    } catch {
      setColorCopied(false);
    }
  }, [selectedColorClipboardText]);

  const handleApiReady = useCallback((api: ViewerApi) => {
    viewerApiRef.current = api;
    setCaptureReady(true);
  }, []);

  const getScreenshot = useCallback(async (): Promise<string> => {
    return viewerApiRef.current?.screenshot() ?? "";
  }, []);

  const saveDesignToCrm = useCallback(async () => {
    if (!selectedColor) return;
    const apiBase = getConfiguratorApiBase();
    const res = await fetch(`${apiBase}/api/configurator/designs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionToken,
        manychatSubId: linkedLeadSid,
        productId: sizeProductId,
        colorSku: selectedColor.sku,
        colorHex: selectedColor.hex,
        colorName: selectedColor.name,
        logoFileName: logoFileName || null,
        logoScale,
        logoPositionX,
        logoPositionY,
        logoRotation,
        customerName: customerInfo.name,
        customerEmail: customerInfo.email,
        customerPhone: customerInfo.phone,
        notes: customerInfo.notes,
        source: sessionToken ? "crm_link" : "website",
      }),
    });

    if (!res.ok) {
      const errBody = (await res.json().catch(() => null)) as { detail?: string } | null;
      throw new Error(errBody?.detail || `CRM save failed (${res.status})`);
    }

    const data = (await res.json()) as {
      manychatSubId?: string;
      leadCreated?: boolean;
    };
    if (data.manychatSubId) setLinkedLeadSid(data.manychatSubId);
  }, [
    selectedColor,
    sessionToken,
    linkedLeadSid,
    sizeProductId,
    logoFileName,
    logoScale,
    logoPositionX,
    logoPositionY,
    logoRotation,
    customerInfo,
  ]);

  const handleSendToCustomer = useCallback(async () => {
    if (!linkedLeadSid && !sessionToken) return;
    if (!captureReady) return;
    setSendState("sending");
    setSendError(null);
    try {
      const imageDataUrl = await getScreenshot();
      if (!imageDataUrl) throw new Error("לא ניתן ללכוד את התצוגה");
      const apiBase = getConfiguratorApiBase();
      const res = await fetch(`${apiBase}/api/configurator/send-to-customer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionToken,
          manychatSubId: linkedLeadSid,
          imageDataUrl,
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok: boolean; error?: string; detail?: string }
        | null;
      if (!res.ok || !data?.ok) {
        throw new Error(data?.detail || data?.error || `שליחה נכשלה (${res.status})`);
      }
      // Best-effort: persist the design alongside the send.
      void saveDesignToCrm().catch(() => {});
      setSendState("sent");
      window.setTimeout(() => setSendState("idle"), 2500);
    } catch (err) {
      setSendState("error");
      setSendError(err instanceof Error ? err.message : "שליחה נכשלה");
    }
  }, [linkedLeadSid, sessionToken, captureReady, getScreenshot, saveDesignToCrm]);

  const resetLogoLayout = () => {
    setLogoScale(DEFAULT_LOGO_STATE.scale);
    setLogoPositionX(DEFAULT_LOGO_STATE.positionX);
    setLogoPositionY(DEFAULT_LOGO_STATE.positionY);
    setLogoRotation(DEFAULT_LOGO_STATE.rotation);
  };

  const handleLogoPositionChange = useCallback((positionX: number, positionY: number) => {
    setLogoPositionX(positionX);
    setLogoPositionY(positionY);
  }, []);

  const handleLogoFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setLogoError(null);
    setLogoLoading(true);

    try {
      const processed = await processLogoFile(file);
      setLogoUrl(processed.textureUrl);
      setLogoFileName(processed.fileName);
      resetLogoLayout();
    } catch (error) {
      setLogoError(error instanceof Error ? error.message : "שגיאה בקריאת הקובץ");
      setLogoUrl(null);
      setLogoFileName("");
    } finally {
      setLogoLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleRemoveLogo = () => {
    setLogoUrl(null);
    setLogoFileName("");
    setLogoError(null);
    resetLogoLayout();
  };

  const handleSnapshotDownload = async () => {
    const dataUrl = await getScreenshot();
    if (!dataUrl) return;
    downloadDataUrl(dataUrl, `${mockupBaseName(selectedColor?.sku)}.png`);
  };

  const handleVideoDownload = async () => {
    const api = viewerApiRef.current;
    if (!api?.recordVideo || exportingVideo || !captureReady) return;
    setExportingVideo(true);
    try {
      const blob = await api.recordVideo({ seconds: 8, fps: 30 });
      const { extension } = pickVideoMimeType();
      const ext = blob.type.includes("mp4") ? "mp4" : extension;
      downloadBlob(blob, `${mockupBaseName(selectedColor?.sku)}.${ext}`);
    } catch (err) {
      console.warn("[configurator] video export failed", err);
    } finally {
      setExportingVideo(false);
    }
  };

  const toggleFullscreen = () => {
    const element = wrapperRef.current;
    if (!element) return;

    if (document.fullscreenElement) {
      void document.exitFullscreen();
      setIsFullscreen(false);
    } else {
      void element.requestFullscreen?.();
      setIsFullscreen(true);
    }
  };

  const handleTabSelect = (tab: DockTab) => {
    setActiveTab(tab);
  };

  const canSendToCustomer = Boolean(linkedLeadSid && captureReady);

  const stageInset =
    activeTab === "logo" && logoUrl
      ? isCompact
        ? "clamp(220px, 34vh, 280px)"
        : "clamp(188px, 24vh, 228px)"
      : activeTab === "logo"
        ? isCompact
          ? "clamp(168px, 26vh, 220px)"
          : "clamp(148px, 18vh, 188px)"
        : isCompact
          ? "clamp(148px, 22vh, 196px)"
          : "clamp(128px, 16vh, 168px)";

  const toolbarButtons = (
    <>
      <ToolbarButton
        label="איפוס תצוגה"
        onClick={() => viewerApiRef.current?.resetView()}
        disabled={!captureReady}
        compact={isCompact}
      >
        <RotateCcw className={isCompact ? "size-3.5" : "size-4"} />
      </ToolbarButton>
      <ToolbarButton
        label={autoRotate ? "עצור סיבוב" : "סיבוב אוטומטי"}
        onClick={() => setAutoRotate((current) => !current)}
        active={autoRotate}
        compact={isCompact}
      >
        {autoRotate ? (
          <Pause className={isCompact ? "size-3.5" : "size-4"} />
        ) : (
          <Play className={isCompact ? "size-3.5" : "size-4"} />
        )}
      </ToolbarButton>
      <ToolbarButton
        label="הורד תמונה PNG"
        onClick={handleSnapshotDownload}
        disabled={!captureReady}
        compact={isCompact}
      >
        <Camera className={isCompact ? "size-3.5" : "size-4"} />
      </ToolbarButton>
      <ToolbarButton
        label={exportingVideo ? "מקליט וידאו…" : "הורד וידאו סיבוב"}
        onClick={() => void handleVideoDownload()}
        disabled={!captureReady || exportingVideo}
        compact={isCompact}
      >
        {exportingVideo ? (
          <Loader2 className={`${isCompact ? "size-3.5" : "size-4"} animate-spin`} />
        ) : (
          <Film className={isCompact ? "size-3.5" : "size-4"} />
        )}
      </ToolbarButton>
      <ToolbarButton
        label="ייצוא מדיה (תמונה / וידאו)"
        onClick={() => setExportsOpen(true)}
        active={exportsOpen}
        compact={isCompact}
      >
        <Download className={isCompact ? "size-3.5" : "size-4"} />
      </ToolbarButton>
      <ToolbarButton
        label={isFullscreen ? "צא ממסך מלא" : "מסך מלא"}
        onClick={toggleFullscreen}
        compact={isCompact}
      >
        {isFullscreen ? (
          <Minimize className={isCompact ? "size-3.5" : "size-4"} />
        ) : (
          <Maximize className={isCompact ? "size-3.5" : "size-4"} />
        )}
      </ToolbarButton>
    </>
  );

  return (
    <div
      ref={wrapperRef}
      style={{
        position: "relative",
        width: "100%",
        height: "100dvh",
        minHeight: "-webkit-fill-available",
        overflow: "hidden",
        background: "#f0e9dc",
        fontFamily: fontStack.body,
        paddingTop: "env(safe-area-inset-top)",
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".png,.jpg,.jpeg,.svg"
        onChange={handleLogoFileSelect}
        className="hidden"
        aria-label="העלאת קובץ לוגו"
      />

      {/* 3D stage — bottom inset keeps bag + pedestal above the dock */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: stageInset,
        }}
      >
        <React.Suspense fallback={null}>
          <BagViewer3D
            productId={sizeProductId}
            bagColor={selectedColorHex}
            logoUrl={logoUrl}
            logoScale={logoScale}
            logoPositionX={logoPositionX}
            logoPositionY={logoPositionY}
            logoRotation={logoRotation}
            logoPlacementMode={logoUrl ? logoPlacementMode : "controls"}
            onLogoPositionChange={handleLogoPositionChange}
            autoRotate={autoRotate}
            showLogoHint={activeTab === "logo"}
            isCompact={isCompact}
            onApiReady={handleApiReady}
          />
        </React.Suspense>
      </div>

      {/* Brand chip */}
      <div
        className="max-w-[calc(100vw-2rem)]"
        style={{
          position: "absolute",
          top: isCompact ? 10 : 16,
          insetInlineStart: isCompact ? 10 : 16,
          insetInlineEnd: isCompact ? 10 : undefined,
          display: "inline-flex",
          alignItems: "center",
          gap: space.sm,
          padding: isCompact ? `${space.xs}px ${space.md}px` : `${space.sm}px ${space.lg}px`,
          ...PILL_STYLE,
          zIndex: 10,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 8,
            height: 8,
            borderRadius: radius.full,
            background: captureReady ? colors.success : colors.warning,
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontFamily: fontStack.display,
            fontSize: isCompact ? size.sm : size.md,
            fontWeight: weight.medium,
            color: colors.ink,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {isCompact ? "Albadi · שקיות" : "Albadi · קונפיגורטור שקיות"}
        </span>
      </div>

      {/* Desktop / tablet toolbar */}
      {!isCompact ? (
        <div
          style={{
            position: "absolute",
            right: 14,
            top: "50%",
            transform: "translateY(-50%)",
            display: "flex",
            flexDirection: "column",
            gap: 2,
            padding: 5,
            ...PILL_STYLE,
            zIndex: 10,
          }}
        >
          {toolbarButtons}
        </div>
      ) : null}

      {/* Bottom dock */}
      <div
        style={{
          position: "absolute",
          bottom: `calc(${isCompact ? 10 : 18}px + env(safe-area-inset-bottom))`,
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: isCompact ? 8 : 10,
          width: isCompact ? "min(100%, calc(100vw - 16px))" : "min(720px, 94vw)",
          paddingInline: isCompact ? 8 : 0,
          zIndex: 10,
        }}
      >
        {isCompact ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 2,
              padding: 4,
              ...PILL_STYLE,
              width: "100%",
              maxWidth: 360,
            }}
          >
            {toolbarButtons}
          </div>
        ) : null}
        {/* Contextual pill — keep mounted so keen-slider keeps layout when switching tabs */}
        <div
          style={{
            display: activeTab === "color" ? "flex" : "none",
            flexDirection: "column",
            alignItems: "center",
            gap: isCompact ? 8 : 10,
            width: "100%",
          }}
        >
            {/* Size / model selector — changes the displayed 3D bag only */}
            <div
              style={{
                display: "flex",
                flexWrap: "nowrap",
                alignItems: "center",
                gap: 3,
                padding: 4,
                ...PILL_STYLE,
                maxWidth: "100%",
                overflowX: "auto",
                scrollbarWidth: "none",
              }}
              role="tablist"
              aria-label="מידת התיק"
            >
              {BAG_SIZE_OPTIONS.map((option) => {
                const active = sizeProductId === option.productId;
                return (
                  <button
                    key={option.productId}
                    type="button"
                    role="tab"
                    aria-selected={active ? "true" : "false"}
                    title={option.description || option.label}
                    onClick={() => setSizeProductId(option.productId)}
                    className="transition-colors"
                    style={{
                      border: "none",
                      borderRadius: radius.full,
                      padding: isCompact ? `6px ${space.md}px` : `6px ${space.lg}px`,
                      fontSize: isCompact ? size.xs : size.sm,
                      fontWeight: active ? weight.semibold : weight.regular,
                      background: active ? colors.ink : "transparent",
                      color: active ? colors.surface : colors.inkMuted,
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                      minHeight: 34,
                      flexShrink: 0,
                    }}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: space.sm,
                maxWidth: "100%",
                fontSize: size.xs,
                color: colors.inkMuted,
                background: "rgba(255,255,255,0.92)",
                borderRadius: radius.full,
                border: `1px solid ${colors.ruleSoft}`,
                padding: `4px ${space.sm}px 4px ${space.md}px`,
              }}
            >
              <span
                style={{
                  width: 14,
                  height: 14,
                  flexShrink: 0,
                  borderRadius: radius.full,
                  border: `1px solid ${colors.rule}`,
                  background: selectedColorHex,
                }}
                aria-hidden="true"
              />
              <span
                style={{
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  color: colors.ink,
                }}
              >
                {selectedColor?.name ?? "צבע נבחר"}
              </span>
              <code
                style={{
                  flexShrink: 0,
                  fontSize: 10,
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  color: colors.inkMuted,
                  letterSpacing: "0.02em",
                }}
              >
                {selectedColorClipboardText}
              </code>
              <button
                type="button"
                onClick={handleCopyColorDetails}
                title="העתק SKU וקוד צבע"
                aria-label="העתק SKU וקוד צבע"
                style={{
                  flexShrink: 0,
                  width: 28,
                  height: 28,
                  display: "grid",
                  placeItems: "center",
                  borderRadius: radius.full,
                  border: "none",
                  background: colorCopied ? colors.successBg : colors.surfaceMuted,
                  color: colorCopied ? colors.success : colors.inkMuted,
                  cursor: "pointer",
                }}
              >
                {colorCopied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              </button>
            </div>
            <ColorSwatchRail
              colors={BAG_COLORS}
              selectedHex={selectedColorHex}
              onSelect={setSelectedColorHex}
              compact={isCompact}
              visible={activeTab === "color"}
            />
        </div>

        {activeTab === "logo" ? (
          <div
            style={{
              ...PILL_STYLE,
              borderRadius: isCompact ? 20 : 24,
              maxWidth: "100%",
              width: "100%",
              padding: isCompact ? `${space.sm}px ${space.md}px` : `${space.sm}px ${space.lg}px`,
              display: "flex",
              flexDirection: "column",
              alignItems: "stretch",
              gap: space.md,
            }}
          >
            {!logoUrl ? (
              <>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={logoLoading}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: space.sm,
                    padding: `${space.sm}px ${space.lg}px`,
                    borderRadius: radius.full,
                    border: "none",
                    background: colors.ink,
                    color: colors.surface,
                    fontSize: size.sm,
                    fontWeight: weight.medium,
                    cursor: logoLoading ? "wait" : "pointer",
                    opacity: logoLoading ? 0.7 : 1,
                    minHeight: 44,
                  }}
                >
                  <ImagePlus className="size-4" />
                  {logoLoading ? "מעבד לוגו..." : "העלה לוגו"}
                </button>
                <span
                  style={{
                    fontSize: size.xs,
                    color: colors.inkMuted,
                    textAlign: "center",
                    lineHeight: 1.5,
                  }}
                >
                  PNG, JPG או SVG · עד 8MB · איכות גבוהה לתצוגה ו-PDF
                </span>
              </>
            ) : (
              <>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: space.md,
                    width: "100%",
                  }}
                >
                  <button
                    type="button"
                    title="החלף לוגו"
                    aria-label="החלף לוגו"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={logoLoading}
                    style={{
                      width: 44,
                      height: 44,
                      flexShrink: 0,
                      borderRadius: radius.lg,
                      border: `1px solid ${colors.rule}`,
                      background: colors.surface,
                      padding: 4,
                      cursor: logoLoading ? "wait" : "pointer",
                      display: "grid",
                      placeItems: "center",
                      overflow: "hidden",
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={logoUrl}
                      alt={logoFileName || "לוגו"}
                      style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
                    />
                  </button>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        fontSize: size.sm,
                        fontWeight: weight.medium,
                        color: colors.ink,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {logoFileName || "לוגו"}
                    </div>
                    <div style={{ fontSize: size.xs, color: colors.inkMuted }}>
                      {logoPlacementMode === "drag"
                        ? "גרור על השקית · המודל נשאר קבוע"
                        : "בקרות מדויקות · סובב את המודל"}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
                    <ToolbarButton
                      label="איפוס מיקום הלוגו"
                      onClick={resetLogoLayout}
                      compact={isCompact}
                    >
                      <RotateCcw className="size-4" />
                    </ToolbarButton>
                    <ToolbarButton label="הסר לוגו" onClick={handleRemoveLogo} compact={isCompact}>
                      <Trash2 className="size-4" />
                    </ToolbarButton>
                  </div>
                </div>

                <div
                  style={{
                    display: "flex",
                    width: "100%",
                    padding: 3,
                    borderRadius: radius.full,
                    background: colors.surfaceMuted,
                    gap: 3,
                  }}
                  role="tablist"
                  aria-label="אופן מיקום הלוגו"
                >
                  {(
                    [
                      { id: "drag" as const, label: "גרירה על השקית", icon: Hand },
                      { id: "controls" as const, label: "בקרות מדויקות", icon: SlidersHorizontal },
                    ] as const
                  ).map(({ id, label, icon: Icon }) => {
                    const active = logoPlacementMode === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        role="tab"
                        aria-selected={active ? "true" : "false"}
                        onClick={() => setLogoPlacementMode(id)}
                        style={{
                          flex: 1,
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: 6,
                          minHeight: 36,
                          padding: `0 ${space.sm}px`,
                          borderRadius: radius.full,
                          border: "none",
                          background: active ? colors.ink : "transparent",
                          color: active ? colors.surface : colors.inkMuted,
                          fontSize: isCompact ? 11 : size.xs,
                          fontWeight: active ? weight.medium : weight.regular,
                          cursor: "pointer",
                          whiteSpace: "nowrap",
                        }}
                      >
                        <Icon className="size-3.5 shrink-0" />
                        {isCompact ? (id === "drag" ? "גרירה" : "בקרות") : label}
                      </button>
                    );
                  })}
                </div>

                <div
                  className="flex w-full gap-3 overflow-x-auto pb-1"
                  style={{
                    scrollbarWidth: "thin",
                    WebkitOverflowScrolling: "touch",
                  }}
                >
                  <MiniSlider
                    label="גודל"
                    value={logoScale}
                    display={`${logoScale.toFixed(2)}x`}
                    min={0.4}
                    max={1.9}
                    step={0.05}
                    onChange={setLogoScale}
                    compact={isCompact}
                  />
                  {logoPlacementMode === "controls" ? (
                    <>
                      <MiniSlider
                        label="אופקי"
                        value={logoPositionX}
                        display={logoPositionX.toFixed(2)}
                        min={LOGO_POSITION_LIMITS.x.min}
                        max={LOGO_POSITION_LIMITS.x.max}
                        step={0.01}
                        onChange={setLogoPositionX}
                        compact={isCompact}
                      />
                      <MiniSlider
                        label="אנכי"
                        value={logoPositionY}
                        display={logoPositionY.toFixed(2)}
                        min={LOGO_POSITION_LIMITS.y.min}
                        max={LOGO_POSITION_LIMITS.y.max}
                        step={0.01}
                        onChange={setLogoPositionY}
                        compact={isCompact}
                      />
                    </>
                  ) : null}
                  <MiniSlider
                    label="סיבוב"
                    value={logoRotation}
                    display={`${Math.round(logoRotation)}°`}
                    min={-180}
                    max={180}
                    step={1}
                    onChange={setLogoRotation}
                    compact={isCompact}
                  />
                </div>
              </>
            )}

            {logoError ? (
              <span style={{ fontSize: size.xs, color: colors.danger, width: "100%", textAlign: "center" }}>
                {logoError}
              </span>
            ) : null}
          </div>
        ) : null}

        {/* Send-to-customer — only when a contact is linked via ?t session */}
        {sessionToken ? (
          <div
            style={{
              ...PILL_STYLE,
              maxWidth: "100%",
              padding: `${space.xs}px ${space.sm}px`,
              display: "flex",
              alignItems: "center",
              gap: space.sm,
            }}
          >
            <button
              type="button"
              onClick={() => void handleSendToCustomer()}
              disabled={!canSendToCustomer || sendState === "sending"}
              title={
                canSendToCustomer
                  ? "שלח הדמיה ללקוח בוואטסאפ"
                  : "פתח את המעצב מקישור ללקוח כדי לשלוח"
              }
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: space.sm,
                padding: `${space.sm}px ${space.lg}px`,
                borderRadius: radius.full,
                border: "none",
                background:
                  sendState === "sent"
                    ? colors.success
                    : sendState === "error"
                      ? colors.danger
                      : colors.accent,
                color: colors.surface,
                fontSize: size.sm,
                fontWeight: weight.semibold,
                cursor: !canSendToCustomer || sendState === "sending" ? "not-allowed" : "pointer",
                opacity: !canSendToCustomer ? 0.55 : 1,
                minHeight: 40,
              }}
            >
              {sendState === "sending" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : sendState === "sent" ? (
                <Check className="size-4" />
              ) : (
                <Send className="size-4" />
              )}
              {sendState === "sending"
                ? "שולח…"
                : sendState === "sent"
                  ? "נשלח ללקוח"
                  : sendState === "error"
                    ? "נסה שוב"
                    : "שלח ללקוח"}
            </button>
            {!linkedLeadSid ? (
              <span style={{ fontSize: size.xs, color: colors.inkMuted }}>
                אין לקוח מקושר
              </span>
            ) : sendState === "error" && sendError ? (
              <span style={{ fontSize: size.xs, color: colors.danger }}>{sendError}</span>
            ) : null}
          </div>
        ) : null}

        {/* Tabs pill */}
        <div
          style={{
            ...PILL_STYLE,
            display: "inline-flex",
            width: "fit-content",
            maxWidth: "100%",
            alignItems: "center",
            justifyContent: "center",
            gap: 4,
            padding: 4,
          }}
        >
          {DOCK_TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                data-dock-tab={tab.id}
                onClick={() => handleTabSelect(tab.id)}
                className="transition-colors"
                style={{
                  border: "none",
                  borderRadius: radius.full,
                  padding: isCompact
                    ? `${space.sm}px ${space.md}px`
                    : `${space.sm}px ${space.lg}px`,
                  fontSize: isCompact ? size.xs : size.sm,
                  fontWeight: isActive ? weight.semibold : weight.regular,
                  background: isActive ? colors.ink : "transparent",
                  color: isActive ? colors.surface : colors.inkMuted,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  minHeight: 40,
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Exports drawer — visual media (PNG / JPG / video), no pricing */}
      {exportsOpen ? (
        <>
          <div
            onClick={() => setExportsOpen(false)}
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(28,24,21,0.28)",
              zIndex: 20,
            }}
          />
          <aside
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: 0,
              right: isCompact ? 0 : undefined,
              width: isCompact ? "100%" : "min(440px, 100%)",
              background: colors.surface,
              boxShadow: isCompact ? "none" : "8px 0 32px rgba(28,24,21,0.18)",
              zIndex: 21,
              overflowY: "auto",
              padding: isCompact
                ? `calc(${space.lg}px + env(safe-area-inset-top)) ${space.lg}px calc(${space.lg}px + env(safe-area-inset-bottom))`
                : space.xl,
              display: "flex",
              flexDirection: "column",
              gap: isCompact ? space.lg : space.xl,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: space.md,
              }}
            >
              <div>
                <h2
                  style={{
                    margin: 0,
                    fontFamily: fontStack.display,
                    fontSize: size.xl,
                    fontWeight: weight.medium,
                    color: colors.ink,
                  }}
                >
                  ייצוא מדיה
                </h2>
                <p style={{ margin: `${space.xs}px 0 0`, fontSize: size.sm, color: colors.inkMuted }}>
                  הורד תמונה או וידאו סיבוב של השקית עם הצבע והלוגו הנוכחיים.
                </p>
              </div>
              <ToolbarButton label="סגור" onClick={() => setExportsOpen(false)}>
                <X className="size-4" />
              </ToolbarButton>
            </div>

            <CustomerMediaExports
              captureReady={captureReady}
              colorSku={selectedColor?.sku}
              getScreenshot={getScreenshot}
              viewerApiRef={viewerApiRef}
            />
          </aside>
        </>
      ) : null}
    </div>
  );
};

export default ProductConfigurator;
