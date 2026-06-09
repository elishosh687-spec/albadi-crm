"use client";

import React, { useCallback, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  Download,
  Package2,
  Palette,
  ScanSearch,
  Signature,
} from "lucide-react";
import { BAG_COLORS } from "@/lib/constants/bagColors";
import { Button } from "@/components/ui/Button";
import { Page } from "@/components/ui/Page";
import { colors, fontStack, radius, shadow, size, space, weight } from "@/lib/ui/tokens";
import ColorPalette from "./ColorPalette";
import LogoUploader from "./LogoUploader";
import LogoControls from "./LogoControls";
import PricingContractForm from "./PricingContractForm";
import DownloadPdfButton from "./DownloadPdfButton";
import {
  DEFAULT_CUSTOMER_INFO,
  DEFAULT_PRICING_INFO,
  calculateTotalPrice,
  hasRequiredCustomerFields,
  normalizePricing,
  type CustomerInfo,
  type PricingInfo,
} from "./configurator-state";

const BagViewer3D = dynamic(() => import("./BagViewer3D"), { ssr: false });
const DEFAULT_BAG_COLOR =
  BAG_COLORS.find((color) => color.sku === "C07-115") ?? BAG_COLORS[0];

const PANEL_STYLE: React.CSSProperties = {
  background: colors.surface,
  border: `1px solid ${colors.rule}`,
  borderRadius: radius.xl,
  boxShadow: shadow.raised,
  minWidth: 0,
};

function Panel({
  title,
  description,
  icon,
  children,
  action,
}: {
  title: string;
  description?: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section style={PANEL_STYLE}>
      <div
        style={{
          padding: space.xl,
          borderBottom: `1px solid ${colors.ruleSoft}`,
          display: "flex",
          justifyContent: "space-between",
          gap: space.md,
          alignItems: "flex-start",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", gap: space.md, alignItems: "flex-start" }}>
          <div
            style={{
              width: 40,
              height: 40,
              display: "grid",
              placeItems: "center",
              borderRadius: radius.lg,
              background: colors.surfaceMuted,
              color: colors.accent,
              flexShrink: 0,
            }}
          >
            {icon}
          </div>
          <div>
            <h2
              style={{
                margin: 0,
                fontFamily: fontStack.display,
                fontWeight: weight.medium,
                fontSize: size.xl,
                color: colors.ink,
              }}
            >
              {title}
            </h2>
            {description ? (
              <p
                style={{
                  margin: `${space.xs}px 0 0`,
                  color: colors.inkMuted,
                  fontSize: size.sm,
                }}
              >
                {description}
              </p>
            ) : null}
          </div>
        </div>
        {action}
      </div>
      <div style={{ padding: space.xl }}>{children}</div>
    </section>
  );
}

export const ProductConfigurator: React.FC = () => {
  const [selectedColorHex, setSelectedColorHex] = useState<string>(
    DEFAULT_BAG_COLOR?.hex ?? "#2B2A28"
  );
  const [selectedColorName, setSelectedColorName] = useState<string>(
    DEFAULT_BAG_COLOR ? `${DEFAULT_BAG_COLOR.name} (${DEFAULT_BAG_COLOR.sku})` : "Black"
  );
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoScale, setLogoScale] = useState(1);
  const [logoPositionX, setLogoPositionX] = useState(0);
  const [logoPositionY, setLogoPositionY] = useState(0.05);
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo>(DEFAULT_CUSTOMER_INFO);
  const [pricingInfo, setPricingInfo] = useState<PricingInfo>(
    normalizePricing(DEFAULT_PRICING_INFO)
  );
  const [captureReady, setCaptureReady] = useState(false);

  const screenshotCallbackRef = useRef<(() => Promise<string>) | null>(null);

  const handleColorSelect = (hex: string, name: string) => {
    setSelectedColorHex(hex);
    setSelectedColorName(name);
  };

  const handleLogoUpload = (dataUrl: string | null) => {
    setLogoUrl(dataUrl);
  };

  const handleScreenshotReady = (callback: () => Promise<string>) => {
    screenshotCallbackRef.current = callback;
    setCaptureReady(true);
  };

  const getScreenshot = useCallback(async (): Promise<string> => {
    if (screenshotCallbackRef.current) {
      return screenshotCallbackRef.current();
    }
    return "";
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

  const quickStats = useMemo(
    () => [
      {
        key: "color",
        label: "צבע",
        value: selectedColorName,
        icon: <Palette className="size-4" />,
      },
      {
        key: "logo",
        label: "לוגו",
        value: logoUrl ? "הועלה" : "טרם הועלה",
        icon: <Signature className="size-4" />,
      },
      {
        key: "quantity",
        label: "כמות",
        value: `${pricingInfo.quantity || 0} יח׳`,
        icon: <Package2 className="size-4" />,
      },
      {
        key: "total",
        label: "סה״כ",
        value: new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: "USD",
          minimumFractionDigits: 2,
        }).format(
          calculateTotalPrice(
            pricingInfo.quantity,
            pricingInfo.unitPrice,
            pricingInfo.setupFee
          )
        ),
        icon: <Download className="size-4" />,
      },
    ],
    [logoUrl, pricingInfo.quantity, pricingInfo.setupFee, pricingInfo.unitPrice, selectedColorName]
  );

  const canDownloadPdf = captureReady && hasRequiredCustomerFields(customerInfo);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: colors.paper,
        padding: `${space["2xl"]}px clamp(12px, 4vw, ${space.lg}px) ${space["3xl"]}px`,
        overflowX: "clip",
        width: "100%",
      }}
    >
      <div style={{ width: "100%", maxWidth: 1280, margin: "0 auto", minWidth: 0 }}>
        <Page
          eyebrow="Bag Configurator"
          title="קונפיגורטור שקיות לא ארוגות"
          description="תצוגת מוצר תלת-ממדית, בחירת צבע, מיקום לוגו, תמחור דינמי, וייצוא PDF בקובץ אחד."
          actions={
            <div
              className="hidden sm:flex"
              style={{
                gap: space.sm,
                flexWrap: "wrap",
                justifyContent: "flex-end",
              }}
            >
              {quickStats.slice(0, 2).map((stat) => (
                <div
                  key={stat.key}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: space.sm,
                    padding: `${space.sm}px ${space.md}px`,
                    borderRadius: radius.full,
                    border: `1px solid ${colors.rule}`,
                    background: colors.surface,
                    color: colors.inkMuted,
                    fontSize: size.sm,
                  }}
                >
                  {stat.icon}
                  <span>{stat.value}</span>
                </div>
              ))}
            </div>
          }
        />

        <div
          className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(340px,1fr)]"
          style={{ alignItems: "start" }}
        >
          <Panel
            title="תצוגת מוצר"
            description="סובב, הגדל ובחן את צד החזית לפני הורדת ההצעה."
            icon={<ScanSearch className="size-5" />}
            action={
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: space.xs,
                  padding: `${space.xs}px ${space.sm}px`,
                  borderRadius: radius.full,
                  background: colors.surfaceMuted,
                  color: colors.inkMuted,
                  fontSize: size.xs,
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 9999,
                    background: captureReady ? colors.success : colors.warning,
                  }}
                />
                {captureReady ? "מוכן לייצוא" : "מכין תצוגה"}
              </div>
            }
          >
            <div
              className="aspect-[3/4] min-h-[380px] w-full max-w-full sm:aspect-[5/4] sm:min-h-[420px] lg:aspect-[16/10] xl:aspect-[16/9]"
              style={{
                borderRadius: radius.lg,
                overflow: "hidden",
                border: `1px solid ${colors.rule}`,
                background: colors.surfaceMuted,
              }}
            >
              <React.Suspense
                fallback={
                  <div
                    className="flex h-full min-h-[340px] items-center justify-center sm:min-h-[420px]"
                    style={{ background: colors.surfaceMuted, color: colors.inkMuted }}
                  >
                    <div style={{ textAlign: "center" }}>
                      <div
                        className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4"
                        style={{
                          borderColor: colors.rule,
                          borderTopColor: colors.accent,
                        }}
                      />
                      <p style={{ margin: 0, fontWeight: weight.medium }}>
                        טוען את מודל התצוגה...
                      </p>
                    </div>
                  </div>
                }
              >
                <BagViewer3D
                  bagColor={selectedColorHex}
                  logoUrl={logoUrl}
                  logoScale={logoScale}
                  logoPositionX={logoPositionX}
                  logoPositionY={logoPositionY}
                  onScreenshotReady={handleScreenshotReady}
                />
              </React.Suspense>
            </div>
            <div
              className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
              style={{ color: colors.inkMuted }}
            >
              {quickStats.map((stat) => (
                <div
                  key={stat.key}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: space.md,
                    borderRadius: radius.lg,
                    border: `1px solid ${colors.rule}`,
                    background: colors.surface,
                    padding: space.md,
                  }}
                >
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      display: "grid",
                      placeItems: "center",
                      borderRadius: radius.lg,
                      background: colors.surfaceMuted,
                      color: colors.accent,
                    }}
                  >
                    {stat.icon}
                  </div>
                  <div>
                    <div style={{ fontSize: size.xs, color: colors.inkMuted }}>{stat.label}</div>
                    <div style={{ fontSize: size.sm, color: colors.ink, fontWeight: weight.medium }}>
                      {stat.value}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          <div className="flex min-w-0 flex-col gap-6">
            <Panel
              title="צבעים"
              description="30+ גוונים קבועים לבחירה מהירה."
              icon={<Palette className="size-5" />}
            >
              <ColorPalette
                selectedColor={selectedColorHex}
                onColorSelect={handleColorSelect}
              />
            </Panel>

            <Panel
              title="קובץ לוגו"
              description="PNG, JPG, JPEG או SVG עד 5MB."
              icon={<Signature className="size-5" />}
            >
              <LogoUploader
                onLogoUpload={handleLogoUpload}
                uploadedLogoUrl={logoUrl}
              />
            </Panel>

            <Panel
              title="מיקום לוגו"
              description="שליטה בגודל ובמיקום על חזית השקית."
              icon={<ScanSearch className="size-5" />}
              action={
                logoUrl ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setLogoScale(1);
                      setLogoPositionX(0);
                      setLogoPositionY(0.05);
                    }}
                    style={{ color: colors.inkMuted }}
                  >
                    איפוס
                  </Button>
                ) : undefined
              }
            >
              <LogoControls
                logoScale={logoScale}
                logoPositionX={logoPositionX}
                logoPositionY={logoPositionY}
                onScaleChange={setLogoScale}
                onPositionXChange={setLogoPositionX}
                onPositionYChange={setLogoPositionY}
                hasLogo={!!logoUrl}
              />
            </Panel>
          </div>
        </div>

        <div
          className="mt-6 grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.8fr)]"
          style={{ alignItems: "start" }}
        >
          <Panel
            title="פרטי לקוח ותמחור"
            description="טופס לקוח קצר יחד עם תמחור MVP שניתן לערוך ידנית."
            icon={<Package2 className="size-5" />}
          >
            <PricingContractForm
              bagColor={selectedColorName}
              hasLogo={!!logoUrl}
              customerInfo={customerInfo}
              pricingInfo={pricingInfo}
              onCustomerInfoChange={handleCustomerInfoChange}
              onPricingChange={handlePricingChange}
            />
          </Panel>

          <Panel
            title="PDF להצעת מחיר"
            description="המסמך כולל פרטי לקוח, תמחור, תנאים וצילום mockup מהתצוגה."
            icon={<Download className="size-5" />}
          >
            <DownloadPdfButton
              customerInfo={customerInfo}
              pricingInfo={pricingInfo}
              bagColorName={selectedColorName}
              bagColorHex={selectedColorHex}
              hasLogo={!!logoUrl}
              screenshotCallback={getScreenshot}
              disabled={!canDownloadPdf}
            />
          </Panel>
        </div>
      </div>
    </div>
  );
};

export default ProductConfigurator;
