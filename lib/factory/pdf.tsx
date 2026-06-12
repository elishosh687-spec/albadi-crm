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
  Image,
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

// @react-pdf/renderer picks a text's base direction from its first strong
// character, so strings that begin with a number or Latin (dates, sizes,
// "250 גרם food grade ...") get an LTR base and render scrambled. A leading
// RLM forces an RTL base; embedded Latin/number runs still read left-to-right.
const RLM = "‏";
function rtl(s: string): string {
  return s ? RLM + s : s;
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
  /** Product image as a data URI (data:image/...;base64,...). Pre-fetched
   *  server-side via fetchImageDataUri so a broken URL never breaks the PDF. */
  picDataUri?: string;
}

function CustomerQuotePDF(props: CustomerQuotePdfProps) {
  // quotationNo is intentionally unused in the customer-facing layout —
  // it lives in the filename only (Content-Disposition) for tracking.
  const { customerName, spec, pricing, breakdown, customerNotes, picDataUri } = props;
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
    // Multi-row breakdown from the local calculator. Shipping cost is rolled
    // into the base bag row instead of broken out — the customer should never
    // see a separate shipping line item (boss-only data). Method name still
    // appears in the bullets section for transparency.
    const baseBagDesc =
      `${spec.productName?.trim() || "שקית אלבדי"} — ${breakdown.dimensions} ס״מ (כולל שילוח)`;
    const baseBagWithShipping = r2(
      breakdown.baseBagPerUnit + breakdown.shippingPerUnit
    );

    rows.push({
      desc: baseBagDesc,
      unit: baseBagWithShipping,
      qty,
      total: r2(baseBagWithShipping * qty),
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
    displayTotalOrder = breakdown.totalOrder;
    displayUnitPrice = breakdown.totalPerUnit;
  } else {
    // Fallback: 1-row honest layout from FactoryPricingResult. Shipping cost
    // is folded into the bag unit price so no separate line item leaks to
    // the customer.
    const bagDescParts: string[] = [`${spec.productName?.trim() || "שקית אלבדי"} — ${sizeLabel(spec)} (כולל שילוח)`];
    if (finishingHe) bagDescParts.push(finishingHe);
    if (printingHe) bagDescParts.push(printingHe);
    const bagDesc = bagDescParts.join(" · ");
    const bagUnit = r2(pricing.unitSellingPrice);
    rows.push({
      desc: bagDesc,
      unit: bagUnit,
      qty: pricing.quantity,
      total: r2(bagUnit * pricing.quantity),
    });
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

        {picDataUri ? (
          <View style={{ alignItems: "center", marginBottom: 10 }}>
            <Image src={picDataUri} style={{ width: 200, height: 200, objectFit: "contain" }} />
          </View>
        ) : null}

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
              <Text style={styles.cellUnit}>{formatILS(r.unit)}</Text>
              <Text style={styles.cellQty}>{r.qty.toLocaleString("he-IL")}</Text>
              <Text style={styles.cellTotal}>{formatILS(r.total)}</Text>
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
          מחיר ליחידה: {formatILS(displayUnitPrice)}
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

        <Text style={{ fontSize: 10, color: "#333", textAlign: "right", marginTop: 12, fontWeight: "bold" }}>
          מצאתם מחיר זול יותר? שלחו חשבונית ונבדוק אם נוכל להוזיל.
        </Text>

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

/**
 * Fetch a remote image URL and return it as a base64 data URI for embedding in
 * the PDF. Returns undefined on any failure (bad URL, non-image, fetch error)
 * so a broken product image can never break PDF generation.
 */
export async function fetchImageDataUri(
  url?: string
): Promise<string | undefined> {
  if (!url || !/^https?:\/\//i.test(url)) return undefined;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return undefined;
    const ct = resp.headers.get("content-type") ?? "";
    if (!ct.startsWith("image/")) return undefined;
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > 8_000_000) return undefined;
    return `data:${ct};base64,${buf.toString("base64")}`;
  } catch {
    return undefined;
  }
}

// ------------------------------------------------------------
// Combined quote — multiple finalized products in ONE invoice-style table
// (one row per product) with a single grand total at the end.
// ------------------------------------------------------------

export interface CombinedQuoteItem {
  spec: FactoryProductSpec;
  pricing: FactoryPricingResult;
  /** Product image as a data URI (pre-fetched via fetchImageDataUri). */
  picDataUri?: string;
}

export interface CombinedQuotePdfProps {
  customerName: string;
  items: CombinedQuoteItem[];
}

function CombinedQuotePDF({ customerName, items }: CombinedQuotePdfProps) {
  const date = rtl(
    new Date().toLocaleDateString("he-IL", {
      day: "numeric",
      month: "long",
      year: "numeric",
    })
  );
  const stripCjk = (s: string) =>
    /[　-鿿＀-￯]/.test(s) ? "" : s;

  const sections = items.map((it) => {
    const { spec, pricing } = it;
    const printingHe = stripCjk(spec.printing ? humanizePrinting(spec.printing) : "");
    const finishingHe = stripCjk(spec.finishing ? humanizeFinishing(spec.finishing) : "");
    const materialHe = stripCjk(spec.material ? humanizeMaterial(spec.material) : "");
    // No fabricated default name: if the product has no name, the size IS the
    // title. sizeLabel already ends with ס"מ — don't append it again.
    const namePart = spec.productName?.trim();
    const title = rtl(namePart ? `${namePart} — ${sizeLabel(spec)}` : sizeLabel(spec));
    const sub = rtl(
      [materialHe, printingHe, finishingHe, pricing.shippingOptionName || ""]
        .filter(Boolean)
        .join(" · ")
    );
    return {
      title,
      sub,
      unit: r2(pricing.unitSellingPrice),
      qty: pricing.quantity,
      total: r2(pricing.totalSellingPrice),
      picDataUri: it.picDataUri,
    };
  });
  const grandTotal = r2(sections.reduce((s, x) => s + x.total, 0));

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

        <Text style={styles.tableTitle}>
          פירוט ההזמנה ({sections.length.toLocaleString("he-IL")} מוצרים)
        </Text>
        <View style={styles.table}>
          <View style={styles.thRow}>
            <Text style={[styles.th, { flex: 2.6, textAlign: "right" }]}>מוצר</Text>
            <Text style={[styles.th, { flex: 1, textAlign: "center" }]}>מחיר ליחידה</Text>
            <Text style={[styles.th, { flex: 0.8, textAlign: "center" }]}>כמות</Text>
            <Text style={[styles.th, { flex: 1.2, textAlign: "left" }]}>סך הכל</Text>
          </View>
          {sections.map((sec, idx) => (
            <View key={idx} style={styles.tdRow} wrap={false}>
              <View
                style={{
                  flex: 2.6,
                  flexDirection: "row-reverse",
                  alignItems: "center",
                  gap: 6,
                  paddingHorizontal: 6,
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 11, textAlign: "right" }}>{sec.title}</Text>
                  {sec.sub ? (
                    <Text style={{ fontSize: 8, color: MUTED, textAlign: "right", marginTop: 1 }}>
                      {sec.sub}
                    </Text>
                  ) : null}
                </View>
                {sec.picDataUri ? (
                  <Image
                    src={sec.picDataUri}
                    style={{ width: 30, height: 30, objectFit: "contain" }}
                  />
                ) : null}
              </View>
              <Text style={styles.cellUnit}>{formatILS(sec.unit)}</Text>
              <Text style={styles.cellQty}>{sec.qty.toLocaleString("he-IL")}</Text>
              <Text style={styles.cellTotal}>{formatILS(sec.total)}</Text>
            </View>
          ))}
          <View style={styles.tdRowTotal}>
            <Text style={styles.totalLabel}>סה״כ כולל</Text>
            <Text style={[styles.th, { flex: 1 }]}></Text>
            <Text style={[styles.th, { flex: 0.8 }]}></Text>
            <Text style={styles.totalValue}>{formatILS(grandTotal)}</Text>
          </View>
        </View>

        <View style={styles.vatNote}>
          <Text style={styles.vatText}>המחיר אינו כולל מע״מ</Text>
        </View>

        <Text style={{ fontSize: 10, color: "#333", textAlign: "right", marginTop: 12, fontWeight: "bold" }}>
          מצאתם מחיר זול יותר? שלחו חשבונית ונבדוק אם נוכל להוזיל.
        </Text>

        <Text style={styles.footer}>
          ההצעה תקפה ל-14 ימים מיום ההצעה. המחירים נקובים בש״ח וכוללים את כל ההוצאות מלבד מע״מ.
        </Text>
      </Page>
    </Document>
  );
}

/**
 * Render a combined multi-product quote to a Node Buffer.
 */
export async function renderCombinedQuotePdf(
  props: CombinedQuotePdfProps
): Promise<Buffer> {
  return renderToBuffer(<CombinedQuotePDF {...props} />);
}
