/* eslint-disable jsx-a11y/alt-text */
/**
 * Customer-facing PDF for a finalized factory quote.
 *
 * @react-pdf/renderer JSX → PDF buffer at server runtime (Node, not Edge).
 * Heebo (Google Fonts) registered for Hebrew. Pure ILS display; no cost / profit
 * / supplier ever leaks into the customer's copy.
 */

import {
  Document,
  Page,
  View,
  Text,
  StyleSheet,
  Font,
  renderToBuffer,
} from "@react-pdf/renderer";
import { readFileSync } from "fs";
import { join } from "path";
import type {
  FactoryProductSpec,
  FactoryPricingResult,
} from "./types";
import {
  humanizePrinting,
  humanizeFinishing,
  humanizeMaterial,
} from "./qstate-decode";
import type { QuoteBreakdown } from "./calculator";

// Register Heebo for Hebrew rendering. TTFs are bundled under public/fonts/
// and loaded from disk at module init — no external network dependency, so
// Vercel serverless cold starts can't fail on font fetch.
const FONT_DIR = join(process.cwd(), "public", "fonts");
// @react-pdf/font calls dataUrl.substring() on `src`, so Buffer fails.
// Convert TTFs to base64 data URLs at module init.
function ttfDataUrl(filename: string): string {
  const buf = readFileSync(join(FONT_DIR, filename));
  return `data:font/ttf;base64,${buf.toString("base64")}`;
}
Font.register({
  family: "Heebo",
  fonts: [
    { src: ttfDataUrl("Heebo-Regular.ttf"), fontWeight: 400 },
    { src: ttfDataUrl("Heebo-Bold.ttf"), fontWeight: 700 },
  ],
});

const PRIMARY = "#4A7C59";
const PRIMARY_DARK = "#2D5016";
const BORDER = "#E5E7EB";
const MUTED = "#6B7280";
const FG = "#1A1A1A";

const styles = StyleSheet.create({
  page: {
    fontFamily: "Heebo",
    fontSize: 11,
    color: FG,
    padding: 32,
  },
  header: {
    backgroundColor: PRIMARY,
    color: "#fff",
    padding: 18,
    borderRadius: 8,
    marginBottom: 16,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 700,
    color: "#fff",
    textAlign: "right",
  },
  headerCustomer: {
    fontSize: 14,
    color: "#fff",
    marginTop: 4,
    textAlign: "right",
    opacity: 0.9,
  },
  headerDate: {
    fontSize: 11,
    color: "#fff",
    marginTop: 4,
    textAlign: "right",
    opacity: 0.85,
  },
  priceBox: {
    borderWidth: 1,
    borderColor: PRIMARY,
    backgroundColor: "#F0F7F1",
    borderRadius: 8,
    padding: 14,
    alignItems: "center",
    marginBottom: 16,
  },
  priceMain: {
    fontSize: 28,
    fontWeight: 700,
    color: PRIMARY,
  },
  priceSub: {
    fontSize: 11,
    color: "#555",
    marginTop: 4,
  },
  tableTitle: {
    fontSize: 13,
    fontWeight: 700,
    color: PRIMARY_DARK,
    textAlign: "right",
    marginBottom: 6,
  },
  unitPriceNote: {
    fontSize: 12,
    fontWeight: 700,
    color: FG,
    textAlign: "right",
    marginBottom: 12,
  },
  table: {
    marginBottom: 12,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 6,
    overflow: "hidden",
  },
  thRow: {
    flexDirection: "row-reverse",
    backgroundColor: "#F5F5F5",
    paddingVertical: 6,
  },
  th: {
    fontSize: 10,
    color: MUTED,
    fontWeight: 700,
    paddingHorizontal: 6,
  },
  tdRow: {
    flexDirection: "row-reverse",
    borderBottomWidth: 0.5,
    borderBottomColor: BORDER,
    paddingVertical: 8,
  },
  tdRowTotal: {
    flexDirection: "row-reverse",
    borderTopWidth: 1.5,
    borderTopColor: PRIMARY,
    paddingTop: 10,
    marginTop: 2,
  },
  cellDesc: {
    flex: 2.6,
    fontSize: 11,
    paddingHorizontal: 6,
    textAlign: "right",
  },
  cellUnit: {
    flex: 1,
    fontSize: 11,
    textAlign: "center",
  },
  cellQty: {
    flex: 0.8,
    fontSize: 11,
    textAlign: "center",
  },
  cellTotal: {
    flex: 1.2,
    fontSize: 11,
    fontWeight: 700,
    textAlign: "left",
    paddingHorizontal: 6,
  },
  totalLabel: {
    flex: 2.6,
    fontSize: 12,
    fontWeight: 700,
    paddingHorizontal: 6,
    textAlign: "right",
  },
  totalValue: {
    flex: 1.2,
    fontSize: 13,
    fontWeight: 700,
    color: PRIMARY,
    textAlign: "left",
    paddingHorizontal: 6,
  },
  vatNote: {
    backgroundColor: "#EEF4EE",
    borderWidth: 1,
    borderColor: "#4A6741",
    borderRadius: 8,
    padding: 10,
    marginBottom: 16,
  },
  vatText: {
    fontSize: 11,
    color: PRIMARY_DARK,
    fontWeight: 700,
    textAlign: "center",
  },
  bullets: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  bulletsTitle: {
    fontSize: 12,
    fontWeight: 700,
    marginBottom: 6,
    textAlign: "right",
  },
  bulletLine: {
    fontSize: 11,
    color: "#333",
    textAlign: "right",
    marginBottom: 3,
  },
  bulletRow: {
    flexDirection: "row-reverse",
    alignItems: "flex-start",
    marginBottom: 3,
  },
  bulletMark: {
    fontSize: 11,
    color: "#333",
    width: 12,
    textAlign: "center",
  },
  bulletText: {
    fontSize: 11,
    color: "#333",
    flex: 1,
    textAlign: "right",
  },
  notesBlock: {
    marginBottom: 12,
  },
  notesTitle: {
    fontSize: 11,
    fontWeight: 700,
    marginBottom: 4,
    textAlign: "right",
  },
  notesText: {
    fontSize: 11,
    color: "#333",
    textAlign: "right",
  },
  footer: {
    fontSize: 9,
    color: "#aaa",
    textAlign: "center",
    marginTop: 14,
  },
});

function formatILS(n: number): string {
  return `₪${n.toLocaleString("he-IL", { maximumFractionDigits: 2 })}`;
}

function sizeLabel(spec: FactoryProductSpec): string {
  const parts = [
    spec.widthCm ? `${spec.widthCm}` : null,
    spec.depthCm > 0 ? `${spec.depthCm}` : null,
    spec.heightCm ? `${spec.heightCm}` : null,
  ].filter(Boolean);
  return parts.join("×") + ' ס"מ';
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface CustomerQuotePdfProps {
  customerName: string;
  spec: FactoryProductSpec;
  pricing: FactoryPricingResult;
  /**
   * When present, the PDF renders a multi-row breakdown (base bag, handles,
   * color addon, lamination, plate, shipping) and uses the calculator's
   * total/per-unit numbers. Otherwise falls back to a 2-row honest layout
   * built from FactoryPricingResult.
   */
  breakdown?: QuoteBreakdown | null;
  customerNotes?: string;
  quotationNo?: string;
  validityDays?: number;
}

function CustomerQuotePDF(props: CustomerQuotePdfProps) {
  // quotationNo is intentionally unused in the customer-facing layout —
  // it lives in the filename only (Content-Disposition) for tracking.
  const { customerName, spec, pricing, breakdown, customerNotes } = props;
  const date = new Date().toLocaleDateString("he-IL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  // Strip any CJK (Chinese/Japanese/Korean) leftover from factory data —
  // the customer-facing PDF must be Hebrew-only.
  const stripCjk = (s: string) => (/[　-鿿＀-￯]/.test(s) ? "" : s);
  const printingHe = stripCjk(spec.printing ? humanizePrinting(spec.printing) : "");
  const finishingHe = stripCjk(spec.finishing ? humanizeFinishing(spec.finishing) : "");
  const materialHe = stripCjk(spec.material ? humanizeMaterial(spec.material) : "");
  const qty = breakdown?.quantity ?? pricing.quantity;

  type Row = { desc: string; unit: number; qty: number; total: number };
  const rows: Row[] = [];
  let displayTotalOrder: number;
  let displayUnitPrice: number;

  if (breakdown) {
    // Multi-row breakdown from the local calculator.
    const hasShippingRow = breakdown.shippingPerUnit > 0;
    const baseBagDesc =
      `שקית אלבדי — ${breakdown.dimensions} ס״מ` +
      (hasShippingRow ? "" : " (כולל שילוח רגיל)");

    rows.push({
      desc: baseBagDesc,
      unit: breakdown.baseBagPerUnit,
      qty,
      total: r2(breakdown.baseBagPerUnit * qty),
    });
    if (breakdown.hasHandles && breakdown.handlesPerUnit > 0) {
      rows.push({
        desc: "ידיות",
        unit: breakdown.handlesPerUnit,
        qty,
        total: r2(breakdown.handlesPerUnit * qty),
      });
    }
    if (breakdown.logoColors > 1 && breakdown.colorAddonPerUnit > 0) {
      rows.push({
        desc: `תוספת צבעים בלוגו (${breakdown.logoColors})`,
        unit: breakdown.colorAddonPerUnit,
        qty,
        total: r2(breakdown.colorAddonPerUnit * qty),
      });
    }
    if (breakdown.hasLamination && breakdown.laminationAddonPerUnit > 0) {
      rows.push({
        desc: "למינציה",
        unit: breakdown.laminationAddonPerUnit,
        qty,
        total: r2(breakdown.laminationAddonPerUnit * qty),
      });
    }
    if (breakdown.plateFeePerUnit > 0) {
      rows.push({
        desc: `פלייט למינציה (${breakdown.logoColors})`,
        unit: breakdown.plateFeePerUnit,
        qty,
        total: r2(breakdown.plateFeePerUnit * qty),
      });
    }
    if (hasShippingRow) {
      rows.push({
        desc: `שילוח · ${breakdown.shippingOptionName ?? ""}`.trim(),
        unit: breakdown.shippingPerUnit,
        qty,
        total: r2(breakdown.shippingPerUnit * qty),
      });
    }
    displayTotalOrder = breakdown.totalOrder;
    displayUnitPrice = breakdown.totalPerUnit;
  } else {
    // Fallback: 2-row honest layout from FactoryPricingResult.
    const bagDescParts: string[] = [`שקית אלבדי — ${sizeLabel(spec)}`];
    if (finishingHe) bagDescParts.push(finishingHe);
    if (printingHe) bagDescParts.push(printingHe);
    const bagDesc = bagDescParts.join(" · ");
    const bagUnit = r2(pricing.unitCost + pricing.unitProfit);
    rows.push({
      desc: bagDesc,
      unit: bagUnit,
      qty: pricing.quantity,
      total: r2(bagUnit * pricing.quantity),
    });
    if (!!pricing.shippingOptionName && pricing.unitShipping > 0) {
      rows.push({
        desc: `שילוח · ${pricing.shippingOptionName}`,
        unit: r2(pricing.unitShipping),
        qty: pricing.quantity,
        total: r2(pricing.totalShipping),
      });
    }
    displayTotalOrder = pricing.totalSellingPrice;
    displayUnitPrice = pricing.unitSellingPrice;
  }

  const bullets = [
    `מידות: ${breakdown?.dimensions ?? sizeLabel(spec)} ס״מ`,
    `כמות: ${qty.toLocaleString("he-IL")} יח׳`,
    materialHe ? `חומר: ${materialHe}` : null,
    printingHe ? `הדפסה: ${printingHe}` : null,
    finishingHe ? `גימור: ${finishingHe}` : null,
    (breakdown?.shippingOptionName ?? pricing.shippingOptionName)
      ? `שיטת שילוח: ${breakdown?.shippingOptionName ?? pricing.shippingOptionName}`
      : null,
  ].filter(Boolean) as string[];

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>הצעת מחיר — Albadi</Text>
          {customerName ? (
            <Text style={styles.headerCustomer}>{customerName}</Text>
          ) : null}
          <Text style={styles.headerDate}>{date}</Text>
        </View>

        <View style={styles.priceBox}>
          <Text style={styles.priceMain}>{formatILS(displayTotalOrder)}</Text>
          <Text style={styles.priceSub}>
            מחיר ליחידה: {formatILS(displayUnitPrice)}   ·   כמות:{" "}
            {qty.toLocaleString("he-IL")}
          </Text>
        </View>

        <Text style={styles.tableTitle}>פירוט ההזמנה</Text>
        <View style={styles.table}>
          <View style={styles.thRow}>
            <Text style={[styles.th, { flex: 2.6, textAlign: "right" }]}>תיאור</Text>
            <Text style={[styles.th, { flex: 1, textAlign: "center" }]}>מחיר ליחידה</Text>
            <Text style={[styles.th, { flex: 0.8, textAlign: "center" }]}>כמות</Text>
            <Text style={[styles.th, { flex: 1.2, textAlign: "left" }]}>סך הכל</Text>
          </View>
          {rows.map((r, idx) => (
            <View key={idx} style={styles.tdRow}>
              <Text style={styles.cellDesc}>{r.desc}</Text>
              <Text style={styles.cellUnit}>~{formatILS(r.unit)}</Text>
              <Text style={styles.cellQty}>{r.qty.toLocaleString("he-IL")}</Text>
              <Text style={styles.cellTotal}>~{formatILS(r.total)}</Text>
            </View>
          ))}
          <View style={styles.tdRowTotal}>
            <Text style={styles.totalLabel}>סה״כ לעסקה</Text>
            <Text style={[styles.th, { flex: 1 }]}></Text>
            <Text style={[styles.th, { flex: 0.8 }]}></Text>
            <Text style={styles.totalValue}>{formatILS(displayTotalOrder)}</Text>
          </View>
        </View>

        <Text style={styles.unitPriceNote}>
          מחיר ליחידה: ~{formatILS(displayUnitPrice)}
        </Text>

        <View style={styles.vatNote}>
          <Text style={styles.vatText}>המחיר אינו כולל מע״מ</Text>
        </View>

        <View style={styles.bullets}>
          <Text style={styles.bulletsTitle}>סיכום הזמנה</Text>
          {bullets.map((b, i) => (
            <View key={i} style={styles.bulletRow}>
              <Text style={styles.bulletMark}>•</Text>
              <Text style={styles.bulletText}>{b}</Text>
            </View>
          ))}
        </View>

        {customerNotes && customerNotes.trim() ? (
          <View style={styles.notesBlock}>
            <Text style={styles.notesTitle}>הערות</Text>
            <Text style={styles.notesText}>{customerNotes.trim()}</Text>
          </View>
        ) : null}

        <Text style={styles.footer}>
          ההצעה תקפה ל-14 ימים מיום ההצעה. המחירים נקובים בש״ח וכוללים את כל ההוצאות מלבד מע״מ.
        </Text>
      </Page>
    </Document>
  );
}

/**
 * Render the PDF to a Node Buffer. Call from a Node-runtime route handler.
 */
export async function renderCustomerQuotePdf(
  props: CustomerQuotePdfProps
): Promise<Buffer> {
  return renderToBuffer(<CustomerQuotePDF {...props} />);
}
