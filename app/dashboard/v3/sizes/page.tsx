import { DEFAULT_CONFIG } from "@/lib/factory/calculator/constants";
import { Ruler } from "lucide-react";

export const dynamic = "force-dynamic";

export default function SizesPage() {
  const products = DEFAULT_CONFIG.products.toSorted((a, b) => a.sortOrder - b.sortOrder);

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <div className="grid size-9 place-items-center rounded-lg bg-primary/20">
          <Ruler className="size-5 text-primary" />
        </div>
        <h1 className="text-xl font-semibold">מידות מוצר</h1>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {products.map((p) => (
          <div
            key={p.id}
            className="rounded-xl border border-border bg-card p-4"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground tabular-nums">
                #{p.sortOrder}
              </span>
              <span className="font-mono text-sm font-bold text-primary tabular-nums">
                {p.dimensions}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">{p.description}</p>
            <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
              <span className="rounded-md border border-border bg-background/40 px-2 py-0.5">
                מ-₪{(p.withoutHandles.prices["1000"] * 3.6).toFixed(2)} ל-1,000
              </span>
              <span className="rounded-md border border-border bg-background/40 px-2 py-0.5">
                מ-₪{(p.withoutHandles.prices["10000"] * 3.6).toFixed(2)} ל-10,000
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
