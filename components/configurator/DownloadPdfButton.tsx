"use client";

import React, { useState } from "react";
import jsPDF from "jspdf";

interface CustomerInfo {
  name: string;
  email: string;
  phone: string;
  company?: string;
  quantity: number;
  notes?: string;
}

interface PricingInfo {
  unitPrice: number;
  setupFee: number;
  quantity: number;
  totalPrice: number;
}

interface DownloadPdfButtonProps {
  customerInfo: CustomerInfo;
  pricingInfo: PricingInfo;
  bagColorName: string;
  bagColorHex: string;
  hasLogo: boolean;
  screenshotCallback?: () => Promise<string>;
  disabled?: boolean;
}

export const DownloadPdfButton: React.FC<DownloadPdfButtonProps> = ({
  customerInfo,
  pricingInfo,
  bagColorName,
  bagColorHex,
  hasLogo,
  screenshotCallback,
  disabled = false,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generatePdf = async () => {
    setLoading(true);
    setError(null);

    try {
      if (!customerInfo.name || !customerInfo.email || !customerInfo.phone) {
        throw new Error("Please fill in all required customer fields");
      }

      const doc = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
      });

      // jsPDF internal dimensions
      const pageWidth = 210; // A4 width in mm
      const pageHeight = 297; // A4 height in mm
      const margin = 15;
      let yPosition = margin;

      // Header
      doc.setFillColor(30, 58, 52); // Navy color
      doc.rect(0, 0, pageWidth, 40, "F");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(24);
      doc.setTextColor(255, 255, 255);
      doc.text("PRICING CONTRACT", margin, 15);

      doc.setFontSize(10);
      doc.setTextColor(200, 200, 200);
      doc.text("Non-woven Custom Bags", margin, 24);

      // Date
      doc.setFontSize(8);
      const today = new Date().toLocaleDateString();
      doc.text(`Generated: ${today}`, pageWidth - margin - 40, 15);

      yPosition = 50;

      // Customer Details Section
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.setTextColor(0, 0, 0);
      doc.text("CUSTOMER DETAILS", margin, yPosition);
      yPosition += 8;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(60, 60, 60);

      const customerFields = [
        `Name: ${customerInfo.name}`,
        `Email: ${customerInfo.email}`,
        `Phone: ${customerInfo.phone}`,
        ...(customerInfo.company ? [`Company: ${customerInfo.company}`] : []),
      ];

      customerFields.forEach((field) => {
        doc.text(field, margin + 5, yPosition);
        yPosition += 6;
      });

      yPosition += 4;

      // Product Details Section
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.setTextColor(0, 0, 0);
      doc.text("PRODUCT DETAILS", margin, yPosition);
      yPosition += 8;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(60, 60, 60);

      const productFields = [
        `Product: Non-woven Custom Tote Bag`,
        `Bag Color: ${bagColorName}`,
        `Quantity: ${pricingInfo.quantity} units`,
        `Logo: ${hasLogo ? "Yes ✓" : "No"}`,
      ];

      productFields.forEach((field) => {
        doc.text(field, margin + 5, yPosition);
        yPosition += 6;
      });

      yPosition += 4;

      // Color Swatch
      doc.setDrawColor(150, 150, 150);
      doc.rect(margin, yPosition - 2, 15, 10);
      doc.setFillColor(
        parseInt(bagColorHex.slice(1, 3), 16),
        parseInt(bagColorHex.slice(3, 5), 16),
        parseInt(bagColorHex.slice(5, 7), 16)
      );
      doc.rect(margin, yPosition - 2, 15, 10, "F");
      doc.setFontSize(9);
      doc.setTextColor(60, 60, 60);
      doc.text("Color Sample", margin + 20, yPosition + 3);

      yPosition += 15;

      // Pricing Section
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.setTextColor(0, 0, 0);
      doc.text("PRICING BREAKDOWN", margin, yPosition);
      yPosition += 8;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(60, 60, 60);

      const pricingLines = [
        {
          label: `Unit Price (${pricingInfo.quantity} @ $${pricingInfo.unitPrice.toFixed(2)}/ea)`,
          value: `$${(pricingInfo.unitPrice * pricingInfo.quantity).toFixed(2)}`,
        },
        {
          label: "Setup Fee",
          value: `$${pricingInfo.setupFee.toFixed(2)}`,
        },
      ];

      pricingLines.forEach(({ label, value }) => {
        doc.text(label, margin + 5, yPosition);
        doc.text(value, pageWidth - margin - 30, yPosition, { align: "right" });
        yPosition += 6;
      });

      // Total
      yPosition += 2;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.setTextColor(0, 86, 184); // Blue
      doc.rect(margin, yPosition - 5, pageWidth - 2 * margin, 10, "F");
      doc.setFillColor(0, 86, 184);
      doc.setTextColor(255, 255, 255);
      doc.text("TOTAL PRICE", margin + 5, yPosition);
      doc.text(`$${pricingInfo.totalPrice.toFixed(2)}`, pageWidth - margin - 5, yPosition, {
        align: "right",
      });

      yPosition += 15;

      // Screenshot Section
      if (screenshotCallback) {
        try {
          const screenshot = await screenshotCallback();
          if (screenshot) {
            doc.setFont("helvetica", "bold");
            doc.setFontSize(12);
            doc.setTextColor(0, 0, 0);
            doc.text("3D MOCKUP", margin, yPosition);
            yPosition += 5;

            const maxWidth = pageWidth - 2 * margin;
            const imgHeight = 50;
            doc.addImage(
              screenshot,
              "PNG",
              margin,
              yPosition,
              maxWidth,
              imgHeight
            );
            yPosition += imgHeight + 5;
          }
        } catch (err) {
          console.error("Failed to capture screenshot:", err);
        }
      }

      // Check if we need a second page
      if (yPosition > pageHeight - 40) {
        doc.addPage();
        yPosition = margin;
      }

      // Terms & Conditions
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(0, 0, 0);
      doc.text("TERMS & CONDITIONS", margin, yPosition);
      yPosition += 7;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(80, 80, 80);

      const terms = [
        "• Final production may vary slightly from the digital mockup.",
        "• Pricing is subject to confirmation after final file review.",
        "• Delivery timeline will be confirmed upon order placement.",
        "• Payment terms: 50% deposit to start, balance due before shipment.",
      ];

      terms.forEach((term) => {
        const splitText = doc.splitTextToSize(term, pageWidth - 2 * margin - 5);
        splitText.forEach((line: string) => {
          if (yPosition > pageHeight - 20) {
            doc.addPage();
            yPosition = margin;
          }
          doc.text(line, margin + 5, yPosition);
          yPosition += 5;
        });
      });

      yPosition += 5;

      // Footer
      doc.setFont("helvetica", "italic");
      doc.setFontSize(8);
      doc.setTextColor(150, 150, 150);
      doc.text(
        "Generated by Albadi Bags - 3D Configurator",
        pageWidth / 2,
        pageHeight - 10,
        { align: "center" }
      );

      // Download the PDF
      const filename = `pricing-contract-${customerInfo.name.replace(
        /\s+/g,
        "-"
      ).toLowerCase()}-${Date.now()}.pdf`;
      doc.save(filename);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to generate PDF";
      setError(message);
      console.error("PDF generation error:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2">
      <button
        onClick={generatePdf}
        disabled={disabled || loading}
        className={`w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition ${
          disabled || loading
            ? "opacity-50 cursor-not-allowed"
            : "hover:shadow-lg"
        }`}
      >
        {loading ? "Generating PDF..." : "📥 Download Pricing Contract"}
      </button>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
          {error}
        </div>
      )}

      <p className="text-xs text-gray-600 text-center">
        Your contract will include customer details, pricing, and a 3D mockup preview.
      </p>
    </div>
  );
};

export default DownloadPdfButton;
