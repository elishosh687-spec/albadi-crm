import * as XLSX from "xlsx";
import { DEFAULT_CONFIG } from "@/lib/factory/calculator/constants";

const rows: any[] = [];
for (const p of DEFAULT_CONFIG.products) {
  for (const [vk, v] of [["עם ידיות", p.withHandles], ["בלי ידיות", p.withoutHandles]] as const) {
    const lp = v.laminationPrices ?? {};
    rows.push({
      "מוצר": p.id,
      "מידות": p.dimensions,
      "תיאור": p.description,
      "ידיות": vk,
      "בסיס 1000": v.prices["1000"] ?? "",
      "בסיס 3000": v.prices["3000"] ?? "",
      "בסיס 5000": v.prices["5000"] ?? "",
      "בסיס 10000": v.prices["10000"] ?? "",
      "למינציה 1000": lp["1000"] ?? "",
      "למינציה 3000": lp["3000"] ?? "",
      "למינציה 5000": lp["5000"] ?? "",
      "למינציה 10000": lp["10000"] ?? "",
      "פלטה לצבע (¥)": p.laminationColorPlateFee ?? "",
      "יח׳/קרטון": v.carton.qty,
      "משקל קרטון (ק״ג)": v.carton.weight,
      "קרטון אורך×רוחב×גובה (ס״מ)": `${v.carton.length}×${v.carton.width}×${v.carton.height}`,
    });
  }
}
const ws = XLSX.utils.json_to_sheet(rows);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, "מחירי מפעל (¥ ליחידה)");
const out = "current-factory-prices.xlsx";
XLSX.writeFile(wb, out);
console.log(`✓ נכתב ${out} — ${rows.length} שורות (${DEFAULT_CONFIG.products.length} מוצרים × 2 וריאנטים)`);
