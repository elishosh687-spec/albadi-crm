"use client";

/**
 * Widget variant of the dashboard SendToFactoryForm.
 *
 * Differences vs the dashboard original:
 *   - Accepts an `apiToken` prop (the widget_token) and uses it for every fetch.
 *   - Targets `/api/widget/...` endpoints instead of `/api/...`.
 *   - No `useRouter().refresh()` — refresh is the caller's job via callbacks.
 *
 * Otherwise behavior is identical to the v3 form.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Send, ClipboardCheck } from "lucide-react";
import { PRODUCT_LABEL, PRODUCT_DIMS, QUANTITY_VALUE } from "@/lib/factory/qstate-decode";
import { widgetUrl } from "./widget-url";

function regenDescription(
  w: number,
  h: number,
  d: number,
  productCode: string
): string {
  if (productCode && productCode !== "custom" && PRODUCT_DIMS[productCode]) {
    const cat = PRODUCT_DIMS[productCode];
    const matches =
      Math.abs(cat.widthCm - w) < 0.5 &&
      Math.abs(cat.heightCm - h) < 0.5 &&
      Math.abs(cat.depthCm - d) < 0.5;
    if (matches && PRODUCT_LABEL[productCode]) return PRODUCT_LABEL[productCode];
  }
  const dimStr = [w, h, d].filter((n) => n > 0).join("×");
  if (!dimStr) return "מוצר מותאם";
  return `${dimStr} ס״מ — מוצר מותאם`;
}

interface ParsedDims {
  widthCm: number;
  heightCm: number;
  depthCm: number;
}

function parseDims(raw: unknown): ParsedDims {
  if (!raw) return { widthCm: 0, heightCm: 0, depthCm: 0 };
  const s = String(raw);
  const re = /([WHD]?)\s*([0-9]+(?:\.[0-9]+)?)/gi;
  const tokens: { axis: string; val: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    tokens.push({ axis: m[1].toUpperCase(), val: parseFloat(m[2]) });
  }
  const named: Record<string, number> = {};
  for (const t of tokens) if (t.axis) named[t.axis] = t.val;
  if (named.W || named.H || named.D) {
    return {
      widthCm: named.W ?? 0,
      heightCm: named.H ?? 0,
      depthCm: named.D ?? 0,
    };
  }
  const nums = tokens.map((t) => t.val);
  if (nums.length === 3) return { widthCm: nums[0], heightCm: nums[1], depthCm: nums[2] };
  if (nums.length === 2) return { widthCm: nums[0], heightCm: nums[1], depthCm: 0 };
  return { widthCm: 0, heightCm: 0, depthCm: 0 };
}

function buildSizeString(w: number, h: number, d: number): string {
  const parts: string[] = [];
  if (h) parts.push(`H${h}`);
  if (d) parts.push(`D${d}`);
  if (w) parts.push(`W${w}`);
  return parts.join("*");
}

function qStateGet(qs: Record<string, unknown> | null, key: string): unknown {
  return qs?.[key];
}

function clampColors(v: unknown): number {
  let n: number;
  if (typeof v === "number") n = v;
  else if (typeof v === "string") {
    const m = v.match(/(\d+)/);
    n = m ? parseInt(m[1], 10) : 1;
  } else n = 1;
  if (!Number.isFinite(n) || n < 1) n = 1;
  return Math.min(4, n);
}

export function SendToFactoryFormWidget({
  apiToken,
  leadId,
  leadName,
  qState,
  draft,
  onSent,
  onSavedDraft,
  onCancel,
  saveDraftAs = "lead-draft",
  saveDraftLabel,
}: {
  apiToken: string;
  leadId: string;
  leadName: string | null;
  qState: Record<string, unknown> | null;
  draft?: Record<string, unknown> | null;
  onSent: () => void;
  onSavedDraft?: (saved: Record<string, unknown>) => void;
  onCancel?: () => void;
  saveDraftAs?: "lead-draft" | "new-quote";
  saveDraftLabel?: string;
}) {
  const presets = useMemo(() => {
    if (draft && Object.keys(draft).length > 0) {
      const d = draft as Record<string, unknown>;
      return {
        description: String(d.description ?? ""),
        material: String(d.material ?? "80g non-woven"),
        widthCm: Number(d.widthCm) || 0,
        heightCm: Number(d.heightCm) || 0,
        depthCm: Number(d.depthCm) || 0,
        quantity: Number(d.quantity) || 0,
        logoColors: clampColors(d.printing),
        hasHandles: /with handles/i.test(String(d.finishing ?? "")),
        hasLamination: /laminated/i.test(String(d.finishing ?? "")) && !/not laminated/i.test(String(d.finishing ?? "")),
        notes: String(d.notes ?? ""),
      };
    }
    const productCode = String(qStateGet(qState, "product") ?? "");
    const productCustom = String(qStateGet(qState, "productCustom") ?? "");
    const description =
      productCode === "custom" && productCustom
        ? productCustom
        : PRODUCT_LABEL[productCode] ?? productCode ?? "שקיות מותאמות";
    const dims =
      productCode === "custom"
        ? parseDims(productCustom)
        : PRODUCT_DIMS[productCode] ?? { widthCm: 0, heightCm: 0, depthCm: 0 };
    const qtyRaw = qStateGet(qState, "quantity");
    const qtyCustom = qStateGet(qState, "quantityCustom");
    const qty =
      qtyRaw === "custom" && qtyCustom
        ? Number(qtyCustom) || 0
        : QUANTITY_VALUE[String(qtyRaw ?? "")] ?? Number(qtyRaw) ?? 0;
    const handlesRaw = qStateGet(qState, "handles");
    const handles = handlesRaw === true || handlesRaw === "true";
    const colors = qStateGet(qState, "colors");
    const colorsNum = clampColors(colors);
    return {
      description: description || "שקיות מותאמות",
      material: "80g non-woven",
      ...dims,
      quantity: qty,
      logoColors: colorsNum,
      hasHandles: handles,
      hasLamination: false,
      notes: "",
    };
  }, [qState, draft]);

  const [description, setDescription] = useState(presets.description);
  const [material, setMaterial] = useState(presets.material);
  const [widthCm, setWidthCm] = useState(String(presets.widthCm || ""));
  const [heightCm, setHeightCm] = useState(String(presets.heightCm || ""));
  const [depthCm, setDepthCm] = useState(String(presets.depthCm || ""));
  const [sizeString, setSizeString] = useState("");
  const [quantity, setQuantity] = useState(String(presets.quantity || ""));
  const [logoColors, setLogoColors] = useState<number>(presets.logoColors);
  const [hasHandles, setHasHandles] = useState<boolean>(presets.hasHandles);
  const [hasLamination, setHasLamination] = useState<boolean>(presets.hasLamination);
  const [notes, setNotes] = useState(presets.notes ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const descriptionTouchedRef = useRef(false);
  const productCode = String(qStateGet(qState, "product") ?? "");

  useEffect(() => {
    if (descriptionTouchedRef.current) return;
    const w = parseFloat(widthCm) || 0;
    const h = parseFloat(heightCm) || 0;
    const d = parseFloat(depthCm) || 0;
    if (w === 0 && h === 0 && d === 0) return;
    const next = regenDescription(w, h, d, productCode);
    setDescription((prev) => (prev === next ? prev : next));
  }, [widthCm, heightCm, depthCm, productCode]);

  const sizePreview = useMemo(
    () =>
      buildSizeString(
        parseFloat(widthCm) || 0,
        parseFloat(heightCm) || 0,
        parseFloat(depthCm) || 0
      ),
    [widthCm, heightCm, depthCm]
  );

  useEffect(() => {
    setSizeString(sizePreview);
  }, [sizePreview]);

  const handleSizeStringChange = (val: string) => {
    setSizeString(val);
    const parsed = parseDims(val);
    if (parsed.widthCm || parsed.heightCm || parsed.depthCm) {
      setWidthCm(String(parsed.widthCm || ""));
      setHeightCm(String(parsed.heightCm || ""));
      setDepthCm(String(parsed.depthCm || ""));
    }
  };

  const buildSpec = () => {
    const w = parseFloat(widthCm) || 0;
    const h = parseFloat(heightCm) || 0;
    const d = parseFloat(depthCm) || 0;
    const q = parseInt(quantity, 10) || 0;
    const printingStr = `${logoColors} color${logoColors > 1 ? "s" : ""}`;
    const finishingParts: string[] = [];
    finishingParts.push(hasHandles ? "With handles" : "No handles");
    finishingParts.push(hasLamination ? "Laminated" : "Not laminated");
    return {
      description: description.trim(),
      material: material.trim(),
      widthCm: w,
      heightCm: h,
      depthCm: d,
      quantity: q,
      printing: printingStr,
      finishing: finishingParts.join(" / "),
      notes: notes.trim(),
    };
  };

  const validate = () => {
    if (!description.trim()) return "חובה תיאור";
    if (!material.trim()) return "חובה חומר";
    if (!(parseFloat(widthCm) > 0 && parseFloat(heightCm) > 0))
      return "חובה רוחב וגובה";
    if ((parseInt(quantity, 10) || 0) < 1) return "חובה כמות חיובית";
    return null;
  };

  const handleSaveDraft = async () => {
    setError(null);
    const v = validate();
    if (v) return setError(v);
    setSavingDraft(true);
    try {
      const spec = buildSpec();
      let res: Response;
      if (saveDraftAs === "new-quote") {
        res = await fetch(widgetUrl("/api/widget/factory/quote-draft", apiToken), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            manychatSubId: leadId,
            customerName: leadName ?? undefined,
            productSpec: {
              description: spec.description,
              material: spec.material,
              widthCm: spec.widthCm,
              heightCm: spec.heightCm,
              depthCm: spec.depthCm,
              quantity: spec.quantity,
              printing: spec.printing,
              finishing: spec.finishing,
              notes: spec.notes || undefined,
            },
          }),
        });
      } else {
        res = await fetch(
          widgetUrl(`/api/widget/leads/${encodeURIComponent(leadId)}/factory-draft`, apiToken),
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(spec),
          }
        );
      }
      const data = await res.json();
      if (!data?.ok) {
        setError(data?.error ?? data?.detail ?? "כשל בשמירת draft");
        return;
      }
      onSavedDraft?.((data.draft as Record<string, unknown>) ?? spec);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingDraft(false);
    }
  };

  const handleSubmit = async () => {
    setError(null);
    const v = validate();
    if (v) return setError(v);
    const spec = buildSpec();
    setSubmitting(true);
    try {
      const res = await fetch(widgetUrl("/api/widget/factory/quote-request", apiToken), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          manychatSubId: leadId,
          customerName: leadName ?? undefined,
          productSpec: {
            description: spec.description,
            material: spec.material,
            widthCm: spec.widthCm,
            heightCm: spec.heightCm,
            depthCm: spec.depthCm,
            quantity: spec.quantity,
            printing: spec.printing,
            finishing: spec.finishing,
            notes: spec.notes || undefined,
          },
        }),
      });
      const data = await res.json();
      if (data?.ok) {
        onSent();
      } else {
        setError(data?.error ?? data?.detail ?? "כשל בשליחה");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-3 text-sm">
      <Field
        label="הערות על ההזמנה (Description)"
        value={description}
        onChange={(v) => {
          descriptionTouchedRef.current = true;
          setDescription(v);
        }}
        placeholder="למשל: שקיות מותאמות לאירוע X"
      />
      <Field
        label="חומר (Material)"
        value={material}
        onChange={setMaterial}
        placeholder="80g non-woven"
      />

      <div>
        <span className="block text-[11px] text-muted-foreground mb-1 text-right">
          מידות (cm)
        </span>
        <div className="grid grid-cols-3 gap-2">
          <Field label="W (רוחב)" value={widthCm} onChange={setWidthCm} type="number" compact />
          <Field label="H (גובה)" value={heightCm} onChange={setHeightCm} type="number" compact />
          <Field label="D (עומק)" value={depthCm} onChange={setDepthCm} type="number" compact />
        </div>
        <div className="mt-2 flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground shrink-0">או הדבק:</span>
          <input
            value={sizeString}
            onChange={(e) => handleSizeStringChange(e.target.value)}
            placeholder="H20*D8*W25"
            className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs font-mono text-left"
            dir="ltr"
          />
        </div>
        {sizePreview && (
          <div className="mt-1 text-[10px] text-muted-foreground text-right">
            ייכתב ל-Feishu: <span className="font-mono text-foreground">{sizePreview}</span>
          </div>
        )}
      </div>

      <Field label="כמות" value={quantity} onChange={setQuantity} type="number" />

      <div className="grid grid-cols-3 gap-2">
        <SelectField
          label="צבעי לוגו"
          value={String(logoColors)}
          onChange={(v) => setLogoColors(parseInt(v, 10))}
          options={[
            { value: "1", label: "1 צבע" },
            { value: "2", label: "2 צבעים" },
            { value: "3", label: "3 צבעים" },
            { value: "4", label: "3+ צבעים" },
          ]}
        />
        <SelectField
          label="ידיות"
          value={hasHandles ? "yes" : "no"}
          onChange={(v) => setHasHandles(v === "yes")}
          options={[
            { value: "yes", label: "עם ידיות" },
            { value: "no", label: "ללא ידיות" },
          ]}
        />
        <SelectField
          label="למינציה"
          value={hasLamination ? "yes" : "no"}
          onChange={(v) => setHasLamination(v === "yes")}
          options={[
            { value: "no", label: "ללא" },
            { value: "yes", label: "עם למינציה" },
          ]}
        />
      </div>

      <Field label="הערות למפעל" value={notes} onChange={setNotes} placeholder="(אופציונלי)" />

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-border flex-wrap">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-border bg-background/40 px-3 py-1.5 text-sm hover:bg-secondary"
          >
            ביטול
          </button>
        )}
        {onSavedDraft && (
          <button
            type="button"
            onClick={handleSaveDraft}
            disabled={savingDraft || submitting}
            title="שמור את המפרט כסיכום הזמנה — תוכל לשלוח ל-Feishu מאוחר יותר"
            className="inline-flex items-center gap-1.5 rounded-md border border-primary bg-primary/5 px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/10 disabled:opacity-60"
          >
            {savingDraft ? <Loader2 className="size-3.5 animate-spin" /> : <ClipboardCheck className="size-3.5" />}
            {saveDraftLabel ?? "שלח לסיכום הזמנה"}
          </button>
        )}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting || savingDraft}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          {submitting ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
          שלח ל-Feishu
        </button>
      </div>
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="block">
      <span className="block text-[11px] text-muted-foreground mb-1 text-right">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-right focus:outline-none focus:ring-2 focus:ring-ring/30"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  compact = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  compact?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-[11px] text-muted-foreground mb-1 text-right">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full rounded-md border border-border bg-background px-3 ${compact ? "py-1.5 text-xs" : "py-2 text-sm"} text-right focus:outline-none focus:ring-2 focus:ring-ring/30`}
      />
    </label>
  );
}
