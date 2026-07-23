/**
 * Zoho Books WRITE side — "דחוף ל-Zoho": create the customer invoice and
 * record order expenses (factory / commission / shipping) from the deal file.
 *
 * This is a faithful port of Eli's proven local flow
 * (/Users/eli/Projects/zoho/zoho_import.py + the zoho-invoice skill):
 *  - 18% VAT on every invoice line (prices are EX-VAT), bank details in Notes,
 *    consecutive numbering computed from the latest invoice (+
 *    ignore_auto_number_generation), mark Sent unless draft.
 *  - Exact-total lines: rate = targetTotal / qty (Zoho keeps >2 decimals).
 *  - Expenses: account by category (COGS / commission), paid through a
 *    partner account (אלי / שמעון), foreign currency via currency_id +
 *    exchange_rate, NO VAT by default (imports), customer_id linked.
 *  - Reporting tag "הזמנה": option apply is best-effort — the create-option
 *    API is DISABLED by Zoho, so a missing option is reported, not fatal.
 *
 * Org-specific IDs come from Eli's zoho project config.json (org 929765814).
 */

import { zohoGetBinary, zohoRequest } from "./client";
import { getLiveFx } from "@/lib/fx/live-rates";

// --- Albadi org constants (source: /Users/eli/Projects/zoho/config.json) ---
const DEFAULT_TAX_ID = "433486000000133001"; // 18% VAT
const VAT_PCT = 18;
const BANK_DETAILS =
  "פרטים להעברה בנקאית:\nלפקודת: אלבדי-אלעזר שושתרי\nבנק: Pepper / בנק לאומי (מס׳ בנק 10)\nסניף: 998\nחשבון: 16499401";
const COGS_ACCOUNT_ID = "433486000000034003";
const COMMISSION_ACCOUNT_ID = "433486000000163002";
// Who the money was paid THROUGH — the two partners' accounts OR the business
// bank account (Pepper). Sometimes an expense is paid straight from the
// business, not by a partner (Eli, 2026-07-23).
export const PAYER_ACCOUNTS: Record<string, string> = {
  "אלי": "433486000000095003",
  "שמעון": "433486000000095007",
  "העסק (Pepper)": "433486000000173002",
};
// Back-compat alias (older imports referenced PARTNER_ACCOUNTS).
export const PARTNER_ACCOUNTS = PAYER_ACCOUNTS;
const REPORTING_TAG_ID = "433486000000000333";

const money = (n: number) =>
  Number.isInteger(n) ? n.toLocaleString("en-US") : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ---------------------------------------------------------------------------
// customers
// ---------------------------------------------------------------------------

/** Exact-name lookup, create if missing (invoice path — like ensure_customer). */
export async function ensureCustomer(name: string): Promise<string> {
  const j = await zohoRequest("GET", "/contacts", { params: { contact_name: name } });
  for (const c of (j.contacts as Record<string, unknown>[]) ?? []) {
    if (String(c.contact_name ?? "").trim() === name.trim()) return String(c.contact_id);
  }
  const created = await zohoRequest("POST", "/contacts", {
    body: { contact_name: name, contact_type: "customer" },
  });
  return String((created.contact as Record<string, unknown>).contact_id);
}

/** Fuzzy lookup, NO creation (expense path — like find_customer_id). */
export async function findCustomerId(name: string): Promise<string | null> {
  const j = await zohoRequest("GET", "/contacts", { params: { search_text: name } });
  const contacts = ((j.contacts as Record<string, unknown>[]) ?? []).map((c) => ({
    id: String(c.contact_id),
    name: String(c.contact_name ?? "").trim(),
  }));
  const key = name.trim().toLowerCase();
  const exact = contacts.find((c) => c.name.toLowerCase() === key);
  const starts = contacts.find((c) => c.name.toLowerCase().startsWith(key));
  const contains = contacts.find((c) => c.name.toLowerCase().includes(key));
  return (exact ?? starts ?? contains)?.id ?? null;
}

// ---------------------------------------------------------------------------
// invoice
// ---------------------------------------------------------------------------

async function nextInvoiceNumber(): Promise<string> {
  const j = await zohoRequest("GET", "/invoices", { params: { per_page: "200" } });
  let prefix = "INV-", best = 0, width = 6;
  for (const inv of (j.invoices as Record<string, unknown>[]) ?? []) {
    const n = String(inv.invoice_number ?? "");
    let i = n.length;
    while (i > 0 && /\d/.test(n[i - 1])) i -= 1;
    const digits = n.slice(i);
    if (digits && Number(digits) > best) {
      best = Number(digits);
      prefix = n.slice(0, i);
      width = digits.length;
    }
  }
  return `${prefix}${String(best + 1).padStart(width, "0")}`;
}

function buildTerms(subtotal: number, taxAmount: number, total: number, advance: number, balance: number, pct: number): string {
  return [
    `תנאי תשלום: ${pct}% מקדמה עם אישור ההזמנה ותחילת העבודה, ו-${100 - pct}% יתרה מספר ימים לפני אספקת הסחורה.`,
    `סך ההזמנה (לפני מע"מ): ₪${money(subtotal)}`,
    `מע"מ ${VAT_PCT}%: ₪${money(taxAmount)}`,
    `סה"כ כולל מע"מ: ₪${money(total)}`,
    `לתשלום כעת — מקדמה ${pct}%: ₪${money(advance)}`,
    `יתרה לתשלום לפני אספקה: ₪${money(balance)}`,
    "ההזמנה תיכנס לייצור לאחר קבלת המקדמה.",
  ].join("\n");
}

export interface CreateInvoiceInput {
  customerName: string;
  /** Line name, e.g. שקית אלבד ממותגת — H35*D10*W25 (never "נון-וובן"). */
  productName: string;
  description?: string;
  quantity: number;
  /** Exact EX-VAT line total (₪) — rate becomes targetTotal/quantity. */
  targetTotalIls: number;
  advancePercent?: number;
  /** Override the auto-built terms text entirely (fixed-deposit deals). */
  customTerms?: string;
  /** Keep as draft in Zoho (no Sent status). Used for safe testing too. */
  draft?: boolean;
  date?: string; // yyyy-mm-dd
}

export interface CreateInvoiceResult {
  invoiceId: string;
  invoiceNumber: string;
  customerId: string;
  subtotal: number;
  taxAmount: number;
  total: number;
  advance: number;
  status: string;
  pdf: Uint8Array | null;
  tagApplied: boolean;
}

export async function createZohoInvoice(input: CreateInvoiceInput): Promise<CreateInvoiceResult> {
  const pct = input.advancePercent ?? 50;
  const customerId = await ensureCustomer(input.customerName);
  const qty = input.quantity;
  const rate = input.targetTotalIls / qty; // exact-total trick — Zoho keeps >2 decimals
  const subtotal = qty * rate;
  const taxAmount = Math.round(subtotal * (VAT_PCT / 100) * 100) / 100;
  const total = Math.round((subtotal + taxAmount) * 100) / 100;
  const advance = Math.round(total * (pct / 100) * 100) / 100;
  const balance = Math.round((total - advance) * 100) / 100;

  const invoiceNumber = await nextInvoiceNumber();
  const body: Record<string, unknown> = {
    customer_id: customerId,
    line_items: [
      {
        name: input.productName,
        description: input.description ?? "",
        quantity: qty,
        rate,
        tax_id: DEFAULT_TAX_ID,
      },
    ],
    terms: input.customTerms || buildTerms(subtotal, taxAmount, total, advance, balance, pct),
    notes: `תודה על ההזמנה!\n\n${BANK_DETAILS}`,
    is_inclusive_tax: false,
    invoice_number: invoiceNumber,
  };
  if (input.date) body.date = input.date;

  const created = await zohoRequest("POST", "/invoices", {
    params: { ignore_auto_number_generation: "true" },
    body,
  });
  let inv = created.invoice as Record<string, unknown>;
  const invoiceId = String(inv.invoice_id);

  if (!input.draft) {
    await zohoRequest("POST", `/invoices/${invoiceId}/status/sent`);
    const fresh = await zohoRequest("GET", `/invoices/${invoiceId}`);
    inv = (fresh.invoice as Record<string, unknown>) ?? inv;
  }

  // order reporting tag — best-effort (option must pre-exist; API can't create it)
  const tagApplied = await applyOrderTag("invoices", invoiceId, input.customerName, "order tag");

  let pdf: Uint8Array | null = null;
  try {
    pdf = await zohoGetBinary(`/invoices/${invoiceId}`, { accept: "pdf" });
    if (!(pdf[0] === 0x25 && pdf[1] === 0x50)) pdf = null; // %P sanity
  } catch {
    pdf = null;
  }

  return {
    invoiceId,
    invoiceNumber: String(inv.invoice_number ?? invoiceNumber),
    customerId,
    subtotal: Number(inv.sub_total ?? subtotal),
    taxAmount: Number(inv.tax_total ?? taxAmount),
    total: Number(inv.total ?? total),
    advance,
    status: String(inv.status ?? (input.draft ? "draft" : "sent")),
    pdf,
    tagApplied,
  };
}

export async function deleteZohoInvoice(invoiceId: string): Promise<void> {
  await zohoRequest("DELETE", `/invoices/${invoiceId}`);
}

// ---------------------------------------------------------------------------
// expenses
// ---------------------------------------------------------------------------

export interface CreateExpenseInput {
  category: "cogs" | "commission" | "custom";
  /** Required when category === "custom" (e.g. a shipping account). */
  accountId?: string;
  partner: string; // אלי | שמעון
  amount: number; // in `currency`
  currency: string; // ILS | CNY | USD
  /** FX to ILS; auto-fetched when omitted for foreign currency. */
  exchangeRate?: number;
  description: string;
  customerName?: string | null;
  date?: string;
}

export interface CreateExpenseResult {
  expenseId: string;
  bcyTotalIls: number;
  exchangeRate: number | null;
  customerLinked: boolean;
  tagApplied: boolean;
}

export async function createZohoExpense(input: CreateExpenseInput): Promise<CreateExpenseResult> {
  const accountId =
    input.category === "cogs" ? COGS_ACCOUNT_ID :
    input.category === "commission" ? COMMISSION_ACCOUNT_ID :
    input.accountId;
  if (!accountId) throw new Error("missing accountId for custom expense");
  const paidThrough = PAYER_ACCOUNTS[input.partner];
  if (!paidThrough) throw new Error(`משלם לא מוכר: ${input.partner}`);

  // Eli's Zoho plan REJECTS foreign-currency expenses via the API
  // (code 3048 — "plan does not support Expense in any currency other than
  // base"). Factory payments are always ¥, so we convert to ₪ at the live
  // rate and preserve the original amount in the description. The ₪ (base)
  // figure is what the per-order profit report uses anyway.
  let exchangeRate: number | null = null;
  let bookedAmount = input.amount;
  let bookedDesc = input.description;
  const cur = input.currency.toUpperCase();
  if (cur !== "ILS") {
    exchangeRate = input.exchangeRate ?? null;
    if (!exchangeRate) {
      const fx = await getLiveFx();
      exchangeRate = cur === "CNY" ? fx.cnyToIls : cur === "USD" ? fx.usdToIls : null;
    }
    if (!exchangeRate) throw new Error(`אין שער עבור ${cur} — הזן ידנית`);
    bookedAmount = Math.round(input.amount * exchangeRate * 100) / 100;
    bookedDesc = `${input.description} (${input.amount} ${cur} × ${exchangeRate.toFixed(3)} = ₪${bookedAmount})`;
  }

  const payload: Record<string, unknown> = {
    account_id: accountId,
    paid_through_account_id: paidThrough,
    date: input.date ?? new Date().toISOString().slice(0, 10),
    amount: bookedAmount,
    description: bookedDesc.slice(0, 500),
    is_inclusive_tax: false, // factory/commission carry no VAT (import default)
  };

  let customerLinked = false;
  if (input.customerName) {
    const cid = await findCustomerId(input.customerName);
    if (cid) {
      payload.customer_id = cid;
      customerLinked = true;
    }
  }

  const created = await zohoRequest("POST", "/expenses", { body: payload });
  const exp = created.expense as Record<string, unknown>;
  const expenseId = String(exp.expense_id);

  const tagApplied = input.customerName
    ? await applyOrderTag("expenses", expenseId, input.customerName)
    : false;

  return {
    expenseId,
    bcyTotalIls: Number(exp.bcy_total ?? bookedAmount),
    exchangeRate,
    customerLinked,
    tagApplied,
  };
}

export async function deleteZohoExpense(expenseId: string): Promise<void> {
  await zohoRequest("DELETE", `/expenses/${expenseId}`);
}

/** Expense accounts for the "custom" bucket dropdown (shipping/customs/etc). */
export async function listExpenseAccounts(): Promise<{ id: string; name: string }[]> {
  const j = await zohoRequest("GET", "/chartofaccounts", {
    params: { filter_by: "AccountType.Expense" },
  });
  return ((j.chartofaccounts as Record<string, unknown>[]) ?? []).map((a) => ({
    id: String(a.account_id),
    name: String(a.account_name ?? ""),
  }));
}

// ---------------------------------------------------------------------------
// reporting tag (best-effort)
// ---------------------------------------------------------------------------

/** Apply the "הזמנה" tag option matching the customer name. Returns false when
 *  the option doesn't exist (Zoho's create-option API is disabled — UI only). */
async function applyOrderTag(
  entity: "invoices" | "expenses",
  entityId: string,
  optionName: string,
  reason?: string
): Promise<boolean> {
  try {
    const j = await zohoRequest("GET", `/settings/tags/${REPORTING_TAG_ID}`);
    const options =
      ((j.reporting_tag as Record<string, unknown>)?.tag_options as Record<string, unknown>[]) ?? [];
    const opt = options.find(
      (o) => String(o.tag_option_name ?? "").trim() === optionName.trim()
    );
    if (!opt) return false;
    const body: Record<string, unknown> = {
      tags: [{ tag_id: REPORTING_TAG_ID, tag_option_id: String(opt.tag_option_id) }],
    };
    if (entity === "invoices" && reason) body.reason = reason;
    await zohoRequest("PUT", `/${entity}/${entityId}`, { body });
    return true;
  } catch (err) {
    console.warn("[zoho/write] tag apply failed (non-fatal)", err);
    return false;
  }
}
