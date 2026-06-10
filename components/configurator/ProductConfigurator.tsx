"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  Camera,
  FileText,
  ImagePlus,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { BAG_COLORS } from "@/lib/constants/bagColors";
import { colors, fontStack, radius, size, space, weight } from "@/lib/ui/tokens";
import type { ViewerApi } from "./BagViewer3D";
import PricingContractForm from "./PricingContractForm";
import DownloadPdfButton from "./DownloadPdfButton";
import {
  DEFAULT_CUSTOMER_INFO,
  DEFAULT_PRICING_INFO,
  formatCurrency,
  hasRequiredCustomerFields,
  normalizePricing,
  type CustomerInfo,
  type PricingInfo,
} from "./configurator-state";

const BagViewer3D = dynamic(() => import("./BagViewer3D"), { ssr: false });

const DEFAULT_BAG_COLOR =
  BAG_COLORS.find((color) => color.sku === "C07-115") ?? BAG_COLORS[0];

const DEFAULT_LOGO_STATE = {
  scale: 1,
  positionX: 0,
  positionY: 0.05,
  rotation: 0,
} as const;

const ALLOWED_LOGO_TYPES = ["image/png", "image/jpeg", "image/svg+xml"];
const ALLOWED_LOGO_EXTENSIONS = [".png", ".jpg", ".jpeg", ".svg"];
const MAX_LOGO_FILE_SIZE = 5 * 1024 * 1024;

type DockTab = "color" | "logo" | "quote";

const DOCK_TABS: Array<{ id: DockTab; label: string }> = [
  { id: "color", label: "בד וצבע" },
  { id: "logo", label: "לוגו" },
  { id: "quote", label: "הצעת מחיר" },
];

const PILL_STYLE: React.CSSProperties = {
  background: "rgba(255,255,255,0.92)",
  backdropFilter: "blur(10px)",
  WebkitBackdropFilter: "blur(10px)",
  borderRadius: radius.full,
  border: `1px solid ${colors.ruleSoft}`,
  boxShadow: "0 8px 28px rgba(28,24,21,0.12)",
};

function isSupportedLogoFile(file: File) {
  if (ALLOWED_LOGO_TYPES.includes(file.type)) return true;
  const lower = file.name.toLowerCase();
  return ALLOWED_LOGO_EXTENSIONS.some((extension) => lower.endsWith(extension));
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

function ToolbarButton({
  label,
  onClick,
  active = false,
  disabled = false,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="transition-colors"
      style={{
        width: 38,
        height: 38,
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
}: {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 3, width: 96 }}>
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
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo>(DEFAULT_CUSTOMER_INFO);
  const [pricingInfo, setPricingInfo] = useState<PricingInfo>(
    normalizePricing(DEFAULT_PRICING_INFO)
  );
  const [activeTab, setActiveTab] = useState<DockTab>("color");
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [autoRotate, setAutoRotate] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [captureReady, setCaptureReady] = useState(false);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const viewerApiRef = useRef<ViewerApi | null>(null);
  const selectedSwatchRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (activeTab === "color") {
      selectedSwatchRef.current?.scrollIntoView({ inline: "center", block: "nearest" });
    }
  }, [activeTab]);

  const selectedColor = useMemo(
    () => BAG_COLORS.find((color) => color.hex === selectedColorHex),
    [selectedColorHex]
  );
  const selectedColorName = selectedColor
    ? `${selectedColor.name} (${selectedColor.sku})`
    : selectedColorHex;

  const handleApiReady = useCallback((api: ViewerApi) => {
    viewerApiRef.current = api;
    setCaptureReady(true);
  }, []);

  const getScreenshot = useCallback(async (): Promise<string> => {
    return viewerApiRef.current?.screenshot() ?? "";
  }, []);

  const handleCustomerInfoChange = useCallback((nextCustomerInfo: CustomerInfo) => {
    setCustomerInfo(nextCustomerInfo);
  }, []);

  const handlePricingChange = useCallback((nextPricing: PricingInfo) => {
    const normalized = normalizePricing(nextPricing);
    setPricingInfo(normalized);
    setCustomerInfo((current) =>
      current.quantity === normalized.quantity
        ? current
        : { ...current, quantity: normalized.quantity }
    );
  }, []);

  const resetLogoLayout = () => {
    setLogoScale(DEFAULT_LOGO_STATE.scale);
    setLogoPositionX(DEFAULT_LOGO_STATE.positionX);
    setLogoPositionY(DEFAULT_LOGO_STATE.positionY);
    setLogoRotation(DEFAULT_LOGO_STATE.rotation);
  };

  const handleLogoFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setLogoError(null);

    try {
      if (!isSupportedLogoFile(file)) {
        throw new Error("פורמט לא נתמך — PNG, JPG, JPEG או SVG בלבד");
      }
      if (file.size > MAX_LOGO_FILE_SIZE) {
        throw new Error("הקובץ גדול מדי — עד 5MB");
      }

      const dataUrl = await readFileAsDataUrl(file);
      setLogoUrl(dataUrl);
      setLogoFileName(file.name);
      resetLogoLayout();
    } catch (error) {
      setLogoError(error instanceof Error ? error.message : "שגיאה בקריאת הקובץ");
      setLogoUrl(null);
      setLogoFileName("");
    } finally {
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
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = "albadi-bag-mockup.png";
    link.click();
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
    if (tab === "quote") {
      setQuoteOpen(true);
    }
  };

  const canDownloadPdf = captureReady && hasRequiredCustomerFields(customerInfo);

  return (
    <div
      ref={wrapperRef}
      style={{
        position: "relative",
        width: "100%",
        height: "100dvh",
        overflow: "hidden",
        background: "#f0e9dc",
        fontFamily: fontStack.body,
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

      {/* Full-bleed 3D stage */}
      <div style={{ position: "absolute", inset: 0 }}>
        <React.Suspense fallback={null}>
          <BagViewer3D
            bagColor={selectedColorHex}
            logoUrl={logoUrl}
            logoScale={logoScale}
            logoPositionX={logoPositionX}
            logoPositionY={logoPositionY}
            logoRotation={logoRotation}
            autoRotate={autoRotate}
            showLogoHint={activeTab === "logo"}
            onApiReady={handleApiReady}
          />
        </React.Suspense>
      </div>

      {/* Brand chip */}
      <div
        style={{
          position: "absolute",
          top: 16,
          insetInlineStart: 16,
          display: "inline-flex",
          alignItems: "center",
          gap: space.sm,
          padding: `${space.sm}px ${space.lg}px`,
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
            fontSize: size.md,
            fontWeight: weight.medium,
            color: colors.ink,
            whiteSpace: "nowrap",
          }}
        >
          Albadi · קונפיגורטור שקיות
        </span>
      </div>

      {/* Right vertical toolbar */}
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
        <ToolbarButton
          label="איפוס תצוגה"
          onClick={() => viewerApiRef.current?.resetView()}
          disabled={!captureReady}
        >
          <RotateCcw className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          label={autoRotate ? "עצור סיבוב" : "סיבוב אוטומטי"}
          onClick={() => setAutoRotate((current) => !current)}
          active={autoRotate}
        >
          {autoRotate ? <Pause className="size-4" /> : <Play className="size-4" />}
        </ToolbarButton>
        <ToolbarButton
          label="הורד צילום מסך PNG"
          onClick={handleSnapshotDownload}
          disabled={!captureReady}
        >
          <Camera className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          label="הצעת מחיר ו-PDF"
          onClick={() => {
            setActiveTab("quote");
            setQuoteOpen(true);
          }}
          active={quoteOpen}
        >
          <FileText className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          label={isFullscreen ? "צא ממסך מלא" : "מסך מלא"}
          onClick={toggleFullscreen}
        >
          {isFullscreen ? <Minimize className="size-4" /> : <Maximize className="size-4" />}
        </ToolbarButton>
      </div>

      {/* Bottom dock */}
      <div
        style={{
          position: "absolute",
          bottom: 18,
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 10,
          width: "min(720px, 94vw)",
          zIndex: 10,
        }}
      >
        {/* Contextual pill */}
        {activeTab === "color" ? (
          <>
            <span
              style={{
                fontSize: size.xs,
                color: colors.inkMuted,
                background: "rgba(255,255,255,0.7)",
                borderRadius: radius.full,
                padding: `2px ${space.md}px`,
              }}
            >
              {selectedColorName}
            </span>
            <div
              style={{
                ...PILL_STYLE,
                maxWidth: "100%",
                padding: `${space.sm}px ${space.md}px`,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: space.sm,
                  overflowX: "auto",
                  padding: `${space.xs}px 2px`,
                  scrollbarWidth: "thin",
                }}
              >
                {BAG_COLORS.map((color) => {
                  const isSelected = selectedColorHex === color.hex;
                  return (
                    <button
                      key={color.id}
                      ref={isSelected ? selectedSwatchRef : undefined}
                      type="button"
                      title={`${color.name} · ${color.sku}`}
                      aria-label={`בחר צבע ${color.name} ${color.sku}`}
                      onClick={() => setSelectedColorHex(color.hex)}
                      className="transition-transform hover:scale-110"
                      style={{
                        width: 30,
                        height: 30,
                        flexShrink: 0,
                        borderRadius: radius.full,
                        border: `2px solid ${colors.surface}`,
                        background: color.hex,
                        cursor: "pointer",
                        boxShadow: isSelected
                          ? `0 0 0 2px ${colors.accent}`
                          : `0 0 0 1px ${colors.rule}`,
                        transform: isSelected ? "scale(1.12)" : undefined,
                      }}
                    />
                  );
                })}
              </div>
            </div>
          </>
        ) : null}

        {activeTab === "logo" ? (
          <div
            style={{
              ...PILL_STYLE,
              borderRadius: 24,
              maxWidth: "100%",
              padding: `${space.sm}px ${space.lg}px`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexWrap: "wrap",
              gap: space.lg,
            }}
          >
            {!logoUrl ? (
              <>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: space.sm,
                    padding: `${space.sm}px ${space.lg}px`,
                    borderRadius: radius.full,
                    border: "none",
                    background: colors.ink,
                    color: colors.surface,
                    fontSize: size.sm,
                    fontWeight: weight.medium,
                    cursor: "pointer",
                  }}
                >
                  <ImagePlus className="size-4" />
                  העלה לוגו
                </button>
                <span style={{ fontSize: size.xs, color: colors.inkMuted }}>
                  PNG, JPG או SVG · עד 5MB · מודפס על חזית השקית
                </span>
              </>
            ) : (
              <>
                <button
                  type="button"
                  title="החלף לוגו"
                  aria-label="החלף לוגו"
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    width: 42,
                    height: 42,
                    flexShrink: 0,
                    borderRadius: radius.lg,
                    border: `1px solid ${colors.rule}`,
                    background: colors.surface,
                    padding: 4,
                    cursor: "pointer",
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

                <MiniSlider
                  label="גודל"
                  value={logoScale}
                  display={`${logoScale.toFixed(2)}x`}
                  min={0.4}
                  max={1.9}
                  step={0.05}
                  onChange={setLogoScale}
                />
                <MiniSlider
                  label="אופקי"
                  value={logoPositionX}
                  display={logoPositionX.toFixed(2)}
                  min={-0.85}
                  max={0.85}
                  step={0.01}
                  onChange={setLogoPositionX}
                />
                <MiniSlider
                  label="אנכי"
                  value={logoPositionY}
                  display={logoPositionY.toFixed(2)}
                  min={-0.6}
                  max={0.75}
                  step={0.01}
                  onChange={setLogoPositionY}
                />
                <MiniSlider
                  label="סיבוב"
                  value={logoRotation}
                  display={`${Math.round(logoRotation)}°`}
                  min={-180}
                  max={180}
                  step={1}
                  onChange={setLogoRotation}
                />

                <div style={{ display: "flex", gap: 2 }}>
                  <ToolbarButton label="איפוס מיקום הלוגו" onClick={resetLogoLayout}>
                    <RotateCcw className="size-4" />
                  </ToolbarButton>
                  <ToolbarButton label="הסר לוגו" onClick={handleRemoveLogo}>
                    <Trash2 className="size-4" />
                  </ToolbarButton>
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

        {activeTab === "quote" ? (
          <div
            style={{
              ...PILL_STYLE,
              maxWidth: "100%",
              padding: `${space.sm}px ${space.lg}px`,
              display: "flex",
              alignItems: "center",
              flexWrap: "wrap",
              justifyContent: "center",
              gap: space.lg,
            }}
          >
            <span style={{ fontSize: size.sm, color: colors.inkMuted }}>
              {pricingInfo.quantity} יח׳ ·{" "}
              <strong style={{ color: colors.ink }}>
                {formatCurrency(pricingInfo.totalPrice)}
              </strong>
            </span>
            <button
              type="button"
              onClick={() => setQuoteOpen(true)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: space.sm,
                padding: `${space.sm}px ${space.lg}px`,
                borderRadius: radius.full,
                border: "none",
                background: colors.accent,
                color: colors.surface,
                fontSize: size.sm,
                fontWeight: weight.medium,
                cursor: "pointer",
              }}
            >
              <FileText className="size-4" />
              מלא פרטים והורד PDF
            </button>
          </div>
        ) : null}

        {/* Tabs pill */}
        <div
          style={{
            ...PILL_STYLE,
            display: "inline-flex",
            alignItems: "center",
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
                onClick={() => handleTabSelect(tab.id)}
                className="transition-colors"
                style={{
                  border: "none",
                  borderRadius: radius.full,
                  padding: `${space.sm}px ${space.lg}px`,
                  fontSize: size.sm,
                  fontWeight: isActive ? weight.semibold : weight.regular,
                  background: isActive ? colors.ink : "transparent",
                  color: isActive ? colors.surface : colors.inkMuted,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Quote drawer */}
      {quoteOpen ? (
        <>
          <div
            onClick={() => setQuoteOpen(false)}
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
              width: "min(440px, 100%)",
              background: colors.surface,
              boxShadow: "8px 0 32px rgba(28,24,21,0.18)",
              zIndex: 21,
              overflowY: "auto",
              padding: space.xl,
              display: "flex",
              flexDirection: "column",
              gap: space.xl,
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
                  הצעת מחיר
                </h2>
                <p style={{ margin: `${space.xs}px 0 0`, fontSize: size.sm, color: colors.inkMuted }}>
                  פרטי לקוח, תמחור והורדת PDF עם צילום המוצר.
                </p>
              </div>
              <ToolbarButton label="סגור" onClick={() => setQuoteOpen(false)}>
                <X className="size-4" />
              </ToolbarButton>
            </div>

            <PricingContractForm
              bagColor={selectedColorName}
              hasLogo={!!logoUrl}
              customerInfo={customerInfo}
              pricingInfo={pricingInfo}
              onCustomerInfoChange={handleCustomerInfoChange}
              onPricingChange={handlePricingChange}
            />

            <DownloadPdfButton
              customerInfo={customerInfo}
              pricingInfo={pricingInfo}
              bagColorName={selectedColorName}
              bagColorHex={selectedColorHex}
              hasLogo={!!logoUrl}
              screenshotCallback={getScreenshot}
              disabled={!canDownloadPdf}
            />
          </aside>
        </>
      ) : null}
    </div>
  );
};

export default ProductConfigurator;
