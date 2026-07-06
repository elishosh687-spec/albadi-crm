"use client";

/**
 * Standalone factory-quote request form for the salesperson (Itay). Deliberately
 * decoupled from the main factory-flow tab — it's just a customer picker + spec
 * form, exposed to Itay via its own GHL Custom Menu Link so he never sees the
 * rest of the CRM. Submitting parks a draft factory-quote row (linked to the
 * chosen customer) and DMs Eli; Eli reviews + sends to the factory himself from
 * the "הצעות מהמפעל" tab (draft filter).
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Loader2, Send, CheckCircle2, Search, X, User } from "lucide-react";
import { LuxShell, LuxTitle, LuxAccent, LuxCTA, Section } from "@/components/widget-ui/lux";

function widgetUrl(path: string, token: string, params?: Record<string, string>): string {
  const sp = new URLSearchParams({ widget_token: token, ...(params ?? {}) });
  return `${path}?${sp.toString()}`;
}

function parseDims(raw: string): { widthCm: number; heightCm: number; depthCm: number } {
  const re = /([WHD]?)\s*([0-9]+(?:\.[0-9]+)?)/gi;
  const tokens: { axis: string; val: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    tokens.push({ axis: m[1].toUpperCase(), val: parseFloat(m[2]) });
  }
  const named: Record<string, number> = {};
  for (const t of tokens) if (t.axis) named[t.axis] = t.val;
  if (named.W || named.H || named.D) {
    return { widthCm: named.W ?? 0, heightCm: named.H ?? 0, depthCm: named.D ?? 0 };
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

interface LeadOption {
  sid: string;
  name: string | null;
  phone: string | null;
  stage: string | null;
  updatedAt: string;
}

const EMPTY_SPEC = {
  description: "",
  material: "80g non-woven",
  widthCm: "",
  heightCm: "",
  depthCm: "",
  quantity: "",
  logoColors: 1,
  hasHandles: true,
  hasLamination: false,
  notes: "",
};

export function SalesQuoteRequestForm({ apiToken }: { apiToken: string }) {
  // --- customer picker state ---
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LeadOption[]>([]);
  const [loadingResults, setLoadingResults] = useState(false);
  const [open, setOpen] = useState(false);
  const [customer, setCustomer] = useState<LeadOption | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pickerRef = useRef<HTMLDivElement | null>(null);

  // --- spec form state ---
  const [f, setF] = useState(EMPTY_SPEC);
  const [sizeString, setSizeString] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const set = <K extends keyof typeof EMPTY_SPEC>(key: K, val: (typeof EMPTY_SPEC)[K]) =>
    setF((prev) => ({ ...prev, [key]: val }));

  const runSearch = useCallback(
    async (q: string) => {
      setLoadingResults(true);
      try {
        const res = await fetch(widgetUrl("/api/widget/leads/recent", apiToken, { q }));
        const data = await res.json();
        if (data?.ok) setResults(data.leads || []);
      } catch (err) {
        console.error("[SalesQuoteRequestForm] search failed", err);
      } finally {
        setLoadingResults(false);
      }
    },
    [apiToken]
  );

  useEffect(() => {
    if (customer) return; // don't search while a customer is locked in
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(query.trim()), 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, runSearch, customer]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const pickCustomer = (lead: LeadOption) => {
    setCustomer(lead);
    setOpen(false);
    setQuery(lead.name || lead.phone || lead.sid);
  };

  const clearCustomer = () => {
    setCustomer(null);
    setQuery("");
    setOpen(true);
    setTimeout(() => runSearch(""), 0);
  };

  const handleSizeStringChange = (val: string) => {
    setSizeString(val);
    const parsed = parseDims(val);
    if (parsed.widthCm || parsed.heightCm || parsed.depthCm) {
      setF((prev) => ({
        ...prev,
        widthCm: String(parsed.widthCm || ""),
        heightCm: String(parsed.heightCm || ""),
        depthCm: String(parsed.depthCm || ""),
      }));
    }
  };

  const validate = (): string | null => {
    if (!customer) return "בחר קודם לקוח מהרשימה";
    if (!f.description.trim()) return "חובה תיאור מוצר";
    if (!f.material.trim()) return "חובה חומר";
    if (!(parseFloat(f.widthCm) > 0 && parseFloat(f.heightCm) > 0)) return "חובה רוחב וגובה";
    if ((parseInt(f.quantity, 10) || 0) < 1) return "חובה כמות חיובית";
    return null;
  };

  const handleSubmit = async () => {
    setError(null);
    const v = validate();
    if (v) return setError(v);
    setSubmitting(true);
    try {
      const finishingParts = [
        f.hasHandles ? "With handles" : "No handles",
        f.hasLamination ? "Laminated" : "Not laminated",
      ];
      const res = await fetch(widgetUrl("/api/widget/factory-requests", apiToken), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          manychatSubId: customer!.sid,
          customerName: customer!.name ?? undefined,
          productSpec: {
            description: f.description.trim(),
            material: f.material.trim(),
            widthCm: parseFloat(f.widthCm) || 0,
            heightCm: parseFloat(f.heightCm) || 0,
            depthCm: parseFloat(f.depthCm) || 0,
            quantity: parseInt(f.quantity, 10) || 0,
            printing: `${f.logoColors} color${f.logoColors > 1 ? "s" : ""}`,
            finishing: finishingParts.join(" / "),
            notes: f.notes.trim() || undefined,
          },
        }),
      });
      const data = await res.json();
      if (!data?.ok) {
        setError(data?.error ?? data?.detail ?? "כשל בשליחה");
        return;
      }
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const resetAll = () => {
    setCustomer(null);
    setQuery("");
    setResults([]);
    setF(EMPTY_SPEC);
    setSizeString("");
    setSent(false);
    setError(null);
  };

  if (sent) {
    return (
      <LuxShell>
        <div
          className="text-center"
          style={{
            background: "var(--lux-card)",
            borderRadius: 10,
            padding: "40px 20px",
            boxShadow: "inset 0 0 0 1px var(--lux-line)",
          }}
        >
          <CheckCircle2 className="size-8 mx-auto mb-3" style={{ color: "#7fbf8f" }} />
          <div style={{ fontSize: 16, color: "var(--lux-ink)", marginBottom: 6 }}>
            הבקשה נשלחה לאלי
          </div>
          <div style={{ fontSize: 13, color: "#8a7f74", marginBottom: 20 }}>
            {customer?.name ? `עבור ${customer.name}. ` : ""}הוא יבדוק את הפרטים וישלח למפעל.
          </div>
          <LuxCTA onClick={resetAll}>בקשה נוספת</LuxCTA>
        </div>
      </LuxShell>
    );
  }

  return (
    <LuxShell>
      <LuxTitle
        overline="— Sales → Factory"
        subtitle="בחר לקוח, מלא את הפרטים ושלח. אלי יקבל התראה, יבדוק ויעביר למפעל בעצמו."
      >
        בקשת <LuxAccent>הצעת מחיר.</LuxAccent>
      </LuxTitle>

      {/* ── I. customer picker ──
          overflow:visible + zIndex lift so the typeahead dropdown escapes the
          card (Section defaults to overflow:hidden for the numeral) and paints
          above section II instead of being clipped under it. */}
      <Section
        numeral="I"
        title="בחירת לקוח"
        style={{ marginBottom: 14, overflow: "visible", position: "relative", zIndex: 40 }}
      >
        <div ref={pickerRef} className="relative">
          <div
            className="relative"
            style={{
              background: "#211f1e",
              borderRadius: 8,
              boxShadow: "inset 0 0 0 1px rgba(69,70,77,0.2)",
              display: "flex",
              alignItems: "center",
              padding: "13px 16px",
              gap: 10,
            }}
          >
            <Search className="size-4" style={{ color: "#8a7f74" }} />
            <input
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (customer) setCustomer(null);
              }}
              onFocus={() => {
                setOpen(true);
                if (results.length === 0) runSearch(query.trim());
              }}
              placeholder={customer ? "החלף לקוח..." : "חפש לפי שם / טלפון"}
              className="flex-1 text-right focus:outline-none"
              style={{ background: "transparent", border: 0, fontSize: 14, color: "#e6e1e0" }}
            />
            {customer && (
              <button
                type="button"
                onClick={clearCustomer}
                title="בחר לקוח אחר"
                className="grid place-items-center"
                style={{
                  width: 24,
                  height: 24,
                  border: 0,
                  background: "transparent",
                  borderRadius: 6,
                  color: "#8a7f74",
                  cursor: "pointer",
                }}
              >
                <X className="size-4" />
              </button>
            )}
          </div>

          {open && !customer && (
            <div className="absolute z-30 mt-1 w-full rounded-lg border border-border bg-popover shadow-xl max-h-72 overflow-auto">
              {loadingResults ? (
                <div className="px-3 py-4 text-xs text-muted-foreground flex items-center gap-2 justify-center">
                  <Loader2 className="size-3.5 animate-spin" /> טוען…
                </div>
              ) : results.length === 0 ? (
                <div className="px-3 py-4 text-xs text-muted-foreground text-center">
                  לא נמצאו לקוחות.
                </div>
              ) : (
                <ul className="divide-y divide-border/60">
                  {results.map((r) => (
                    <li key={r.sid}>
                      <button
                        type="button"
                        onClick={() => pickCustomer(r)}
                        className="w-full px-3 py-2 text-right hover:bg-accent flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium truncate">{r.name || "(ללא שם)"}</div>
                          <div className="text-[11px] text-muted-foreground tabular-nums truncate">
                            {r.phone || r.sid}
                            {r.stage ? ` · ${r.stage}` : ""}
                          </div>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {customer && (
          <div
            className="mt-3 flex items-center gap-3"
            style={{
              background: "#1d1b1a",
              borderRadius: 8,
              padding: "12px 16px",
              boxShadow: "inset 0 0 0 1px rgba(69,70,77,0.16)",
            }}
          >
            <User className="size-5" style={{ color: "#bec6e0" }} />
            <div className="min-w-0">
              <div style={{ fontSize: 14, color: "#e6e1e0", fontWeight: 500 }}>
                {customer.name || customer.phone || customer.sid}
              </div>
              <div style={{ fontSize: 11, color: "#8a7f74" }}>
                {customer.phone ?? "—"}
                {customer.stage ? ` · ${customer.stage}` : ""}
              </div>
            </div>
          </div>
        )}
      </Section>

      {/* ── II. product spec ── */}
      <Section numeral="II" title="פרטי המוצר">
        <div className="space-y-3">
          <Field
            label="תיאור המוצר"
            value={f.description}
            onChange={(v) => set("description", v)}
            placeholder="למשל: שקיות מתנה לאירוע"
          />
          <Field
            label="חומר"
            value={f.material}
            onChange={(v) => set("material", v)}
            placeholder="80g non-woven"
          />

          <div>
            <span className="block text-[11px] mb-1 text-right" style={{ color: "#8a7f74" }}>
              מידות (cm)
            </span>
            <div className="grid grid-cols-3 gap-2">
              <Field label="W (רוחב)" value={f.widthCm} onChange={(v) => set("widthCm", v)} type="number" compact />
              <Field label="H (גובה)" value={f.heightCm} onChange={(v) => set("heightCm", v)} type="number" compact />
              <Field label="D (עומק)" value={f.depthCm} onChange={(v) => set("depthCm", v)} type="number" compact />
            </div>
            <div className="mt-2 flex items-center gap-2">
              <span className="text-[11px] shrink-0" style={{ color: "#8a7f74" }}>או הדבק:</span>
              <input
                value={sizeString}
                onChange={(e) => handleSizeStringChange(e.target.value)}
                placeholder="H20*D8*W25"
                dir="ltr"
                className="flex-1 rounded-md px-2 py-1 text-xs font-mono text-left"
                style={inputStyle}
              />
            </div>
            {(() => {
              const preview = buildSizeString(parseFloat(f.widthCm) || 0, parseFloat(f.heightCm) || 0, parseFloat(f.depthCm) || 0);
              return preview ? (
                <div className="mt-1 text-[10px] text-right" style={{ color: "#8a7f74" }}>
                  ייכתב ל-Feishu: <span className="font-mono" style={{ color: "var(--lux-ink)" }}>{preview}</span>
                </div>
              ) : null;
            })()}
          </div>

          <Field label="כמות" value={f.quantity} onChange={(v) => set("quantity", v)} type="number" />

          <div className="grid grid-cols-3 gap-2">
            <SelectField
              label="צבעי לוגו"
              value={String(f.logoColors)}
              onChange={(v) => set("logoColors", parseInt(v, 10))}
              options={[
                { value: "1", label: "1 צבע" },
                { value: "2", label: "2 צבעים" },
                { value: "3", label: "3 צבעים" },
                { value: "4", label: "3+ צבעים" },
              ]}
            />
            <SelectField
              label="ידיות"
              value={f.hasHandles ? "yes" : "no"}
              onChange={(v) => set("hasHandles", v === "yes")}
              options={[
                { value: "yes", label: "עם ידיות" },
                { value: "no", label: "ללא ידיות" },
              ]}
            />
            <SelectField
              label="למינציה"
              value={f.hasLamination ? "yes" : "no"}
              onChange={(v) => set("hasLamination", v === "yes")}
              options={[
                { value: "no", label: "ללא" },
                { value: "yes", label: "עם למינציה" },
              ]}
            />
          </div>

          <Field
            label="הערות למפעל"
            value={f.notes}
            onChange={(v) => set("notes", v)}
            placeholder="(אופציונלי)"
          />

          {error && (
            <p className="text-xs" style={{ color: "#e8b4b4" }}>
              {error}
            </p>
          )}

          <div className="flex items-center justify-end pt-2" style={{ borderTop: "1px solid var(--lux-line)" }}>
            <LuxCTA onClick={handleSubmit} disabled={submitting}>
              {submitting ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
              {"  "}שלח לאישור אלי
            </LuxCTA>
          </div>
        </div>
      </Section>
    </LuxShell>
  );
}

const inputStyle: CSSProperties = {
  background: "#211f1e",
  boxShadow: "inset 0 0 0 1px rgba(69,70,77,0.2)",
  color: "#e6e1e0",
  border: 0,
};

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
      <span className="block text-[11px] mb-1 text-right" style={{ color: "#8a7f74" }}>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md px-2 py-1.5 text-xs text-right focus:outline-none"
        style={inputStyle}
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
      <span className="block text-[11px] mb-1 text-right" style={{ color: "#8a7f74" }}>{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full rounded-md px-3 ${compact ? "py-1.5 text-xs" : "py-2 text-sm"} text-right focus:outline-none`}
        style={inputStyle}
      />
    </label>
  );
}
