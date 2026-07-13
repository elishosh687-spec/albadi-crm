"use client";

/**
 * Split-shipment calculator — shared across the three quote surfaces:
 *   1. exact calculator  (CalculatorView operator tab)
 *   2. estimate calculator (CalculatorView estimate tab)
 *   3. factory-quote finalize (FinalizeModal)
 *
 * The factory unit price is set by the TOTAL quantity (unchanged) and molds are
 * paid once; ONLY shipping splits. The air portion and the sea portion are each
 * priced on their OWN cartons/CBM/weight (never prorated — air/sea cost is
 * non-linear in volume), then summed into one customer total.
 *
 * Each caller supplies `priceShipmentIls(qty, shippingId)` — the one bit that
 * differs per surface (a preview fetch, an estimate fetch, or a synchronous
 * priceFactoryQuote call). Everything else — the UI, the arithmetic, the
 * customer-facing text — lives here once.
 */

import { useState, useEffect } from "react";
import { Ship, Plane, Copy, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

const r2 = (n: number) => Math.round(n * 100) / 100;
const ils = (n: number) =>
  n.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface SplitShipOption {
  id: string;
  name: string;
}

export interface SplitSpec {
  productLabel: string;
  /** Optional — omit to drop the line entirely (e.g. the factory-quote flow
   *  where handles/lamination aren't tracked as discrete flags). */
  hasHandles?: boolean;
  hasLamination?: boolean;
  logoColors?: number;
  leadName?: string | null;
}

function buildSplitQuoteText(opts: {
  spec: SplitSpec;
  totalQty: number;
  prodUnit: number;
  prodTotal: number;
  airQty: number; airName: string; airIls: number;
  seaQty: number; seaName: string; seaIls: number;
  moldsIls: number;
  grand: number;
}): string {
  const ilsFmt = (n: number) => `₪${n.toLocaleString("he-IL", { maximumFractionDigits: 2 })}`;
  const num = (n: number) => n.toLocaleString("he-IL");
  const greeting = opts.spec.leadName ? `היי ${opts.spec.leadName} 👋` : "היי 👋";
  const lines: (string | null)[] = [
    greeting,
    "",
    "*הצעת מחיר — משלוח מפוצל*",
    "",
    "📦 *פרטי המוצר*",
    `מוצר: ${opts.spec.productLabel}`,
    `כמות כוללת: ${num(opts.totalQty)} יח׳`,
    opts.spec.logoColors != null ? `צבעי לוגו: ${opts.spec.logoColors}` : null,
    opts.spec.hasHandles != null ? `ידיות: ${opts.spec.hasHandles ? "כן" : "ללא"}` : null,
    opts.spec.hasLamination != null ? `למינציה: ${opts.spec.hasLamination ? "כן" : "ללא"}` : null,
    "",
    "💰 *מחיר ליחידה (ייצור — על כל הכמות)*",
    `▪️ ${ilsFmt(opts.prodUnit)} ליחידה`,
    `📦 ${num(opts.totalQty)} × ${ilsFmt(opts.prodUnit)} = ${ilsFmt(opts.prodTotal)}`,
    "",
    "🚚 *פיצול משלוח*",
    `✈️ ${opts.airName} — ${num(opts.airQty)} יח׳: ${ilsFmt(opts.airIls)}`,
    `🚢 ${opts.seaName} — ${num(opts.seaQty)} יח׳: ${ilsFmt(opts.seaIls)}`,
    opts.moldsIls > 0 ? `🧩 תבניות / מולדים (חד פעמי): ${ilsFmt(opts.moldsIls)}` : null,
    "",
    `*💵 סה״כ: ${ilsFmt(opts.grand)}*`,
    "_(לא כולל מע״מ)_",
    "",
    "━━━━━━━━━━━━━━",
    "ההצעה בתוקף ל-14 יום",
    "נשמח לקבל את אישורך 🙂",
  ];
  return lines.filter((l) => l !== null).join("\n");
}

export function SplitShipmentPanel(props: {
  totalQty: number;
  /** Production selling price per unit — margin included, shipping EXCLUDED. */
  prodSellPerUnitIls: number;
  /** One-time molds/templates fee (ILS), charged once. */
  moldsIls: number;
  airOptions: SplitShipOption[];
  seaOptions: SplitShipOption[];
  /** Returns the WHOLE shipment cost (ILS) for `qty` units by `shippingId`. */
  priceShipmentIls: (qty: number, shippingId: string) => Promise<number>;
  spec: SplitSpec;
  /** Optional: send the finished split quote text somewhere (e.g. WhatsApp). */
  onQuoteText?: (text: string) => void;
  /** Optional: report the raw split inputs to the parent (null when off/invalid)
   *  so it can persist them on finalize → official split PDF + WhatsApp caption. */
  onSplitChange?: (
    v: { airQuantity: number; airShippingOptionId: string; seaShippingOptionId: string } | null
  ) => void;
}) {
  const { totalQty, prodSellPerUnitIls, moldsIls, airOptions, seaOptions, priceShipmentIls, spec, onQuoteText, onSplitChange } = props;

  const [enabled, setEnabled] = useState(false);
  const [airQtyStr, setAirQtyStr] = useState("");
  const [airShipId, setAirShipId] = useState(airOptions[0]?.id ?? "");
  const [seaShipId, setSeaShipId] = useState(seaOptions[0]?.id ?? "");
  const [shipCost, setShipCost] = useState<{ airIls: number; seaIls: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const airQty = Math.max(0, Math.round(parseFloat(airQtyStr) || 0));
  const seaQty = totalQty - airQty;
  const splitValid = airQty > 0 && seaQty > 0 && airQty < totalQty;

  useEffect(() => {
    if (!enabled || !splitValid || !airShipId || !seaShipId) { setShipCost(null); return; }
    let cancelled = false;
    setBusy(true); setErr(null);
    (async () => {
      try {
        const [airIls, seaIls] = await Promise.all([
          priceShipmentIls(airQty, airShipId),
          priceShipmentIls(seaQty, seaShipId),
        ]);
        if (cancelled) return;
        setShipCost({ airIls: r2(airIls), seaIls: r2(seaIls) });
      } catch (e) {
        if (!cancelled) { setErr(e instanceof Error ? e.message : String(e)); setShipCost(null); }
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => { cancelled = true; };
  }, [enabled, splitValid, airQty, seaQty, airShipId, seaShipId, priceShipmentIls]);

  // Report the raw split inputs to the parent (server recomputes on finalize).
  useEffect(() => {
    onSplitChange?.(
      enabled && splitValid && airShipId && seaShipId
        ? { airQuantity: airQty, airShippingOptionId: airShipId, seaShippingOptionId: seaShipId }
        : null
    );
  }, [onSplitChange, enabled, splitValid, airQty, airShipId, seaShipId]);

  if (airOptions.length === 0 || seaOptions.length === 0) return null;

  const prodUnit = r2(prodSellPerUnitIls);
  const prodTotal = r2(prodUnit * totalQty);
  const molds = moldsIls > 0 ? r2(moldsIls) : 0;
  const grand = shipCost ? r2(prodTotal + shipCost.airIls + shipCost.seaIls + molds) : null;
  const airName = airOptions.find((s) => s.id === airShipId)?.name ?? "אווירי";
  const seaName = seaOptions.find((s) => s.id === seaShipId)?.name ?? "ימי";

  const quoteText = shipCost && grand !== null
    ? buildSplitQuoteText({
        spec, totalQty, prodUnit, prodTotal,
        airQty, airName, airIls: shipCost.airIls,
        seaQty, seaName, seaIls: shipCost.seaIls,
        moldsIls: molds, grand,
      })
    : "";

  const Row = ({ label, value, strong }: { label: string; value: string; strong?: boolean }) => (
    <div className="flex items-center justify-between gap-3" style={strong ? { fontWeight: 600 } : undefined}>
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );

  return (
    <section className="rounded-xl border border-border bg-card p-4 flex flex-col gap-4" dir="rtl">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Ship className="size-4" />
          <Plane className="size-4" />
          <h3 className="text-sm font-medium">פיצול משלוח — חלק אוויר, חלק ים</h3>
        </div>
        <button
          type="button"
          onClick={() => setEnabled((v) => !v)}
          className={cn(
            "px-3 py-1 rounded text-xs border",
            enabled ? "bg-primary text-primary-foreground border-primary" : "bg-background/30 text-muted-foreground border-border"
          )}
        >
          {enabled ? "פעיל" : "הפעל פיצול"}
        </button>
      </div>

      {enabled && (
        <>
          <p className="text-xs text-muted-foreground">
            מחיר הייצור ליחידה נקבע לפי הכמות הכוללת ({totalQty.toLocaleString("he-IL")} יח׳) ולא משתנה. רק
            השילוח מתפצל — כל חלק מתומחר לפי הנפח שלו. תבניות משולמות פעם אחת.
          </p>

          <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">כמות באוויר ✈️</label>
              <input
                type="number"
                inputMode="numeric"
                value={airQtyStr}
                onChange={(e) => setAirQtyStr(e.target.value)}
                placeholder="למשל 1000"
                className="w-full rounded-md border border-border bg-background/40 px-3 py-2 text-sm tabular-nums"
              />
              <select
                value={airShipId}
                onChange={(e) => setAirShipId(e.target.value)}
                className="w-full rounded-md border border-border bg-background/40 px-2 py-1.5 text-xs"
              >
                {airOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">כמות בים 🚢 (אוטומטי)</label>
              <div className="w-full rounded-md border border-border bg-background/20 px-3 py-2 text-sm tabular-nums text-muted-foreground">
                {splitValid ? seaQty.toLocaleString("he-IL") : "—"}
              </div>
              <select
                value={seaShipId}
                onChange={(e) => setSeaShipId(e.target.value)}
                className="w-full rounded-md border border-border bg-background/40 px-2 py-1.5 text-xs"
              >
                {seaOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>

          {airQtyStr.trim() !== "" && !splitValid && (
            <p className="text-xs text-destructive">
              הכמות באוויר חייבת להיות בין 1 ל-{(totalQty - 1).toLocaleString("he-IL")}.
            </p>
          )}
          {err && <p className="text-xs text-destructive">שגיאה: {err}</p>}

          {busy && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> מחשב שילוח…
            </div>
          )}

          {shipCost && grand !== null && !busy && (
            <div className="flex flex-col gap-2 rounded-lg border border-border bg-background/30 p-4 text-sm">
              <Row label={`ייצור — ${totalQty.toLocaleString("he-IL")} × ₪${ils(prodUnit)}`} value={`₪${ils(prodTotal)}`} />
              <Row label={`✈️ ${airName} — ${airQty.toLocaleString("he-IL")} יח׳`} value={`₪${ils(shipCost.airIls)}`} />
              <Row label={`🚢 ${seaName} — ${seaQty.toLocaleString("he-IL")} יח׳`} value={`₪${ils(shipCost.seaIls)}`} />
              {molds > 0 && <Row label="🧩 תבניות (חד פעמי)" value={`₪${ils(molds)}`} />}
              <div className="border-t border-border my-1" />
              <Row label="סה״כ (לא כולל מע״מ)" value={`₪${ils(grand)}`} strong />

              <div className="flex gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(quoteText).then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1800);
                    });
                  }}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-md border border-border bg-background/40 px-3 py-2 text-xs hover:bg-background/60"
                >
                  {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  {copied ? "הועתק" : "העתק הצעה מפוצלת ללקוח"}
                </button>
                {onQuoteText && (
                  <button
                    type="button"
                    onClick={() => onQuoteText(quoteText)}
                    className="inline-flex items-center justify-center gap-2 rounded-md border border-primary bg-primary/10 px-3 py-2 text-xs text-primary hover:bg-primary/20"
                  >
                    שלח ללקוח
                  </button>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
