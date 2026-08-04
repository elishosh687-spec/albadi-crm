/**
 * Salesperson-screen auth — a SEPARATE shared token from the boss widget token.
 *
 * The sales GHL menu link embeds `?token=<WIDGET_SALES_TOKEN>`. A holder of this
 * token reaches ONLY the /api/sales/* endpoints (which return customer-facing
 * numbers, never cost/profit/margin/commission). It does NOT satisfy
 * `widgetAuthed`, so it can't reach the boss widget/factory endpoints — and the
 * boss token can't be used to spoof a sales session either.
 *
 * STRICT by design: unlike `verifyWidgetToken` (unset => pass, for dev), an
 * unset WIDGET_SALES_TOKEN means the sales screen is CLOSED — never open by
 * accident.
 */
import { NextRequest } from "next/server";

const BOM = "﻿";
function readEnv(key: string): string {
  const raw = process.env[key] ?? "";
  return raw.startsWith(BOM) ? raw.slice(1) : raw;
}

export const WIDGET_SALES_TOKEN = readEnv("WIDGET_SALES_TOKEN");

function verify(token: string | null | undefined): boolean {
  if (!WIDGET_SALES_TOKEN) return false; // unset => closed
  if (!token) return false;
  if (token.length !== WIDGET_SALES_TOKEN.length) return false;
  let mismatch = 0;
  for (let i = 0; i < token.length; i++) {
    mismatch |= token.charCodeAt(i) ^ WIDGET_SALES_TOKEN.charCodeAt(i);
  }
  return mismatch === 0;
}

/** True when the request carries a valid sales token (query `token`/`sales_token`
 *  or `Authorization: Bearer`). */
export function salesAuthed(req: NextRequest): boolean {
  const fromQuery =
    req.nextUrl.searchParams.get("sales_token") ??
    req.nextUrl.searchParams.get("token");
  const fromHeader = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return verify(fromQuery) || verify(fromHeader);
}
