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

// Register Heebo for Hebrew rendering. TTFs are bundled under public/fonts/
// and loaded from disk at module init — no external network dependency, so
// Vercel serverless cold starts can't fail on font fetch.
const FONT_DIR = join(process.cwd(), "public", "fonts");
// @react-pdf/renderer accepts Node Buffer at runtime but its TS type is too
// narrow (string only). Cast through unknown.
Font.register({
  family: "Heebo",
  fonts: [
    {
      src: readFileSync(join(FONT_DIR, "Heebo-Regular.ttf")) as unknown as string,
      fontWeight: 400,
    },
    {
      src: readFileSync(join(FONT_DIR, "Heebo-Bold.ttf")) as unknown as string,
      fontWeight: 700,
    },
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
  table: {
    marginBottom: 16,
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
    flex: 2.2,
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
    flex: 2.2,
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
  const parts = [`W${spec.widthCm}`, spec.depthCm > 0 ? `D${spec.depthCm}` : null, `H${spec.heightCm}`].filter(Boolean);
  return parts.join("×") + " cm";
}

export interface CustomerQuotePdfProps {
  customerName: string;
  spec: FactoryProductSpec;
  pricing: FactoryPricingResult;
  customerNotes?: string;
  quotationNo?: string;
  validityDays?: number;
}

function CustomerQuotePDF(props: CustomerQuotePdfProps) {
  const { customerName, spec, pricing, customerNotes, quotationNo, validityDays = 14 } = props;
  const date = new Date().toLocaleDateString("he-IL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const bullets = [
    `מידות: ${sizeLabel(spec)}`,
    `כמות: ${spec.quantity.toLocaleString("he-IL")} יח'`,
    spec.material ? `חומר: ${spec.material}` : null,
    spec.printing ? `הדפסה: ${spec.printing}` : null,
    spec.finishing ? `גימור: ${spec.finishing}` : null,
    pricing.shippingOptionName ? `שיטת שילוח: ${pricing.shippingOptionName}` : null,
  ].filter(Boolean) as string[];

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>הצעת מחיר — Albadi</Text>
          {customerName ? (
            <Text style={styles.headerCustomer}>{customerName}</Text>
          ) : null}
          <Text style={styles.headerDate}>
            {date}
            {quotationNo ? `   ·   הצעה #${quotationNo}` : ""}
          </Text>
        </View>

        <View style={styles.priceBox}>
          <Text style={styles.priceMain}>{formatILS(pricing.totalSellingPrice)}</Text>
          <Text style={styles.priceSub}>
            מחיר ליחידה: {formatILS(pricing.unitSellingPrice)}   ·   כמות:{" "}
            {pricing.quantity.toLocaleString("he-IL")}
          </Text>
        </View>

        <View style={styles.table}>
          <View style={styles.thRow}>
            <Text style={[styles.th, { flex: 2.2, textAlign: "right" }]}>פריט</Text>
            <Text style={[styles.th, { flex: 1, textAlign: "center" }]}>מחיר ליחידה</Text>
            <Text style={[styles.th, { flex: 0.8, textAlign: "center" }]}>כמות</Text>
            <Text style={[styles.th, { flex: 1.2, textAlign: "left" }]}>סה"כ</Text>
          </View>
          <View style={styles.tdRow}>
            <Text style={styles.cellDesc}>
              {spec.description || "שקיות מותאמות"} ({sizeLabel(spec)})
              {pricing.shippingOptionName ? ` + שילוח ${pricing.shippingOptionName}` : ""}
            </Text>
            <Text style={styles.cellUnit}>{formatILS(pricing.unitSellingPrice)}</Text>
            <Text style={styles.cellQty}>{pricing.quantity.toLocaleString("he-IL")}</Text>
            <Text style={styles.cellTotal}>{formatILS(pricing.totalSellingPrice)}</Text>
          </View>
          <View style={styles.tdRowTotal}>
            <Text style={styles.totalLabel}>סה"כ</Text>
            <Text style={[styles.th, { flex: 1 }]}></Text>
            <Text style={[styles.th, { flex: 0.8 }]}></Text>
            <Text style={styles.totalValue}>{formatILS(pricing.totalSellingPrice)}</Text>
          </View>
        </View>

        <View style={styles.vatNote}>
          <Text style={styles.vatText}>המחיר אינו כולל מע"מ</Text>
        </View>

        <View style={styles.bullets}>
          <Text style={styles.bulletsTitle}>סיכום הזמנה</Text>
          {bullets.map((b, i) => (
            <Text key={i} style={styles.bulletLine}>
              {"• " + b}
            </Text>
          ))}
        </View>

        {customerNotes && customerNotes.trim() ? (
          <View style={styles.notesBlock}>
            <Text style={styles.notesTitle}>הערות</Text>
            <Text style={styles.notesText}>{customerNotes.trim()}</Text>
          </View>
        ) : null}

        <Text style={styles.footer}>
          ההצעה בתוקף {validityDays} ימים. מחירים בש"ח, אינם כוללים מע"מ. כפוף לאישור מפרט סופי.
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
