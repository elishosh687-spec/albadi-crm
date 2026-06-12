"use client";

/**
 * Small shared helpers for the factory-quote calc UIs (widget side).
 * Extracted so the combined-calc modal and the history view don't each grow
 * their own copy of the WhatsApp-link builder and the tiny presentational bits.
 */

/**
 * Build the WhatsApp deep-link for a combined (multi-product) quote PDF.
 * Returns null when there's no phone or no ids. Caption matches the one used
 * by the manual multi-select combine bar so the customer sees one consistent
 * message regardless of where it was triggered.
 */
export function buildCombineWaUrl(
  ids: string[],
  name: string | null,
  phone: string | null,
  origin: string
): string | null {
  const digits = (phone ?? "").replace(/[^\d]/g, "");
  if (!digits || ids.length === 0) return null;
  const link = `${origin}/api/factory/combine/pdf?ids=${ids.join(",")}`;
  const caption = [
    name ? `היי ${name},` : "היי,",
    `מצורפת הצעת מחיר משולבת ל-${ids.length} מוצרים.`,
    `הצעה מלאה: ${link}`,
    "ההצעה בתוקף ל-14 יום. נשמח לקבל אישור 🙂",
  ].join("\n");
  return `https://wa.me/${digits}?text=${encodeURIComponent(caption)}`;
}

export function formatIls(n: number): string {
  return `₪${n.toLocaleString("he-IL", { maximumFractionDigits: 2 })}`;
}

export function SpecField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div>
      <label className="block text-[11px] text-muted-foreground mb-0.5">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-md border border-border bg-background/40 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
      />
    </div>
  );
}

export function PriceRow({
  label,
  value,
  bold,
  highlight,
}: {
  label: string;
  value: string;
  bold?: boolean;
  highlight?: boolean;
}) {
  return (
    <div className="flex justify-between gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={[
          "tabular-nums text-right",
          bold ? "font-semibold" : "",
          highlight ? "text-success font-medium" : "",
        ].join(" ")}
      >
        {value}
      </span>
    </div>
  );
}
