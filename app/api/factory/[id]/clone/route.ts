/**
 * POST /api/factory/[id]/clone
 *
 * Dashboard-cookie variant of the clone endpoint. See lib/factory/clone-quote.
 */

import { NextRequest, NextResponse } from "next/server";
import { cloneFactoryQuote } from "@/lib/factory/clone-quote";

export const runtime = "nodejs";

function authorized(req: NextRequest): boolean {
  const cookie = req.cookies.get("albadi_auth");
  return !!cookie && cookie.value === process.env.ADMIN_PASSWORD;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const result = await cloneFactoryQuote(id);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true, ...result.result });
}
