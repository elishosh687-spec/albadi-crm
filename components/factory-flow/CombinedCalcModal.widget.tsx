"use client";

/**
 * Unified multi-product calc window (widget side).
 *
 * Opened from a customer card in QuotesHistoryView. Shows ALL of that
 * customer's priceable quotes as an accordion — one section per product with
 * the full editable breakdown (spec fields, margin slider, shipping, boss
 * breakdown), exactly like the single-product FinalizeModal but stacked on one
 * screen. A combined summary at the bottom reuses lib/factory/combined.ts.
 *
 * Two SEPARATE actions (by design): "שמור חישוב" finalizes every product at its
 * chosen margin; "שלח ב-WhatsApp" opens the combined-PDF link and is only
 * enabled once everything is saved — it never auto-sends and never finalizes.
 */

import { useEffect, useMemo, useState } from "react";
import { Loader2, X, Sparkles, ChevronDown, MessageCircle } from "lucide-react";
import type { FactoryQuoteRow } from "./types";
import type {
  FactoryPricingConfig,
  FactoryPricingResult,
  ShippingOption,
} from "@/lib/factory/types";
import { priceFactoryQuote } from "@/lib/factory/pricing";
import {
  computeCombined,
  defaultMarginFor,
  type CombinedPricingResult,
} from "@/lib/factory/combined";
import { DetailedBreakdown } from "@/components/calculator/DetailedBreakdown";
import { widgetUrl } from "./widget-url";
import { buildCombineWaUrl, formatIls, SpecField, PriceRow } from "./calc-shared";

const MARGIN_MIN = 0;
const MARGIN_MAX = 99;

interface SectionState {
  margin: number;
  moldsCny: string;
  productName: string;
  picUrl: string;
  material: string;
  widthCm: string;
  heightCm: string;
  depthCm: string;
  qtyStr: string;
  printing: string;
  finishing: string;
  customerNotes: string;
  finalizedThisSession: boolean;
  touched: boolean; // edited since last save/open → on-disk PDF would be stale
}

function initSection(row: FactoryQuoteRow): SectionState {
  const s = row.productSpec;
  return {
    margin: row.finalPricing?.profitMarginPct ?? 40,
    moldsCny:
      row.finalPricing?.moldsTotalCny && row.finalPricing.moldsTotalCny > 0
        ? String(row.finalPricing.moldsTotalCny)
        : "",
    productName: s.productName ?? "",
    picUrl: s.picUrl ?? "",
    material: s.material ?? "",
    widthCm: s.widthCm ? String(s.widthCm) : "",
    heightCm: s.heightCm ? String(s.heightCm) : "",
    depthCm: s.depthCm ? String(s.depthCm) : "",
    // Open at the SAVED quantity (what the PDF uses) when finalized, so the
    // calc reproduces the PDF — not the productSpec qty, which can differ.
    qtyStr: row.finalPricing?.quantity
      ? String(row.finalPricing.quantity)
      : s.quantity
        ? String(s.quantity)
        : "",
    printing: s.printing ?? "",
    finishing: s.finishing ?? "",
    customerNotes: s.customerNotes ?? "",
    finalizedThisSession: false,
    touched: false,
  };
}

export function CombinedCalcModalWidget({
  apiToken,
  rows,
  customerName,
  customerPhone,
  onClose,
  onChanged,
}: {
  apiToken: string;
  rows: FactoryQuoteRow[];
  customerName: string | null;
  customerPhone: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [config, setConfig] = useState<FactoryPricingConfig | null>(null);
  const [shippingOptionId, setShippingOptionId] = useState<string>("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sectionState, setSectionState] = useState<Record<string, SectionState>>(() => {
    const init: Record<string, SectionState> = {};
    for (const row of rows) init[row.id] = initSection(row);
    return init;
  });
  const [savingAll, setSavingAll] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [sendHint, setSendHint] = useState<string | null>(null);
  // Which products are part of THIS offer (default: all). Lets the user build a
  // combined offer from a subset right inside the card.
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(rows.filter((r) => r.factoryResponse).map((r) => r.id))
  );

  // Only quotes with a factory response can be priced + included in the PDF.
  const priceableRows = useMemo(() => rows.filter((r) => r.factoryResponse), [rows]);
  const pendingCount = rows.length - priceableRows.length;
  const selectedRows = useMemo(
    () => priceableRows.filter((r) => selected.has(r.id)),
    [priceableRows, selected]
  );

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
    setSendHint(null);
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  function patchSection(id: string, patch: Partial<SectionState>) {
    setSectionState((prev) => ({
      ...prev,
      [id]: { ...prev[id], ...patch, touched: true },
    }));
    setSendHint(null);
  }

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  // Load pricing config; set the shared shipping default + snap default margins
  // for not-yet-finalized rows (re-finalized rows keep their saved margin).
  useEffect(() => {
    fetch(widgetUrl("/api/widget/factory/config", apiToken))
      .then((r) => r.json())
      .then((data) => {
        if (!data?.ok || !data?.config) return;
        const cfg = data.config as FactoryPricingConfig;
        setConfig(cfg);
        setShippingOptionId((prev) => {
          if (prev) return prev;
          const fromRow =
            rows[0]?.finalPricing?.shippingOptionId ??
            rows[0]?.productSpec.shippingOptionId ??
            "";
          if (fromRow) return fromRow;
          const first = (cfg.shippingOptions as ShippingOption[]).find((s) => s.enabled);
          return first ? first.id : "";
        });
        setSectionState((prev) => {
          const next = { ...prev };
          for (const row of rows) {
            if (!row.finalPricing) {
              next[row.id] = { ...next[row.id], margin: defaultMarginFor(row, cfg) };
            }
          }
          return next;
        });
      })
      .catch((err) => setSaveError(String(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live pricing per product (keyed by row id), recomputed on any edit.
  const livePricings = useMemo(() => {
    const out: Record<string, FactoryPricingResult | null> = {};
    for (const row of rows) {
      const st = sectionState[row.id];
      const resp = row.factoryResponse;
      if (!config || !st || !resp) {
        out[row.id] = null;
        continue;
      }
      const qtyNum = Math.max(1, Math.floor(Number(st.qtyStr) || row.productSpec.quantity || 1));
      const molds = st.moldsCny !== "" ? parseFloat(st.moldsCny) : NaN;
      const moldsValid = Number.isFinite(molds) && molds > 0;
      out[row.id] = priceFactoryQuote(
        {
          factoryUnitCostCny: resp.unitCostCny,
          quantity: qtyNum,
          shippingOptionId: shippingOptionId || null,
          cartonSpec: {
            qty: resp.cartonQty,
            weightKg: resp.weightKg,
            cbm: resp.cartonCbm,
            lengthCm: resp.cartonLengthCm,
            widthCm: resp.cartonWidthCm,
            heightCm: resp.cartonHeightCm,
          },
          profitMarginOverride: st.margin,
          moldsCostCny: moldsValid ? molds : 0,
        },
        config
      );
    }
    return out;
  }, [config, rows, sectionState, shippingOptionId]);

  const combinedResult = useMemo(() => {
    if (!config) return null;
    // Only the SELECTED products form the offer.
    const priced = selectedRows
      .map((r) => livePricings[r.id])
      .filter((p): p is FactoryPricingResult => !!p);
    if (priced.length === 0) return null;
    const opt = config.shippingOptions.find((s) => s.id === shippingOptionId) ?? null;
    return computeCombined(priced, opt, config.usdToIls);
  }, [livePricings, config, shippingOptionId, selectedRows]);

  // Each priceable product paired with its live pricing, for the combined
  // breakdown (the "4 products that make up the one order" view).
  const breakdownItems = useMemo(
    () =>
      priceableRows
        .map((r) => ({ row: r, pricing: livePricings[r.id] }))
        .filter(
          (x): x is { row: FactoryQuoteRow; pricing: FactoryPricingResult } => !!x.pricing
        ),
    [priceableRows, livePricings]
  );

  // Each product's price AFTER the combined (cheaper) shipping is split by CBM
  // share — exactly what the combined PDF prints. Same formula as the PDF route
  // so the calc shows the same per-product number the customer gets.
  const allocatedByRow = useMemo(() => {
    const out: Record<string, { total: number; unit: number } | null> = {};
    const round = (n: number) => Math.round(n * 100) / 100;
    for (const row of rows) {
      const p = livePricings[row.id];
      // Only selected rows get the combined (allocated) price — unselected ones
      // aren't part of the merged shipment, so they show their standalone price.
      if (!p || !selected.has(row.id) || !combinedResult || combinedResult.combinedCbm <= 0) {
        out[row.id] = null;
        continue;
      }
      const share = p.totalCbm / combinedResult.combinedCbm;
      const alloc = combinedResult.combinedShipping * share;
      const total = round(p.totalSellingPrice - p.totalShipping + alloc);
      const unit = p.quantity > 0 ? round(total / p.quantity) : total;
      out[row.id] = { total, unit };
    }
    return out;
  }, [rows, livePricings, combinedResult, selected]);

  function setAllMargins(v: number) {
    setSectionState((prev) => {
      const next = { ...prev };
      for (const row of selectedRows) next[row.id] = { ...next[row.id], margin: v, touched: true };
      return next;
    });
    setSendHint(null);
  }

  const avgMargin = selectedRows.length
    ? Math.round(
        selectedRows.reduce((s, r) => s + (sectionState[r.id]?.margin ?? 0), 0) /
          selectedRows.length
      )
    : 0;

  const allExpanded =
    priceableRows.length > 0 && priceableRows.every((r) => expanded.has(r.id));
  function toggleAll() {
    setExpanded(allExpanded ? new Set() : new Set(priceableRows.map((r) => r.id)));
  }

  // A product is "send-ready" if it's freshly saved this session, or it was
  // already finalized and hasn't been edited. All priceable products must be
  // send-ready before the combined PDF can be opened (the PDF route 409s on any
  // non-finalized id).
  const sendReady =
    selectedRows.length >= 1 &&
    selectedRows.every((r) => {
      const st = sectionState[r.id];
      return st && !st.touched && (st.finalizedThisSession || !!r.finalPricing);
    });
  const phoneDigits = (customerPhone ?? "").replace(/[^\d]/g, "");
  const combineIds = selectedRows.map((r) => r.id);
  const waUrl =
    sendReady && phoneDigits
      ? buildCombineWaUrl(combineIds, customerName, customerPhone, origin)
      : null;
  const combinePdfHref = `${origin}/api/factory/combine/pdf?ids=${combineIds.join(",")}`;

  async function handleSaveAll() {
    if (!config) return;
    setSavingAll(true);
    setSaveError(null);
    setSendHint(null);
    try {
      for (const row of selectedRows) {
        const st = sectionState[row.id];
        const live = livePricings[row.id];
        if (!st || !live) continue;
        const qtyNum = Math.max(
          1,
          Math.floor(Number(st.qtyStr) || row.productSpec.quantity || 1)
        );
        const molds = st.moldsCny !== "" ? parseFloat(st.moldsCny) : NaN;
        const moldsValid = Number.isFinite(molds) && molds > 0;
        const res = await fetch(
          widgetUrl(`/api/widget/factory/${row.id}/finalize`, apiToken),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              profitMarginOverride: st.margin,
              shippingOptionId: shippingOptionId || undefined,
              moldsCostCny: moldsValid ? molds : undefined,
              specOverride: {
                productName: st.productName.trim() || undefined,
                picUrl: st.picUrl.trim() || undefined,
                material: st.material.trim() || undefined,
                widthCm: st.widthCm !== "" ? Number(st.widthCm) : undefined,
                heightCm: st.heightCm !== "" ? Number(st.heightCm) : undefined,
                depthCm: st.depthCm !== "" ? Number(st.depthCm) : undefined,
                quantity: qtyNum,
                printing: st.printing.trim() || undefined,
                finishing: st.finishing.trim() || undefined,
                customerNotes: st.customerNotes.trim() || undefined,
              },
            }),
          }
        );
        const data = await res.json().catch(() => ({}));
        if (!data?.ok) {
          throw new Error(
            `כשל בהצעה ${row.quotationNo ?? row.id.slice(-6)}: ${
              data?.error ?? data?.detail ?? res.status
            }`
          );
        }
        setSectionState((prev) => ({
          ...prev,
          [row.id]: { ...prev[row.id], finalizedThisSession: true, touched: false },
        }));
      }
      onChanged();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingAll(false);
    }
  }

  function handleSendClick(e: React.MouseEvent) {
    if (!sendReady) {
      e.preventDefault();
      setSendHint('צריך קודם ללחוץ "שמור חישוב" — לא ניתן לשלוח הצעות שעדיין לא חושבו.');
    } else if (!phoneDigits) {
      e.preventDefault();
      setSendHint("אין מספר טלפון ללקוח — אי אפשר לשלוח ב-WhatsApp.");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[90vh] overflow-auto rounded-2xl border border-border bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background px-5 py-3">
          <div className="flex items-baseline gap-2 min-w-0">
            <h2 className="text-lg font-semibold shrink-0">חישוב משולב</h2>
            <span className="text-xs text-muted-foreground truncate">
              {customerName ?? "לקוח"} · {priceableRows.length} מוצרים
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="size-7 rounded-md grid place-items-center text-muted-foreground hover:text-foreground hover:bg-secondary"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          {!config ? (
            <div className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="size-3.5 animate-spin" /> טוען הגדרות…
            </div>
          ) : priceableRows.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              אין הצעות עם תשובת מפעל ללקוח הזה — אין מה לחשב עדיין.
            </div>
          ) : (
            <>
              {/* Shared shipping option (one shipment) */}
              <div>
                <label className="block text-sm font-medium mb-1">
                  שיטת שילוח (משותפת לכל ההזמנה)
                </label>
                <select
                  value={shippingOptionId}
                  onChange={(e) => {
                    setShippingOptionId(e.target.value);
                    setSendHint(null);
                  }}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                >
                  <option value="">— ללא שילוח —</option>
                  {config.shippingOptions
                    .filter((s) => s.enabled)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.type === "sea" ? "ים" : "אוויר"})
                      </option>
                    ))}
                </select>
              </div>

              {/* Set-all-margins */}
              {priceableRows.length > 1 && (
                <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] text-muted-foreground">
                      קבע אחוז רווח לכל המוצרים יחד
                    </span>
                    <span className="text-xs font-semibold text-primary tabular-nums">
                      ~{avgMargin}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={MARGIN_MIN}
                    max={MARGIN_MAX}
                    step={1}
                    value={avgMargin}
                    onChange={(e) => setAllMargins(parseInt(e.target.value, 10))}
                    className="w-full accent-[var(--color-primary,#4A7C59)]"
                  />
                </div>
              )}

              {/* Products header + expand/collapse all */}
              <div className="flex items-center justify-between pt-1">
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                  מוצרים — {selectedRows.length} נבחרו מתוך {priceableRows.length}
                </span>
                <button
                  type="button"
                  onClick={toggleAll}
                  className="text-[11px] font-medium text-primary hover:underline"
                >
                  {allExpanded ? "כווץ הכל" : "הרחב הכל"}
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground -mt-1.5">
                סמן ✓ אילו מוצרים ייכנסו להצעה המשולבת (PDF / WhatsApp).
              </p>

              {/* One accordion section per product */}
              {priceableRows.map((row, idx) => (
                <ProductCalcSection
                  key={row.id}
                  index={idx}
                  apiToken={apiToken}
                  row={row}
                  state={sectionState[row.id]}
                  pricing={livePricings[row.id]}
                  allocated={allocatedByRow[row.id]}
                  config={config}
                  checked={selected.has(row.id)}
                  onCheck={() => toggleSelected(row.id)}
                  expanded={expanded.has(row.id)}
                  onToggle={() => toggleExpanded(row.id)}
                  onPatch={(patch) => patchSection(row.id, patch)}
                />
              ))}

              {pendingCount > 0 && (
                <div className="text-[11px] text-muted-foreground">
                  {pendingCount} הצעות ממתינות לתשובת מפעל — לא נכללות בחישוב המשולב.
                </div>
              )}

              {selectedRows.length === 0 && (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-400">
                  לא נבחר אף מוצר — סמן לפחות מוצר אחד כדי ליצור הצעה.
                </div>
              )}

              {/* Combined summary */}
              {combinedResult && (
                <div className="rounded-lg border border-success/30 bg-success/5 p-3 space-y-1.5 mt-1">
                  <div className="text-[10px] uppercase tracking-wider text-success/80">
                    תוצאה משולבת ({combinedResult.count} מוצרים)
                  </div>
                  <PriceRow
                    label="סה״כ נפח / משקל"
                    value={`${combinedResult.combinedCbm} m³ · ${combinedResult.combinedWeightKg}kg`}
                  />
                  <PriceRow
                    label="שילוח מאוחד"
                    value={`${formatIls(combinedResult.combinedShipping)} (בנפרד: ${formatIls(
                      combinedResult.separateShipping
                    )})`}
                  />
                  <PriceRow
                    label="חיסכון בשילוח ללקוח"
                    value={formatIls(combinedResult.shippingSaving)}
                    highlight
                  />
                  <div className="border-t border-success/20 my-1" />
                  <PriceRow
                    label="סה״כ ללקוח (משולב)"
                    value={`${formatIls(combinedResult.grandTotal)} (בנפרד: ${formatIls(
                      combinedResult.separateGrandTotal
                    )})`}
                    bold
                  />
                  <PriceRow
                    label="סה״כ רווח"
                    value={formatIls(combinedResult.totalProfit)}
                    highlight
                  />
                  <PriceRow label="מרווח כולל" value={`${combinedResult.overallMarginPct}%`} />
                  <CombinedBreakdown
                    result={combinedResult}
                    items={breakdownItems}
                    config={config}
                    shippingOptionId={shippingOptionId}
                  />
                </div>
              )}

              {saveError && <p className="text-xs text-destructive">{saveError}</p>}
              {sendHint && <p className="text-xs text-amber-400">{sendHint}</p>}
            </>
          )}
        </div>

        {/* Footer — calc and send are SEPARATE buttons */}
        {config && priceableRows.length > 0 && (
          <div className="sticky bottom-0 z-10 flex items-center justify-between gap-2 border-t border-border bg-background px-5 py-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border bg-background/40 px-3 py-1.5 text-sm hover:bg-secondary"
            >
              ביטול
            </button>
            <div className="flex items-center gap-2">
              {sendReady && (
                <a
                  href={combinePdfHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-md border border-border bg-background/40 px-3 py-1.5 text-sm hover:bg-secondary"
                >
                  פתח PDF
                </a>
              )}
              <a
                href={waUrl ?? "#"}
                target="_blank"
                rel="noopener noreferrer"
                onClick={handleSendClick}
                aria-disabled={!waUrl}
                title={
                  !sendReady
                    ? 'שמור חישוב קודם'
                    : !phoneDigits
                      ? 'אין טלפון ללקוח'
                      : 'שלח הצעה משולבת ב-WhatsApp'
                }
                className={[
                  "inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-sm font-medium text-emerald-400 hover:bg-emerald-500/20",
                  waUrl ? "" : "opacity-50 cursor-not-allowed",
                ].join(" ")}
              >
                <MessageCircle className="size-3.5" />
                שלח ב-WhatsApp
              </a>
              <button
                type="button"
                onClick={handleSaveAll}
                disabled={savingAll || !combinedResult}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
              >
                {savingAll ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Sparkles className="size-3.5" />
                )}
                שמור חישוב
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ProductCalcSection({
  index,
  apiToken,
  row,
  state,
  pricing,
  allocated,
  config,
  checked,
  onCheck,
  expanded,
  onToggle,
  onPatch,
}: {
  index: number;
  apiToken: string;
  row: FactoryQuoteRow;
  state: SectionState;
  pricing: FactoryPricingResult | null;
  allocated: { total: number; unit: number } | null;
  config: FactoryPricingConfig;
  checked: boolean;
  onCheck: () => void;
  expanded: boolean;
  onToggle: () => void;
  onPatch: (patch: Partial<SectionState>) => void;
}) {
  const [uploadingImg, setUploadingImg] = useState(false);
  const [pullingImg, setPullingImg] = useState(false);
  const [imgError, setImgError] = useState<string | null>(null);

  const finalized = state.finalizedThisSession || !!row.finalPricing;
  const stale = finalized && state.touched;

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadingImg(true);
    setImgError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(widgetUrl("/api/factory/upload-image", apiToken), {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (data?.ok && data.url) onPatch({ picUrl: data.url });
      else setImgError(data?.message ?? data?.error ?? "העלאת התמונה נכשלה");
    } catch (err) {
      setImgError(err instanceof Error ? err.message : "העלאת התמונה נכשלה");
    } finally {
      setUploadingImg(false);
    }
  }

  async function handlePullImage() {
    setPullingImg(true);
    setImgError(null);
    try {
      const res = await fetch(widgetUrl(`/api/factory/${row.id}/pull-image`, apiToken), {
        method: "POST",
      });
      const data = await res.json();
      if (data?.ok && data.url) onPatch({ picUrl: data.url });
      else
        setImgError(
          data?.error === "no_image_in_sheet"
            ? "אין תמונה בשורה ב-Feishu"
            : data?.error ?? "משיכת התמונה נכשלה"
        );
    } catch (err) {
      setImgError(err instanceof Error ? err.message : "משיכת התמונה נכשלה");
    } finally {
      setPullingImg(false);
    }
  }

  return (
    <div
      className={`rounded-lg border overflow-hidden transition-colors ${
        expanded ? "border-primary/40 bg-card/60" : "border-border bg-card/30"
      } ${checked ? "" : "opacity-55"}`}
    >
      {/* Header: include-checkbox + expand toggle */}
      <div className={`flex items-stretch ${expanded ? "bg-primary/10" : ""}`}>
        <label
          className="flex items-center pr-3 pl-1.5 cursor-pointer shrink-0"
          title="כלול בהצעה המשולבת"
        >
          <input
            type="checkbox"
            checked={checked}
            onChange={onCheck}
            className="size-4 accent-[var(--color-primary,#4A7C59)]"
          />
        </label>
        <button
          type="button"
          onClick={onToggle}
          className={`flex flex-1 min-w-0 items-center gap-2 py-2.5 pl-3 text-right transition-colors ${
            expanded ? "" : "hover:bg-secondary/40"
          }`}
        >
        <span className="size-5 shrink-0 grid place-items-center rounded-full bg-primary/15 text-primary text-[11px] font-bold tabular-nums">
          {index + 1}
        </span>
        <ChevronDown
          className={`size-4 shrink-0 text-muted-foreground transition-transform ${
            expanded ? "" : "-rotate-90"
          }`}
        />
        <span className="truncate flex-1 text-sm font-semibold">
          {state.productName || row.productSpec.description || "מוצר"}
        </span>
        <span className="font-mono text-[10px] text-muted-foreground shrink-0 hidden sm:inline">
          {row.quotationNo ?? row.id.slice(-6)}
        </span>
        <span
          className={`text-[10px] rounded-full border px-1.5 py-0.5 shrink-0 ${
            stale
              ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
              : finalized
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                : "border-blue-500/30 bg-blue-500/10 text-blue-400"
          }`}
        >
          {stale ? "שונה" : finalized ? "סופי" : "חדש"}
        </span>
        <span className="text-sm font-bold tabular-nums shrink-0 text-primary">
          {allocated
            ? formatIls(allocated.total)
            : pricing
              ? formatIls(pricing.totalSellingPrice)
              : "—"}
        </span>
        </button>
      </div>

      {expanded && (
        <div className="border-t border-primary/20 px-3 py-3 space-y-3">
          <SectionLabel>פרטי מוצר ל‑PDF</SectionLabel>
          {/* Image */}
          <div>
            <label className="block text-[11px] text-muted-foreground mb-0.5">
              תמונת מוצר (נכנסת ל‑PDF)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={state.picUrl}
                onChange={(e) => onPatch({ picUrl: e.target.value })}
                placeholder="הדבק קישור או העלה תמונה"
                className="flex-1 min-w-0 rounded-md border border-border bg-background/40 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
              />
              <label className="shrink-0 cursor-pointer rounded-md border border-border bg-secondary px-2.5 py-1.5 text-xs hover:bg-secondary/70">
                {uploadingImg ? "מעלה…" : "העלה"}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleImageUpload}
                  disabled={uploadingImg}
                />
              </label>
              <button
                type="button"
                onClick={handlePullImage}
                disabled={pullingImg}
                title="משוך את התמונה מהשורה ב-Feishu"
                className="shrink-0 rounded-md border border-border bg-secondary px-2.5 py-1.5 text-xs hover:bg-secondary/70 disabled:opacity-60"
              >
                {pullingImg ? "מושך…" : "Feishu"}
              </button>
              {state.picUrl.trim() ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={state.picUrl}
                  alt="תמונת מוצר"
                  className="size-12 shrink-0 rounded-md border border-border object-contain bg-background"
                />
              ) : (
                <div className="size-12 shrink-0 rounded-md border border-dashed border-border grid place-items-center text-[9px] text-muted-foreground">
                  אין
                </div>
              )}
            </div>
            {imgError && <p className="text-[10px] text-destructive mt-0.5">{imgError}</p>}
          </div>

          <SpecField
            label="שם המוצר (כותרת)"
            value={state.productName}
            onChange={(v) => onPatch({ productName: v })}
            placeholder="שקית אלבדי"
          />
          <div className="grid grid-cols-3 gap-2">
            <SpecField label="רוחב (ס״מ)" value={state.widthCm} onChange={(v) => onPatch({ widthCm: v })} type="number" />
            <SpecField label="גובה (ס״מ)" value={state.heightCm} onChange={(v) => onPatch({ heightCm: v })} type="number" />
            <SpecField label="עומק (ס״מ)" value={state.depthCm} onChange={(v) => onPatch({ depthCm: v })} type="number" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <SpecField label="כמות" value={state.qtyStr} onChange={(v) => onPatch({ qtyStr: v })} type="number" />
            <SpecField label="חומר" value={state.material} onChange={(v) => onPatch({ material: v })} placeholder="80g non-woven" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <SpecField label="הדפסה" value={state.printing} onChange={(v) => onPatch({ printing: v })} />
            <SpecField label="גימור" value={state.finishing} onChange={(v) => onPatch({ finishing: v })} />
          </div>
          <div>
            <label className="block text-[11px] text-muted-foreground mb-0.5">הערות ללקוח (ב‑PDF)</label>
            <textarea
              value={state.customerNotes}
              onChange={(e) => onPatch({ customerNotes: e.target.value })}
              rows={2}
              placeholder="טקסט חופשי שיופיע בתחתית ההצעה"
              className="w-full rounded-md border border-border bg-background/40 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
            />
          </div>

          <div className="border-t border-border/50 pt-2.5">
            <SectionLabel>תמחור ורווח</SectionLabel>
          </div>

          {/* Molds */}
          <div>
            <label className="block text-[11px] text-muted-foreground mb-0.5">
              מולדים / תבניות (¥ CNY) — חד פעמי
            </label>
            <input
              type="number"
              min={0}
              step={50}
              placeholder="למשל 2000"
              value={state.moldsCny}
              onChange={(e) => onPatch({ moldsCny: e.target.value })}
              className="w-full rounded-md border border-border bg-background/40 px-2.5 py-1.5 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring/30"
            />
          </div>

          {/* Margin slider */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] text-muted-foreground">אחוז רווח</label>
              <span className="text-sm font-semibold text-primary tabular-nums">{state.margin}%</span>
            </div>
            <input
              type="range"
              min={MARGIN_MIN}
              max={MARGIN_MAX}
              step={1}
              value={state.margin}
              onChange={(e) => onPatch({ margin: parseInt(e.target.value, 10) })}
              className="w-full accent-[var(--color-primary,#4A7C59)]"
            />
          </div>

          {/* Live pricing summary */}
          {pricing && (
            <div className="rounded-lg border border-success/30 bg-success/5 p-3 space-y-1.5 text-sm">
              {allocated ? (
                <>
                  <PriceRow
                    label="מחיר ללקוח / יחידה (משולב — ב‑PDF)"
                    value={formatIls(allocated.unit)}
                    bold
                  />
                  <PriceRow label="סה״כ מוצר (משולב — ב‑PDF)" value={formatIls(allocated.total)} bold />
                  <PriceRow
                    label="מחיר בודד (ללא שילוח מאוחד)"
                    value={formatIls(pricing.totalSellingPrice)}
                  />
                </>
              ) : (
                <>
                  <PriceRow label="מחיר ללקוח / יחידה" value={formatIls(pricing.unitSellingPrice)} bold />
                  <PriceRow label="סה״כ הזמנה" value={formatIls(pricing.totalSellingPrice)} bold />
                </>
              )}
              <div className="border-t border-success/20 my-1" />
              <PriceRow label="עלות יחידה (CNY→₪)" value={formatIls(pricing.unitCost)} />
              <PriceRow label="שילוח / יחידה (בודד)" value={formatIls(pricing.unitShipping)} />
              <PriceRow label="רווח / יחידה" value={formatIls(pricing.unitProfit)} highlight />
              <PriceRow label="סה״כ רווח" value={formatIls(pricing.totalProfit)} highlight />
            </div>
          )}

          {/* Boss breakdown */}
          {pricing && row.factoryResponse && (
            <div className="border-t border-border/50 pt-2.5 space-y-2">
              <SectionLabel>פירוט מלא לבוס</SectionLabel>
              <DetailedBreakdown
              unitCost={pricing.unitCost}
              unitShipping={pricing.unitShipping}
              unitProfit={pricing.unitProfit}
              unitSellingPrice={pricing.unitSellingPrice}
              totalCost={pricing.totalCost}
              totalShipping={pricing.totalShipping}
              totalProfit={pricing.totalProfit}
              totalSellingPrice={pricing.totalSellingPrice}
              quantity={pricing.quantity}
              profitMarginPct={pricing.profitMarginPct}
              totalCartons={pricing.totalCartons}
              totalWeightKg={pricing.totalWeightKg}
              totalCbm={pricing.totalCbm}
              shippingType={
                config.shippingOptions.find((s) => s.id === pricing.shippingOptionId)?.type ?? null
              }
              factoryUnitCostCny={row.factoryResponse.unitCostCny}
              usdToIls={config.usdToIls}
              usdToCny={config.usdToCny}
              seaRate={
                config.shippingOptions.find(
                  (s) => s.id === pricing.shippingOptionId && s.type === "sea"
                )?.seaRate
              }
              rawCbm={pricing.totalCbm}
              seaMinCbm={1}
            />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The combined order treated as ONE product: a full breakdown across all
 * products — composition, total factory cost, the single merged shipment (and
 * the volume it takes), total profit, the price summary, and logistics.
 */
function CombinedBreakdown({
  result,
  items,
  config,
  shippingOptionId,
}: {
  result: CombinedPricingResult;
  items: { row: FactoryQuoteRow; pricing: FactoryPricingResult }[];
  config: FactoryPricingConfig;
  shippingOptionId: string;
}) {
  const [open, setOpen] = useState(false);
  const opt = config.shippingOptions.find((s) => s.id === shippingOptionId) ?? null;
  const cartons = items.reduce((s, it) => s + (it.pricing.totalCartons || 0), 0);
  const effectiveCbm = Math.max(result.combinedCbm, 1);
  const floorApplied = opt?.type === "sea" && result.combinedCbm < 1;

  function nameOf(row: FactoryQuoteRow): string {
    return (
      row.productSpec.productName ||
      row.productSpec.description ||
      row.quotationNo ||
      "מוצר"
    );
  }

  return (
    <div className="rounded-md border border-border/60 bg-background/40 overflow-hidden mt-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 px-2.5 py-2 text-xs font-medium hover:bg-muted/20"
        aria-expanded={open}
      >
        <span className="flex items-center gap-1.5">
          <ChevronDown className={`size-3.5 transition-transform ${open ? "" : "-rotate-90"}`} />
          פירוט מלא — ההזמנה כמוצר אחד
        </span>
        {!open && (
          <span className="text-[10px] text-muted-foreground">{result.overallMarginPct}% רווח</span>
        )}
      </button>

      {open && (
        <div className="border-t border-border/60 px-2.5 py-2.5 space-y-2.5 text-xs tabular-nums">
          {/* Composition — the products that make up the one order */}
          <BSection title={`הרכב ההזמנה (${items.length} מוצרים)`}>
            <div className="space-y-1">
              {items.map(({ row, pricing }) => (
                <div key={row.id} className="flex items-center gap-2">
                  <span className="font-mono text-[10px] text-muted-foreground shrink-0">
                    {row.quotationNo ?? row.id.slice(-6)}
                  </span>
                  <span className="truncate flex-1 text-muted-foreground">
                    {nameOf(row)} · {pricing.quantity.toLocaleString("he-IL")} יח׳
                  </span>
                  <span className="shrink-0">{pricing.totalCbm} m³</span>
                </div>
              ))}
            </div>
          </BSection>

          {/* Total factory cost */}
          <BSection title="עלות מפעל כוללת (production — חל עליה רווח)">
            {items.map(({ row, pricing }) => (
              <BRow key={row.id} label={nameOf(row)} value={formatIls(pricing.totalCost)} muted />
            ))}
            <BRow label="סה״כ עלות מפעל" value={formatIls(result.totalProduction)} strong />
          </BSection>

          {/* One merged shipment */}
          <BSection
            title={
              opt?.type === "air"
                ? "שילוח אווירי מאוחד (pass-through — ללא רווח)"
                : "שילוח ים מאוחד (pass-through — ללא רווח)"
            }
          >
            <BRow label="נפח כולל (כמה מקום תופס)" value={`${result.combinedCbm} m³`} />
            {opt?.type === "sea" && opt.seaRate ? (
              <>
                <BRow
                  label="CBM בחיוב"
                  value={
                    <>
                      {effectiveCbm.toFixed(3)}
                      {floorApplied && <span className="text-amber-400"> · ⚠️ רצפת 1 CBM</span>}
                    </>
                  }
                />
                <BRow label="תעריף" value={`$${opt.seaRate} / CBM`} />
              </>
            ) : (
              <BRow label="משקל כולל" value={`${result.combinedWeightKg} ק״ג`} />
            )}
            <BRow label="שילוח מאוחד" value={formatIls(result.combinedShipping)} strong />
            <BRow label="לעומת שילוח בנפרד" value={formatIls(result.separateShipping)} muted />
            <BRow label="חיסכון ללקוח" value={formatIls(result.shippingSaving)} success />
          </BSection>

          {/* Profit */}
          <BSection title="רווח (חל רק על production, לא על שילוח)">
            <BRow label="סה״כ רווח" value={formatIls(result.totalProfit)} success strong />
            <BRow label="מרווח כולל" value={`${result.overallMarginPct}%`} />
          </BSection>

          {/* Price summary */}
          <BSection title="סיכום מחיר ללקוח">
            <BRow label="מחיר מוצרים (עלות + רווח)" value={formatIls(result.productPriceTotal)} />
            <BRow label="+ שילוח מאוחד" value={formatIls(result.combinedShipping)} />
            <BRow label="סה״כ ללקוח" value={formatIls(result.grandTotal)} strong />
            <BRow label="לעומת בנפרד" value={formatIls(result.separateGrandTotal)} muted />
          </BSection>

          {/* Logistics */}
          <BSection title="לוגיסטיקה">
            <BRow
              label="פירוט"
              value={`${cartons} קרטונים · ${result.combinedWeightKg} ק״ג · ${result.combinedCbm} CBM`}
            />
          </BSection>
        </div>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-primary/80 font-semibold">
      <span className="size-1.5 rounded-full bg-primary/60" />
      {children}
    </div>
  );
}

function BSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border/50 bg-card/30 p-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{title}</div>
      {children}
    </div>
  );
}

function BRow({
  label,
  value,
  strong,
  muted,
  success,
}: {
  label: string;
  value: React.ReactNode;
  strong?: boolean;
  muted?: boolean;
  success?: boolean;
}) {
  return (
    <div className="flex justify-between gap-2 items-baseline">
      <span className={muted ? "text-muted-foreground/70" : "text-muted-foreground"}>{label}</span>
      <span
        className={[
          "text-right tabular-nums",
          strong ? "font-semibold" : "",
          success ? "text-success" : "",
        ].join(" ")}
      >
        {value}
      </span>
    </div>
  );
}
