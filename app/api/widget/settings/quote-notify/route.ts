/**
 * GET  /api/widget/settings/quote-notify?widget_token=...
 *   → { ok, current: {enabled, phone, name}, envFallback }
 * PUT  { enabled, phone?, name? }
 *
 * Who gets a WhatsApp ping when a quote is sent to a customer. Was hardwired to
 * Itay; Eli 2026-08-10 wanted it off and re-pointable to another salesperson
 * without a redeploy. See lib/notify/quote-notify-config.ts.
 */
import { NextRequest, NextResponse } from "next/server";
import { widgetAuthed } from "@/lib/widget/auth";
import { loadQuoteNotify, setQuoteNotify } from "@/lib/notify/quote-notify-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!widgetAuthed(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({
    ok: true,
    current: await loadQuoteNotify(),
    envFallback: (process.env.ITAY_NOTIFY_JID ?? "").trim() || null,
  });
}

export async function PUT(req: NextRequest) {
  if (!widgetAuthed(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const enabled = Boolean((body as { enabled?: unknown }).enabled);
  const phone = String((body as { phone?: unknown }).phone ?? "").trim();
  const name = String((body as { name?: unknown }).name ?? "").trim();
  if (enabled && !phone) {
    return NextResponse.json(
      { ok: false, error: "צריך מספר טלפון כדי להפעיל התראות" },
      { status: 400 },
    );
  }
  await setQuoteNotify({ enabled, phone, name });
  return NextResponse.json({ ok: true, current: await loadQuoteNotify() });
}
