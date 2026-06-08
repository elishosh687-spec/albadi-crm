/**
 * Public diag: report whether the production env GOOGLE_SHEETS_FB_LEADS_ID
 * matches a candidate ID passed via ?id=<expected>. Returns only a boolean
 * + a configured-yes/no flag, so the actual configured value never leaks.
 *
 * Temporary — delete after verification.
 */
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const expected = req.nextUrl.searchParams.get("id")?.trim() ?? "";
  const configured = (process.env.GOOGLE_SHEETS_FB_LEADS_ID ?? "").trim();
  return NextResponse.json({
    configured: configured.length > 0,
    matches: expected.length > 0 && expected === configured,
  });
}
