"use client";

import React, { useState } from "react";
import { AlertCircle, CheckCircle2, Download, Loader2 } from "lucide-react";
import jsPDF from "jspdf";
import { Button } from "@/components/ui/Button";
import { colors, radius, size, space } from "@/lib/ui/tokens";
import {
  formatCurrency,
  hasRequiredCustomerFields,
  type CustomerInfo,
  type PricingInfo,
  type QuoteSpec,
} from "./configurator-state";

type FontDoc = jsPDF & {
  addFileToVFS: (name: string, data: string) => void;
  addFont: (postScriptName: string, id: string, style: string) => void;
};

let fontDataPromise: Promise<{ regular: string; bold: string }> | null = null;

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return btoa(binary);
}

interface DownloadPdfButtonProps {
  customerInfo: CustomerInfo;
  pricingInfo: PricingInfo;
  quoteSpec: QuoteSpec;
  bagColorName: string;
  bagColorHex: string;
  hasLogo: boolean;
  screenshotCallback?: () => Promise<string>;
  onAfterDownload?: () => Promise<void>;
  disabled?: boolean;
}

export const DownloadPdfButton: React.FC<DownloadPdfButtonProps> = ({
  customerInfo,
  pricingInfo,
  quoteSpec,
  bagColorName,
  bagColorHex,
  hasLogo,
  screenshotCallback,
  onAfterDownload,
  disabled = false,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const loadFonts = async () => {
    if (!fontDataPromise) {
      fontDataPromise = Promise.all([
        fetch("/fonts/Heebo-Regular.ttf").then(async (response) => {
          if (!response.ok) {
            throw new Error("Unable to load PDF font");
          }
          return arrayBufferToBase64(await response.arrayBuffer());
        }),
        fetch("/fonts/Heebo-Bold.ttf").then(async (response) => {
          if (!response.ok) {
            throw new Error("Unable to load PDF font");
          }
          return arrayBufferToBase64(await response.arrayBuffer());
        }),
      ]).then(([regular, bold]) => ({ regular, bold }));
    }

    return fontDataPromise;
  };

  const generatePdf = async () => {
    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      if (!hasRequiredCustomerFields(customerInfo)) {
        throw new Error("אנא מלא את כל השדות החובה");
      }

      if (!screenshotCallback) {
        throw new Error("תצוגת המוצר עדיין לא מוכנה לייצוא");
      }

      const doc = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
      });
      const fontDoc = doc as FontDoc;
      const fonts = await loadFonts();

      fontDoc.addFileToVFS("Heebo-Regular.ttf", fonts.regular);
      fontDoc.addFileToVFS("Heebo-Bold.ttf", fonts.bold);
      fontDoc.addFont("Heebo-Regular.ttf", "Heebo", "normal");
      fontDoc.addFont("Heebo-Bold.ttf", "Heebo", "bold");
      doc.setFont("Heebo", "normal");

      const pageWidth = 210;
      const pageHeight = 297;
      const margin = 15;
      let yPosition = margin;

      doc.setFillColor(156, 66, 33);
      doc.rect(0, 0, pageWidth, 34, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("Heebo", "bold");
      doc.setFontSize(20);
      doc.text("Albadi Pricing Contract", margin, 16);
      doc.setFont("Heebo", "normal");
      doc.setFontSize(9);
      doc.text("Non-woven bag configuration summary", margin, 24);
      doc.text(new Date().toLocaleDateString("en-GB"), pageWidth - margin, 16, { align: "right" });
      yPosition = 44;

      const sectionTitle = (title: string) => {
        doc.setFont("Heebo", "bold");
        doc.setFontSize(11);
        doc.setTextColor(28, 24, 21);
        doc.text(title, margin, yPosition);
        yPosition += 6;
      };

      const row = (label: string, value: string, options?: { strong?: boolean }) => {
        doc.setFont("Heebo", options?.strong ? "bold" : "normal");
        doc.setFontSize(10);
        doc.setTextColor(115, 107, 98);
        doc.text(label, margin, yPosition);
        doc.setTextColor(28, 24, 21);
        doc.text(value || "-", pageWidth - margin, yPosition, { align: "right" });
        yPosition += 6;
      };

      sectionTitle("Customer details");
      row("Contact name", customerInfo.name);
      row("Company", customerInfo.company || "-");
      row("Email", customerInfo.email);
      row("Phone", customerInfo.phone);
      row("Date", new Date().toLocaleDateString("en-GB"));
      yPosition += 4;

      sectionTitle("Product summary");
      row("Bag size", pricingInfo.productDimensions || quoteSpec.productId);
      row("Selected color", bagColorName);
      row("Logo", hasLogo ? "Uploaded" : "Not uploaded");
      row("Logo colors", `${quoteSpec.logoColors}`);
      row("Handles", quoteSpec.hasHandles ? "Yes" : "No");
      row("Lamination", quoteSpec.hasLamination ? "Yes" : "No");
      row("Shipping", pricingInfo.shippingOptionName || quoteSpec.shippingOptionId);
      row("Quantity", `${pricingInfo.quantity} pcs`);

      doc.setDrawColor(150, 150, 150);
      doc.setFillColor(
        parseInt(bagColorHex.slice(1, 3), 16),
        parseInt(bagColorHex.slice(3, 5), 16),
        parseInt(bagColorHex.slice(5, 7), 16)
      );
      doc.rect(margin, yPosition - 4, 12, 8, "F");
      doc.rect(margin, yPosition - 4, 12, 8);
      doc.setFont("Heebo", "normal");
      doc.setFontSize(9);
      doc.setTextColor(115, 107, 98);
      doc.text("Color swatch", margin + 16, yPosition + 1);
      yPosition += 12;

      sectionTitle("Pricing (ILS)");
      row("Unit price", formatCurrency(pricingInfo.unitPriceIls));
      row("Order total", formatCurrency(pricingInfo.totalOrderIls), { strong: true });
      if (pricingInfo.altShipping) {
        row(
          `Alt. shipping (${pricingInfo.altShipping.shippingOptionName})`,
          formatCurrency(pricingInfo.altShipping.totalOrderIls)
        );
      }
      yPosition += 4;

      const screenshot = await screenshotCallback();
      if (!screenshot) {
        throw new Error("לא ניתן היה ללכוד את תצוגת המוצר עבור ה-PDF");
      }

      sectionTitle("Configured mockup");
      const imageWidth = pageWidth - margin * 2;
      const imageHeight = 90;
      doc.addImage(screenshot, "PNG", margin, yPosition, imageWidth, imageHeight);
      yPosition += imageHeight + 10;

      if (yPosition > pageHeight - 40) {
        doc.addPage();
        yPosition = margin;
      }

      sectionTitle("Terms");
      const terms = [
        "Mockup is an indicative preview and may vary slightly from final production.",
        "Pricing remains subject to final artwork review and production confirmation.",
        "Lead times are confirmed after approval of artwork and quantity.",
        "This MVP contract does not include checkout, storage, or order automation.",
      ];

      terms.forEach((term) => {
        const splitText = doc.splitTextToSize(term, pageWidth - 2 * margin - 5);
        splitText.forEach((line: string) => {
          if (yPosition > pageHeight - 20) {
            doc.addPage();
            yPosition = margin;
          }
          doc.setFont("Heebo", "normal");
          doc.setFontSize(9);
          doc.setTextColor(80, 80, 80);
          doc.text(line, margin + 2, yPosition);
          yPosition += 5;
        });
      });

      doc.setFont("Heebo", "normal");
      doc.setFontSize(8);
      doc.setTextColor(150, 150, 150);
      doc.text(
        "Albadi | pricing-contract-non-woven-bag.pdf",
        pageWidth / 2,
        pageHeight - 10,
        { align: "center" }
      );

      doc.save("pricing-contract-non-woven-bag.pdf");
      if (onAfterDownload) {
        try {
          await onAfterDownload();
        } catch (saveErr) {
          console.warn("[configurator] CRM save after PDF failed", saveErr);
        }
      }
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      const message = err instanceof Error ? err.message : "שגיאה בהפקת PDF";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <Button
        type="button"
        onClick={generatePdf}
        disabled={disabled || loading}
        fullWidth
        size="lg"
        style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: space.sm }}
      >
        {loading ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
        {loading ? "יוצר קובץ..." : "הורד PDF"}
      </Button>

      {error && (
        <div
          style={{
            display: "flex",
            gap: space.sm,
            alignItems: "flex-start",
            padding: space.md,
            borderRadius: radius.lg,
            background: colors.dangerBg,
            border: `1px solid ${colors.danger}`,
            color: colors.danger,
            fontSize: size.sm,
          }}
        >
          <AlertCircle className="size-4 shrink-0" />
          {error}
        </div>
      )}

      {success && (
        <div
          style={{
            display: "flex",
            gap: space.sm,
            alignItems: "flex-start",
            padding: space.md,
            borderRadius: radius.lg,
            background: colors.successBg,
            border: `1px solid ${colors.success}`,
            color: colors.success,
            fontSize: size.sm,
          }}
        >
          <CheckCircle2 className="size-4 shrink-0" />
          הקובץ הורד בהצלחה!
        </div>
      )}

      <p style={{ margin: 0, fontSize: size.xs, color: colors.inkMuted }}>
        המסמך מוכן רק אחרי שתמלא שם, אימייל וטלפון. אם לכידת ה-canvas נכשלת, ההורדה תיעצר עם הודעת שגיאה.
      </p>
    </div>
  );
};

export default DownloadPdfButton;
