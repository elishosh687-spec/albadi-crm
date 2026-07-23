/**
 * Zoho Books client — read-only pulls for the "כמה באמת הרווחתי" reconciliation.
 *
 * Auth: OAuth2 refresh-token ("Self Client" grant Eli creates once in the Zoho
 * API console). Access tokens (~1h) are cached in-process AND in app_config
 * under `zoho.token` so serverless invocations share them (same pattern as
 * fx.live). Missing env → zohoConfigured() is false and every list returns [],
 * so the UI can render a "לא מחובר" state instead of erroring.
 *
 * Env (Vercel prod):
 *   ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET / ZOHO_REFRESH_TOKEN — Self Client creds
 *   ZOHO_ORG_ID — Zoho Books organization id
 *   ZOHO_DC — accounts/API TLD suffix: "com" (default) / "eu" / "in" / "com.au" / "jp"
 *
 * Amounts: docs come back in their own currency (₪/־$/¥). totalIls is converted
 * with the live FX cache (lib/fx/live-rates) so the match UI compares apples to
 * apples; the original total+currency are kept for display.
 */

import { db } from "@/lib/db";
import { appConfig } from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import { getLiveFx } from "@/lib/fx/live-rates";

const TOKEN_KEY = "zoho.token";

export interface ZohoListedDoc {
  type: "invoice" | "bill" | "expense";
  id: string;
  /** Human number (INV-000231 / BILL-000118); expenses use reference/account. */
  number: string;
  /** yyyy-mm-dd */
  date: string;
  /** Customer (invoice/expense customer link) or vendor. */
  party: string;
  status: string;
  total: number;
  currencyCode: string;
  /** ₪ amount. Prefers Zoho's bcy_total (the ACTUAL booked rate — base currency
   *  is ILS); falls back to live-FX conversion. Null if neither works. */
  totalIls: number | null;
  /** Expense account (e.g. "Cost of Goods Sold", "עמלות מכירה"). */
  accountName?: string;
  description?: string;
}

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

export function zohoConfigured(): boolean {
  return !!(
    env("ZOHO_CLIENT_ID") &&
    env("ZOHO_CLIENT_SECRET") &&
    env("ZOHO_REFRESH_TOKEN") &&
    env("ZOHO_ORG_ID")
  );
}

function dc(): string {
  return env("ZOHO_DC") || "com";
}

let memToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (memToken && memToken.expiresAt > now + 60_000) return memToken.token;

  // Shared cache across serverless instances.
  const [row] = await db.select().from(appConfig).where(eq(appConfig.key, TOKEN_KEY)).limit(1);
  const cached = row?.value as { token?: string; expiresAt?: number } | undefined;
  if (cached?.token && typeof cached.expiresAt === "number" && cached.expiresAt > now + 60_000) {
    memToken = { token: cached.token, expiresAt: cached.expiresAt };
    return cached.token;
  }

  const params = new URLSearchParams({
    refresh_token: env("ZOHO_REFRESH_TOKEN"),
    client_id: env("ZOHO_CLIENT_ID"),
    client_secret: env("ZOHO_CLIENT_SECRET"),
    grant_type: "refresh_token",
  });
  const res = await fetch(`https://accounts.zoho.${dc()}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
    cache: "no-store",
  });
  const j = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !j.access_token) {
    throw new Error(`zoho token refresh failed: ${j.error ?? res.status}`);
  }
  const expiresAt = now + (j.expires_in ?? 3600) * 1000;
  memToken = { token: j.access_token, expiresAt };
  await db
    .insert(appConfig)
    .values({ key: TOKEN_KEY, value: { token: j.access_token, expiresAt }, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appConfig.key,
      set: { value: { token: j.access_token, expiresAt }, updatedAt: new Date() },
    });
  return j.access_token;
}

async function zohoGet(path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const token = await getAccessToken();
  const qs = new URLSearchParams({ organization_id: env("ZOHO_ORG_ID"), ...params });
  const res = await fetch(`https://www.zohoapis.${dc()}/books/v3${path}?${qs}`, {
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
    cache: "no-store",
  });
  const j = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(`zoho GET ${path} failed: ${res.status} ${JSON.stringify(j).slice(0, 200)}`);
  }
  return j;
}

/** Write-side request (POST/PUT/DELETE). Exported for lib/zoho/write.ts. */
export async function zohoRequest(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  opts?: { params?: Record<string, string>; body?: unknown }
): Promise<Record<string, unknown>> {
  const token = await getAccessToken();
  const qs = new URLSearchParams({ organization_id: env("ZOHO_ORG_ID"), ...(opts?.params ?? {}) });
  const res = await fetch(`https://www.zohoapis.${dc()}/books/v3${path}?${qs}`, {
    method,
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      ...(opts?.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
    cache: "no-store",
  });
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(
      `zoho ${method} ${path} failed: ${res.status} ${JSON.stringify(j).slice(0, 300)}`
    );
  }
  return j;
}

/** Raw binary GET (invoice PDF). */
export async function zohoGetBinary(
  path: string,
  params: Record<string, string>
): Promise<Uint8Array> {
  const token = await getAccessToken();
  const qs = new URLSearchParams({ organization_id: env("ZOHO_ORG_ID"), ...params });
  const res = await fetch(`https://www.zohoapis.${dc()}/books/v3${path}?${qs}`, {
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`zoho binary GET ${path} failed: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

function isoDaysAgo(days: number): string {
  const d = new Date(Date.now() - days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

async function toIls(total: number, currency: string): Promise<number | null> {
  const c = (currency || "ILS").toUpperCase();
  if (c === "ILS") return total;
  try {
    const fx = await getLiveFx();
    if (c === "USD") return total * fx.usdToIls;
    if (c === "CNY" || c === "RMB") return total * fx.cnyToIls;
  } catch {
    /* fx down → no conversion */
  }
  return null;
}

async function mapDocs(
  raw: Record<string, unknown>[],
  type: ZohoListedDoc["type"]
): Promise<ZohoListedDoc[]> {
  const out: ZohoListedDoc[] = [];
  for (const d of raw) {
    const total = Number(d.total ?? d.bcy_total ?? 0);
    const currency = String(d.currency_code ?? "ILS");
    // bcy_total = amount in the org's base currency (ILS) at the rate Zoho
    // actually booked — better than any live-FX guess for foreign docs.
    const bcy = Number(d.bcy_total);
    const totalIls =
      Number.isFinite(bcy) && bcy > 0 ? bcy : await toIls(total, currency);
    out.push({
      type,
      id: String(
        d.invoice_id ?? d.bill_id ?? d.expense_id ?? d[`${type}_id`] ?? ""
      ),
      number: String(
        d.invoice_number ?? d.bill_number ?? d.reference_number ?? d.account_name ?? ""
      ),
      date: String(d.date ?? ""),
      party: String(d.customer_name || d.vendor_name || ""),
      status: String(d.status ?? ""),
      total,
      currencyCode: currency,
      totalIls,
      accountName: d.account_name ? String(d.account_name) : undefined,
      description: d.description ? String(d.description) : undefined,
    });
  }
  return out.filter((d) => d.id);
}

/** Customer invoices (income side), newest first. */
export async function listZohoInvoices(opts?: { sinceDays?: number }): Promise<ZohoListedDoc[]> {
  if (!zohoConfigured()) return [];
  const j = await zohoGet("/invoices", {
    date_start: isoDaysAgo(opts?.sinceDays ?? 180),
    sort_column: "date",
    sort_order: "D",
    per_page: "200",
  });
  return mapDocs((j.invoices as Record<string, unknown>[]) ?? [], "invoice");
}

/** Vendor bills (factory + shipping company), newest first. */
export async function listZohoBills(opts?: { sinceDays?: number }): Promise<ZohoListedDoc[]> {
  if (!zohoConfigured()) return [];
  const j = await zohoGet("/bills", {
    date_start: isoDaysAgo(opts?.sinceDays ?? 180),
    sort_column: "date",
    sort_order: "D",
    per_page: "200",
  });
  return mapDocs((j.bills as Record<string, unknown>[]) ?? [], "bill");
}

/** Recorded expenses (often how shipping/customs get booked), newest first. */
export async function listZohoExpenses(opts?: { sinceDays?: number }): Promise<ZohoListedDoc[]> {
  if (!zohoConfigured()) return [];
  const j = await zohoGet("/expenses", {
    date_start: isoDaysAgo(opts?.sinceDays ?? 180),
    sort_column: "date",
    sort_order: "D",
    per_page: "200",
  });
  return mapDocs((j.expenses as Record<string, unknown>[]) ?? [], "expense");
}
