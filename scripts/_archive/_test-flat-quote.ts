import { quoteCustomSize } from "../lib/autoresponder/custom-size-quote";
async function main() {
  for (const dims of ["H34*W40", "H30*W40", "H34*D12*W40"]) {
    const r = await quoteCustomSize({
      dimsText: dims, quantity: 10000, hasHandles: true, hasLamination: false,
      logoColors: 1, shippingOptionId: "s2",
    });
    if (r.ok) console.log(dims, "→ ✓", r.dims, "| ליחידה:", r.result.sellingPricePerUnitIls);
    else console.log(dims, "→ ✗", r.reason, "|", r.detail);
  }
}
main().then(() => process.exit(0));
