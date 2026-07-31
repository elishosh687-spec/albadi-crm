/**
 * Payment terms — VAT, the payment schedule, and the bank details, in ONE
 * client-safe place.
 *
 * Why this module exists:
 *  - 18% VAT used to live in three separate copies (lib/zoho/write.ts,
 *    lib/zoho/match.ts, and a bare `0.18` in ClosedQuotesView) and the bank
 *    details in a private const inside lib/zoho/write.ts — a server-only module
 *    (it imports the Zoho client + live FX), so no `"use client"` component
 *    could touch them. See the client-bundle import rule in CLAUDE.md.
 *  - Eli wants the customer WhatsApp message to end with the real amount due,
 *    the payment schedule and where to transfer the money (2026-07-28). The
 *    invoice and the message MUST quote the same numbers, so both now read from
 *    here.
 *
 * Pure + client-safe: no env, no I/O, no server imports. Mirrors the role of
 * lib/manychat/stages.ts and lib/sales/stage-plays.he.ts.
 */

/** Israeli VAT. Also the rate Zoho invoices are issued at (DEFAULT_TAX_ID). */
export const VAT_PCT = 18;

/** Payee + account for the customer's bank transfer. Verified with Eli
 *  2026-07-28: the surname is שושתרי (tav) — matches Zoho's own config. */
export const BANK_DETAILS_LINES = [
  "פרטים להעברה בנקאית",
  "לפקודת: אלבדי-אלעזר שושתרי",
  "בנק: Pepper / בנק לאומי (מס׳ בנק 10)",
  "סניף: 998",
  "חשבון: 16499401",
];

/** Single-line form kept for the Zoho invoice `notes` field, which expects the
 *  legacy "פרטים להעברה בנקאית:\n…" shape. */
export const BANK_DETAILS = [
  `${BANK_DETAILS_LINES[0]}:`,
  ...BANK_DETAILS_LINES.slice(1),
].join("\n");

const r2 = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number) => `₪${n.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export interface PaymentInstallment {
  /** Share of the VAT-inclusive total, e.g. 50 or 30. */
  pct: number;
  /** When this one is paid — the customer-facing Hebrew phrasing. */
  when: string;
  ils: number;
}

export interface PaymentPlan {
  id: string;
  /** Button label in the send picker. */
  label: string;
  /** Percentages, must sum to 100. */
  pcts: number[];
  /** One `when` phrase per percentage. */
  whens: string[];
}

/**
 * The plans Eli actually uses (confirmed 2026-07-28). A custom deposit % is
 * handled by `customDepositPlan`, not by adding presets here.
 */
export const PAYMENT_PRESETS: PaymentPlan[] = [
  {
    id: "50_50",
    label: "50% / 50%",
    pcts: [50, 50],
    whens: ["מקדמה בתחילת העבודה", "בהגיע הסחורה לישראל"],
  },
  {
    id: "30_70",
    label: "30% / 70%",
    pcts: [30, 70],
    whens: ["מקדמה בתחילת העבודה", "בהגיע הסחורה לישראל"],
  },
  {
    id: "30_40_30",
    label: "3 פעימות",
    pcts: [30, 40, 30],
    whens: [
      "מקדמה בתחילת העבודה",
      "לפני יציאת הסחורה מהמפעל",
      "בהגיע הסחורה לישראל",
    ],
  },
];

export const DEFAULT_PAYMENT_PLAN_ID = "50_50";

/** A two-stage plan with an arbitrary deposit % (the "אחוז חופשי" field). */
export function customDepositPlan(depositPct: number): PaymentPlan {
  const dep = Math.min(100, Math.max(1, Math.round(depositPct)));
  return {
    id: `custom_${dep}`,
    label: `${dep}% / ${100 - dep}%`,
    pcts: [dep, 100 - dep],
    whens: ["מקדמה בתחילת העבודה", "בהגיע הסחורה לישראל"],
  };
}

/** Resolve a stored id (preset or `custom_NN`) back to a plan. */
export function resolvePaymentPlan(planId: string | null | undefined): PaymentPlan {
  const id = (planId ?? "").trim();
  const preset = PAYMENT_PRESETS.find((p) => p.id === id);
  if (preset) return preset;
  const m = id.match(/^custom_(\d{1,3})$/);
  if (m) return customDepositPlan(parseInt(m[1], 10));
  return PAYMENT_PRESETS.find((p) => p.id === DEFAULT_PAYMENT_PLAN_ID)!;
}

export interface PaymentSchedule {
  /** The ex-VAT figure the message already printed as its total. */
  subtotal: number;
  vat: number;
  /** subtotal + vat — what the customer actually pays. */
  total: number;
  installments: PaymentInstallment[];
}

/**
 * Split a quote total into VAT + a payment schedule.
 *
 * Two deliberate choices, both matching how the business already works:
 *  - The deposit is a share of the **VAT-inclusive** total (this is what
 *    `buildTerms` in lib/zoho/write.ts does, and what Eli's own example shows:
 *    50% of ₪21,977, not of ₪18,625).
 *  - The **last installment absorbs the rounding remainder**, so the parts
 *    always add up to the printed total exactly — the same rule as
 *    `customerRoundedTotalIls` and `splitCustomerView`. Without it a 30/40/30
 *    split lands a agora off and the customer's arithmetic "fails".
 *
 * @param exVatTotalIls the total the MESSAGE printed — pass it in, never
 *   recompute it here (a split shipment's total comes from splitCustomerView).
 */
export function computePaymentSchedule(
  exVatTotalIls: number,
  plan: PaymentPlan,
  vatPct: number = VAT_PCT
): PaymentSchedule {
  const subtotal = r2(exVatTotalIls);
  const vat = r2(subtotal * (vatPct / 100));
  const total = r2(subtotal + vat);

  const installments: PaymentInstallment[] = plan.pcts.map((pct, i) => ({
    pct,
    when: plan.whens[i] ?? "",
    ils: r2(total * (pct / 100)),
  }));
  // Absorb the rounding drift in the final payment.
  if (installments.length > 0) {
    const paidBeforeLast = installments
      .slice(0, -1)
      .reduce((s, x) => s + x.ils, 0);
    installments[installments.length - 1].ils = r2(total - paidBeforeLast);
  }
  return { subtotal, vat, total, installments };
}

/**
 * A payment plan stored PER DEAL (factory_quote_requests.payment_plan). Either:
 *  - a plan id string (preset "50_50"/"30_40_30"/… or "custom_NN"), OR
 *  - a custom installments object — needed for shapes the presets can't express,
 *    e.g. Yossi Gold: a FIXED ₪3,420 deposit (already paid) + the balance 50/50.
 *    Each installment is a fixed `ils` amount OR a `pct` share of the REMAINDER
 *    (total − sum of fixed amounts). Added 2026-07-31.
 */
export type StoredDealPlan =
  | string
  | { label?: string; installments: { pct?: number; ils?: number; when: string }[] };

/**
 * Resolve a stored per-deal plan into a schedule on the given ex-VAT total.
 *  - string / null → the preset (or custom_NN) path via computePaymentSchedule.
 *  - object → honor fixed `ils` installments, split the remainder across the
 *    `pct` installments by weight, last absorbs the rounding remainder (same
 *    rule as computePaymentSchedule). `pct` on a fixed installment is derived
 *    for display only.
 */
export function resolveDealSchedule(
  exVatTotalIls: number,
  stored: StoredDealPlan | null | undefined,
  vatPct: number = VAT_PCT
): PaymentSchedule {
  if (stored == null || typeof stored === "string") {
    return computePaymentSchedule(exVatTotalIls, resolvePaymentPlan(stored ?? undefined), vatPct);
  }
  const subtotal = r2(exVatTotalIls);
  const vat = r2(subtotal * (vatPct / 100));
  const total = r2(subtotal + vat);

  const items = stored.installments ?? [];
  const isFixed = (it: { ils?: number }) => typeof it.ils === "number";
  const fixedSum = items.reduce((s, it) => s + (isFixed(it) ? (it.ils as number) : 0), 0);
  const remainder = r2(total - fixedSum);
  const pctSum = items.reduce((s, it) => s + (isFixed(it) ? 0 : (it.pct ?? 0)), 0);

  const installments: PaymentInstallment[] = items.map((it) => {
    if (isFixed(it)) {
      const ils = r2(it.ils as number);
      return { pct: total > 0 ? Math.round((ils / total) * 100) : 0, when: it.when, ils };
    }
    const share = pctSum > 0 ? (it.pct ?? 0) / pctSum : 0;
    return { pct: it.pct ?? 0, when: it.when, ils: r2(remainder * share) };
  });
  // Last installment absorbs the rounding drift so the parts sum to `total`.
  if (installments.length > 0) {
    const paidBeforeLast = installments.slice(0, -1).reduce((s, x) => s + x.ils, 0);
    installments[installments.length - 1].ils = r2(total - paidBeforeLast);
  }
  return { subtotal, vat, total, installments };
}

/**
 * The customer-facing payment block, appended to a quote message. Phrasing
 * follows the template Eli wrote by hand.
 */
export function buildPaymentBlock(
  schedule: PaymentSchedule,
  vatPct: number = VAT_PCT
): string[] {
  const lines: string[] = [
    `*מע״מ ${vatPct}%: ${fmt(schedule.vat)}*`,
    "━━━━━━━━━━━━━━",
    `💵 *סה״כ לתשלום: ${fmt(schedule.total)}*`,
    "━━━━━━━━━━━━━━",
    "",
  ];

  schedule.installments.forEach((inst, i) => {
    const isFirst = i === 0;
    const title = isFirst
      ? "*תשלום ראשוני*"
      : i === schedule.installments.length - 1
        ? "*תשלום אחרון*"
        : `*תשלום ${i + 1}*`;
    lines.push(`${title} — ${fmt(inst.ils)}`);
    lines.push(`(${inst.pct}% · ${inst.when})`);
    lines.push("");
  });

  lines.push("━━━━━━━━━━━━━━", ...BANK_DETAILS_LINES);
  return lines;
}
