/**
 * GET /api/sales/shipping-options?token=<WIDGET_SALES_TOKEN>
 *
 * The factory-request form (sales tab) needs the sea/air option ids + names. It
 * used to read them from /api/widget/factory/config, whose response ALSO carries
 * margins/commission/FX — a boss-data leak into the sales client. This returns
 * ONLY the shipping option identity, honoring admin customization without the
 * financial fields.
 */
import { NextRequest, NextResponse } from "next/server";
import { salesAuthed } from "@/lib/widget/sales-auth";
import { getFactoryConfig } from "@/lib/factory/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!salesAuthed(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  try {
    const cfg = await getFactoryConfig();
    const shippingOptions = cfg.shippingOptions.map((s) => ({
      id: s.id,
      name: s.name,
      type: s.type,
      enabled: s.enabled,
    }));
    return NextResponse.json({ ok: true, shippingOptions });
  } catch (err) {
    console.error("[sales/shipping-options] failed", err);
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
