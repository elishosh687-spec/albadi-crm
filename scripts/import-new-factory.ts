/**
 * Parse newfactory.xlsx → emit DEFAULT_PRODUCTS + DEFAULT_COLOR_ADDONS
 * TypeScript literals to stdout. Match new sheet → existing product `id`
 * by canonical dimension multiset (so descriptions are preserved).
 *
 * Usage:
 *   npx tsx scripts/import-new-factory.ts > scripts/_new-factory-out.ts
 */
import * as XLSX from "xlsx";
import * as path from "path";

const FILE = path.resolve(process.cwd(), "newfactory.xlsx");

// Map canonical dimension key → existing { id, description, sortOrder } from
// current constants.ts so the new data preserves IDs and descriptions when the
// dimension multiset matches.
const EXISTING: Record<string, { id: string; description: string }> = {
  "8,20,25": { id: "p1", description: "מתאים לקוסמטיקה, תכשיטים, אקססוריז" },
  "10,30,30": { id: "p2", description: "מתאים לביגוד קל, מתנות" },
  "12,30,40": { id: "p3", description: "מתאים לנעליים, ביגוד, קופסאות" },
  "15,40,50": { id: "p4", description: "מתאים לפריטים גדולים" },
  "5,15,20": { id: "p7", description: "תיק קטן צר — מתאים למוצרי יוקרה" },
  "10,35,40": { id: "p8", description: "תיק בינוני-גדול — מתאים לביגוד וקופסאות" },
  "15,40,45": { id: "p9", description: "תיק גדול — מתאים לאריזות מתנה גדולות" },
  "20,50,60": { id: "p10", description: "תיק XL — מתאים לפריטים גדולים מאוד" },
  "30,40": { id: "p5", description: "מתאים לפריטים רחבים" },
  "15,20": { id: "p6", description: "מתאים לפריטים קטנים" },
  "8,10": { id: "p11", description: "תיק מיני — מתאים לתכשיטים, מתנות קטנות" },
  "10,15": { id: "p12", description: "תיק קטן — מתאים לאקססוריז" },
  "25,25": { id: "p13", description: "תיק ריבועי — מתאים למוצרים מרובעים" },
  "35,50": { id: "p14", description: "תיק רחב — מתאים לפריטים שטוחים גדולים" },
};

function dimKey(dimsStr: string): string {
  return dimsStr
    .split(/[*xX]/)
    .map((p) => parseInt(p.replace(/[^0-9]/g, ""), 10))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b)
    .join(",");
}

interface RowRec {
  handle: "Handle" | "Non";
  printing: string;
  finishing: "non" | "laminating";
  method: "热压" | "车缝";
  qty: number;
  price: number;
  carton?: { qty: number; weight: number; length: number; width: number; height: number };
}

function parseSheet(ws: XLSX.WorkSheet): { dims: string; rows: RowRec[]; plateFee: number } {
  const rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: null });
  // Skip first 6 header rows. Data starts at row index 6 (row 7).
  const body = rows.slice(6).filter((r) => r.some((c: any) => c !== null && c !== ""));

  let lastHandle: "Handle" | "Non" | null = null;
  let lastFinishing: "non" | "laminating" | null = null;
  let dims = "";
  let plateFee = 0;
  const out: RowRec[] = [];

  for (const r of body) {
    if (r[0]) dims = String(r[0]); // size cell when present
    if (r[1] === "Handle" || r[1] === "Non") lastHandle = r[1];
    if (r[4] === "non" || r[4] === "laminating") lastFinishing = r[4];

    // Plate fee: prefer Remark col 14 "版费：N元/色" — authoritative when col 6
    // contradicts (e.g. H35*W50 col 6 says 300 but Remark says 400). Fall back
    // to col 6 "1color:￥N\n...".
    if (plateFee === 0 && lastFinishing === "laminating") {
      const cell6 = String(r[6] ?? "");
      const cell14 = String(r[14] ?? "");
      const m14 = cell14.match(/版费\s*[:：]\s*(\d+)\s*元/);
      const m6 = cell6.match(/1color\s*[:：]\s*[￥¥]?\s*(\d+)/);
      if (m14) plateFee = parseInt(m14[1], 10);
      else if (m6) plateFee = parseInt(m6[1], 10);
    }

    const qtyCell = r[5];
    const priceCell = r[7];
    if (!qtyCell || priceCell === null || priceCell === undefined) continue;

    const qtyMatch = String(qtyCell).match(/(热压|车缝)(\d+)pcs/);
    if (!qtyMatch) continue;
    const method = qtyMatch[1] as "热压" | "车缝";
    const qty = parseInt(qtyMatch[2], 10);
    const price = typeof priceCell === "number" ? priceCell : parseFloat(String(priceCell));
    if (!Number.isFinite(price)) continue;

    const rec: RowRec = {
      handle: lastHandle!,
      printing: String(r[3] ?? ""),
      finishing: lastFinishing!,
      method,
      qty,
      price,
    };

    // Carton info only on first row of a variant (when col I is set)
    if (r[8] !== null && r[8] !== undefined && r[8] !== "") {
      rec.carton = {
        qty: Number(r[8]),
        length: Number(r[9]),
        width: Number(r[10]),
        height: Number(r[11]),
        weight: Number(r[13]),
      };
    }
    out.push(rec);
  }

  return { dims, rows: out, plateFee };
}

interface Variant {
  prices: Record<string, number>;
  carton: { qty: number; weight: number; length: number; width: number; height: number };
  laminationPrices: Record<string, number>;
}

interface Product {
  id: string;
  dimensions: string;
  description: string;
  sortOrder: number;
  laminationColorPlateFee: number;
  withHandles: Variant;
  withoutHandles: Variant;
}

function buildVariant(rows: RowRec[], handle: "Handle" | "Non"): Variant {
  const variantRows = rows.filter((r) => r.handle === handle);
  const carton = variantRows.find((r) => r.carton)?.carton;
  if (!carton) throw new Error(`No carton info for ${handle}`);

  const prices: Record<string, number> = {};
  const laminationPrices: Record<string, number> = {};

  for (const r of variantRows) {
    // non-lam, 1color only (we use 1c as baseline; addons stored in colorAddons)
    if (r.finishing === "non" && r.printing.trim() === "1color") {
      prices[String(r.qty)] = r.price;
    }
    // lamination: take any color row (uniform price)
    if (r.finishing === "laminating") {
      laminationPrices[String(r.qty)] = r.price;
    }
  }

  return { prices, carton, laminationPrices };
}

function deltaPerQty(rows: RowRec[], handle: "Handle" | "Non", from: string, to: string): Record<string, number> {
  const out: Record<string, number> = {};
  const filtered = rows.filter((r) => r.handle === handle && r.finishing === "non");
  for (const qty of [1000, 3000, 5000, 10000]) {
    const a = filtered.find((r) => r.qty === qty && r.printing.trim() === from);
    const b = filtered.find((r) => r.qty === qty && r.printing.trim() === to);
    if (a && b) out[String(qty)] = Math.round((b.price - a.price) * 100) / 100;
  }
  return out;
}

function fmtNum(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

function fmtPriceObj(obj: Record<string, number>): string {
  const keys = Object.keys(obj).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  return "{ " + keys.map((k) => `"${k}": ${fmtNum(obj[k])}`).join(", ") + " }";
}

function fmtCarton(c: Variant["carton"]): string {
  return `{ qty: ${c.qty}, weight: ${fmtNum(c.weight)}, length: ${c.length}, width: ${c.width}, height: ${c.height} }`;
}

function main() {
  const wb = XLSX.readFile(FILE);
  // Skip first sheet (Overview)
  const sizeSheets = wb.SheetNames.slice(1);

  const products: Product[] = [];
  const allDeltas2c: Record<string, number[]> = { "1000": [], "3000": [], "5000": [], "10000": [] };
  const allDeltas3c: Record<string, number[]> = { "1000": [], "3000": [], "5000": [], "10000": [] };

  let sortOrder = 1;
  for (const name of sizeSheets) {
    const { dims, rows, plateFee } = parseSheet(wb.Sheets[name]);
    const key = dimKey(dims);
    const existing = EXISTING[key];
    if (!existing) {
      console.error(`WARN: sheet ${name} dims ${dims} (key ${key}) — no existing match. Using fallback id.`);
    }
    if (plateFee === 0) {
      console.error(`WARN: sheet ${name} — no plate fee parsed from xlsx; defaulting to 300.`);
    }

    const withHandles = buildVariant(rows, "Handle");
    const withoutHandles = buildVariant(rows, "Non");

    products.push({
      id: existing?.id ?? `pX${sortOrder}`,
      dimensions: dims,
      description: existing?.description ?? "",
      sortOrder: sortOrder++,
      laminationColorPlateFee: plateFee > 0 ? plateFee : 300,
      withHandles,
      withoutHandles,
    });

    // Collect color-addon deltas from this sheet (Handle variant — values are
    // identical to Non in the file, so either works).
    const d2 = deltaPerQty(rows, "Handle", "1color", "2color");
    const d3 = deltaPerQty(rows, "Handle", "1color", "3color");
    for (const q of ["3000", "5000", "10000"]) {
      if (d2[q] !== undefined) allDeltas2c[q].push(d2[q]);
      if (d3[q] !== undefined) allDeltas3c[q].push(d3[q]);
    }
  }

  // Sort products by id numeric (p1, p2, ...) for stable output
  products.sort((a, b) => parseInt(a.id.replace(/\D/g, ""), 10) - parseInt(b.id.replace(/\D/g, ""), 10));
  // Reassign sortOrder by final order
  products.forEach((p, i) => (p.sortOrder = i + 1));

  // Average deltas per qty. For tier 1000 (only stitched 1c in file) preserve
  // existing values: 2c=0.18, 3c=0.37 (no factory data → unchanged).
  function avg(arr: number[]): number {
    if (!arr.length) return 0;
    return Math.round((arr.reduce((s, n) => s + n, 0) / arr.length) * 100) / 100;
  }
  const colorAddons2c = {
    "1000": 0.18,
    "3000": avg(allDeltas2c["3000"]),
    "5000": avg(allDeltas2c["5000"]),
    "10000": avg(allDeltas2c["10000"]),
  };
  const colorAddons3c = {
    "1000": 0.37,
    "3000": avg(allDeltas3c["3000"]),
    "5000": avg(allDeltas3c["5000"]),
    "10000": avg(allDeltas3c["10000"]),
  };

  // Emit TypeScript literals
  console.log("// === DEFAULT_PRODUCTS ===");
  console.log("const DEFAULT_PRODUCTS: Product[] = [");
  for (const p of products) {
    console.log(`  {`);
    console.log(`    id: ${JSON.stringify(p.id)}, dimensions: ${JSON.stringify(p.dimensions)}, description: ${JSON.stringify(p.description)}, sortOrder: ${p.sortOrder},`);
    console.log(`    laminationColorPlateFee: ${p.laminationColorPlateFee},`);
    console.log(`    withHandles: { prices: ${fmtPriceObj(p.withHandles.prices)}, carton: ${fmtCarton(p.withHandles.carton)}, laminationPrices: ${fmtPriceObj(p.withHandles.laminationPrices)} },`);
    console.log(`    withoutHandles: { prices: ${fmtPriceObj(p.withoutHandles.prices)}, carton: ${fmtCarton(p.withoutHandles.carton)}, laminationPrices: ${fmtPriceObj(p.withoutHandles.laminationPrices)} },`);
    console.log(`  },`);
  }
  console.log("];");
  console.log("");
  console.log("// === DEFAULT_COLOR_ADDONS ===");
  console.log("const DEFAULT_COLOR_ADDONS: ColorAddon[] = [");
  console.log(`  { colors: 1, pricesByQuantity: { "1000": 0, "3000": 0, "5000": 0, "10000": 0 } },`);
  console.log(`  { colors: 2, pricesByQuantity: ${fmtPriceObj(colorAddons2c)} },`);
  console.log(`  { colors: 3, pricesByQuantity: ${fmtPriceObj(colorAddons3c)} },`);
  console.log("];");
}

main();
