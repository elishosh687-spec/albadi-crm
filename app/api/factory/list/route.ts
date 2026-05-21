/**
 * GET /api/factory/list[?status=pending|received|finalized|all][&lead=<sid>]
 *
 * Returns factory_quote_requests rows joined with the lead's display name.
 */

import { NextRequest, NextResponse } from "next/server";
import { listFactoryQuotes } from "@/lib/factory/server/list";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const requests = await listFactoryQuotes({
    status: url.searchParams.get("status") ?? undefined,
    lead: url.searchParams.get("lead") ?? undefined,
  });
  return NextResponse.json({ ok: true, requests });
}
