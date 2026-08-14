/**
 * POST /api/widget/factory/deal-update-whatsapp/[id]?widget_token=...
 *   ?dry=1 → build the message and return it WITHOUT sending.
 *
 * WhatsApps the customer the amounts added to their deal after the original
 * quote (see lib/factory/server/sendDealUpdate.ts). The UI always previews
 * (dry=1) and asks before the real send — this message goes to a customer.
 */
import { NextRequest, NextResponse } from "next/server";
import { widgetAuthed } from "@/lib/widget/auth";
import { sendDealUpdate } from "@/lib/factory/server/sendDealUpdate";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  if (!widgetAuthed(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const dry = new URL(req.url).searchParams.get("dry") === "1";
  const result = await sendDealUpdate(id, { dryRun: dry });
  return NextResponse.json(result, { status: result.ok ? 200 : 422 });
}
