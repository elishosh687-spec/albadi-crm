/**
 * Read every catalog tab in the Feishu factory sheet and extract the CONSISTENT
 * heat-press (热压) lamination prices for handle / non-handle at 3000/5000/10000,
 * plus the sewing (车缝) 1000/3000 for reference. Compare against the
 * laminationPrices currently hardcoded in constants.ts. READ-ONLY.
 */
import { feishuFetch } from "@/lib/feishu/client";
import { DEFAULT_CONFIG } from "@/lib/factory/calculator/constants";

const TOKEN = process.env.FEISHU_SHEET_TOKEN!;

// Feishu tab_id → constants product id (by dimension). Retired sizes skipped.
const TAB_TO_PID: Record<string, string> = {
  "1jaRgg": "p1",  // H20-D8(9)-W25
  "2dJziz": "p2",  // H30-D10-W30
  "3lAjWz": "p3",  // H30-D12-W40
  "4juGAu": "p4",  // H40-D15-W50
  "5Hqvwb": "p7",  // H15-D5-W20
  "7TXDpG": "p8",  // H35-D10-W40
  "8gHXUA": "p9",  // H40-D15-W45
  "10PZjB": "p5",  // H30-W40
  "11cZtG": "p6",  // H15-W20
  "13NNAZ": "p12", // H10-W15
  "14ZMnC": "p13", // H25-W25
};

function cellText(c: any): string {
  if (Array.isArray(c)) return c.map((s: any) => s?.text ?? "").join("");
  return c == null ? "" : String(c);
}
function num(s: string): number | null {
  const m = s.replace(/[，,]/g, "").match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}
function qtyOf(s: string): number | null {
  const m = s.match(/(\d{3,6})\s*pcs/i) || s.match(/(\d{3,6})/);
  return m ? parseInt(m[1], 10) : null;
}

async function readTab(tab: string): Promise<any[][]> {
  const range = `${tab}!A1:Z120`;
  const resp = await feishuFetch<any>(
    `/open-apis/sheets/v2/spreadsheets/${TOKEN}/values/${encodeURIComponent(range)}`,
    { method: "GET" }
  );
  return resp.data?.valueRange?.values ?? [];
}

async function main() {
  for (const [tab, pid] of Object.entries(TAB_TO_PID)) {
    const rows = await readTab(tab);
    // group state
    let handle: "Handle" | "Non" | null = null;
    let finishing: "non" | "laminating" | null = null;
    // result: per handle group, method → {qty:price}
    const acc: Record<string, Record<string, Record<number, number>>> = {
      Handle: { heat: {}, sew: {} },
      Non: { heat: {}, sew: {} },
    };
    for (const r of rows) {
      const h = cellText(r[1]).trim();
      const fin = cellText(r[4]).trim().toLowerCase();
      const qcell = cellText(r[5]).trim();
      const price = num(cellText(r[7]));
      if (h === "Handle" || h === "Non") handle = h;
      if (fin === "non" || fin === "laminating") finishing = fin as any;
      else if (fin === "") { /* keep */ }
      if (finishing !== "laminating" || !handle) continue;
      if (!qcell || price == null) continue;
      const isHeat = qcell.includes("热压");
      const isSew = qcell.includes("车缝");
      const q = qtyOf(qcell);
      if (q == null) continue;
      if (isHeat) acc[handle].heat[q] = price;
      else if (isSew) acc[handle].sew[q] = price;
    }

    const prod = DEFAULT_CONFIG.products.find((p) => p.id === pid)!;
    console.log(`\n=== ${pid} ${prod.dimensions} (tab ${tab}) ===`);
    for (const h of ["Handle", "Non"] as const) {
      const variant = h === "Handle" ? prod.withHandles : prod.withoutHandles;
      const cur = variant.laminationPrices ?? {};
      const heat = acc[h].heat, sew = acc[h].sew;
      console.log(
        `  ${h === "Handle" ? "ידיות" : "ללא  "} | ` +
        `Feishu heat-press 3k=${heat[3000] ?? "—"} 5k=${heat[5000] ?? "—"} 10k=${heat[10000] ?? "—"} | ` +
        `sewing 1k=${sew[1000] ?? "—"} 3k=${sew[3000] ?? "—"} || ` +
        `constants.ts 1k=${cur["1000"] ?? "—"} 3k=${cur["3000"] ?? "—"} 5k=${cur["5000"] ?? "—"} 10k=${cur["10000"] ?? "—"}`
      );
    }
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
