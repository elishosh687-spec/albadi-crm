/**
 * GET  /api/widget/plays — current editable sales plays (merged over defaults).
 * POST /api/widget/plays — save edited plays. Body: { plays: PlaysMap }
 * Auth: ?widget_token=...
 */
import { NextRequest, NextResponse } from "next/server";
import { verifyWidgetToken } from "@/integrations/ghl/widget-auth";
import { loadPlays, savePlays } from "@/lib/sales/plays-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authed(req: NextRequest): boolean {
  const t =
    req.nextUrl.searchParams.get("widget_token") ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    null;
  return verifyWidgetToken(t);
}

export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ ok: true, plays: await loadPlays() });
}

export async function POST(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  try {
    const body = await req.json();
    await savePlays(body.plays ?? {});
    return NextResponse.json({ ok: true, plays: await loadPlays() });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "save failed" },
      { status: 500 }
    );
  }
}
