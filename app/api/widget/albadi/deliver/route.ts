/**
 * POST /api/widget/albadi/deliver?widget_token=...
 *   multipart: file, customerName, customerSid?, kind(mockup|video|dieline|invoice),
 *              send?(whatsapp), quotationNo?
 *   → hosts the file (Blob), attaches its URL to the customer's ORDER FOLLOW row
 *     in Feishu (mockup→Y, dieline→X; invoice has no column), and optionally
 *     sends it to the customer on WhatsApp (GreenAPI, PDF as a document).
 *
 * GET /api/widget/albadi/deliver?customer=<name>&widget_token=...
 *   → { orders: OrderMatch[] } so a skill can ask WHICH order when a customer
 *     has more than one before POSTing with quotationNo.
 *
 * The single "deliver" hub every Albadi skill (mockup / dieline / invoice) calls.
 */
import { NextRequest, NextResponse } from "next/server";
import { widgetAuthed } from "@/lib/widget/auth";
import { findOrderRows, attachFileToOrder } from "@/lib/feishu/order-follow";
import { sendBridgeMessage } from "@/lib/bridge/client";
import { db } from "@/lib/db";
import { leads, factoryQuoteRequests } from "@/drizzle/schema";
import { ilike, eq, desc, and, isNotNull } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const KIND_LABEL: Record<string, string> = {
  mockup: "הדמיה", video: "וידאו",
  logo: "לוגו", factory_dieline: "פריסת מפעל (ריקה)",
  dieline: "פריסה סופית / קובץ הפקה", final: "פריסה סופית / קובץ הפקה",
  invoice: "חשבונית",
};

function slug(s: string): string {
  return (s || "customer").replace(/[^a-zA-Z0-9_.\-]/g, "_").slice(0, 60) || "customer";
}
function extOf(name: string, type: string): string {
  const e = (name.split(".").pop() || "").toLowerCase();
  if (e && e.length <= 5) return e;
  if (type.includes("pdf")) return "pdf";
  if (type.includes("mp4")) return "mp4";
  if (type.includes("png")) return "png";
  return "jpg";
}

function handlesFrom(finishing: string): string {
  const s = (finishing || "").toLowerCase();
  if (/no handle|ללא ידיות|die.?cut|punch|不带提手/.test(s)) return "die-cut (flat punched hole, no sewn handles)";
  return "loop-handle tote (sewn handles + bottom gusset)";
}

/** Given a typed name, the matching CRM lead(s) + their latest quote spec —
 *  so the mockup skill can auto-fill size/handles instead of asking. */
async function lookupCustomers(name: string) {
  const q = name.trim();
  if (!q) return [];
  const rows = await db
    .select({ sid: leads.manychatSubId, name: leads.name, phone: leads.phoneE164 })
    .from(leads)
    .where(ilike(leads.name, `%${q}%`))
    .limit(8);
  const out: {
    sid: string; name: string | null; phone: string | null;
    size: string | null; handles: string | null; finishing: string | null; printing: string | null;
  }[] = [];
  for (const r of rows) {
    if (!r.sid) continue;
    const [quote] = await db
      .select({ spec: factoryQuoteRequests.productSpec })
      .from(factoryQuoteRequests)
      .where(and(eq(factoryQuoteRequests.manychatSubId, r.sid), isNotNull(factoryQuoteRequests.productSpec)))
      .orderBy(desc(factoryQuoteRequests.createdAt))
      .limit(1);
    const s = (quote?.spec ?? {}) as Record<string, unknown>;
    const size = [s.heightCm && `H${s.heightCm}`, s.depthCm && `D${s.depthCm}`, s.widthCm && `W${s.widthCm}`]
      .filter(Boolean).join("×") || null;
    out.push({
      sid: r.sid, name: r.name, phone: r.phone, size,
      handles: s.finishing ? handlesFrom(String(s.finishing)) : null,
      finishing: (s.finishing as string) ?? null, printing: (s.printing as string) ?? null,
    });
  }
  return out;
}

export async function GET(req: NextRequest) {
  if (!widgetAuthed(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const customer = req.nextUrl.searchParams.get("customer") || "";
  if (!customer) return NextResponse.json({ ok: false, error: "missing customer" }, { status: 400 });
  try {
    const [orders, customers] = await Promise.all([findOrderRows(customer), lookupCustomers(customer)]);
    return NextResponse.json({ ok: true, orders, customers });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!widgetAuthed(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ ok: false, error: "expected multipart/form-data" }, { status: 400 }); }

  const file = form.get("file");
  const customerName = String(form.get("customerName") || "").trim();
  const customerSid = String(form.get("customerSid") || "").trim();
  const kind = String(form.get("kind") || "mockup").trim();
  const send = String(form.get("send") || "").trim();
  const quotationNo = String(form.get("quotationNo") || "").trim() || null;

  if (!(file instanceof Blob) || file.size === 0) return NextResponse.json({ ok: false, error: "missing file" }, { status: 400 });
  if (!customerName) return NextResponse.json({ ok: false, error: "missing customerName" }, { status: 400 });

  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const origName = (file as File).name || `${kind}.bin`;
    const ext = extOf(origName, file.type || "");
    const fileName = `${slug(customerName)}-${kind}.${ext}`;

    // 1. host the file (public Blob)
    const { put } = await import("@vercel/blob");
    const blob = await put(`albadi-files/${slug(customerName)}/${kind}-${Date.now()}.${ext}`, buf, {
      access: "public", addRandomSuffix: false, contentType: file.type || "application/octet-stream",
    });

    // 2. attach to the ORDER FOLLOW sheet (skipped for kinds with no column, e.g. invoice)
    // Mockups/videos are pre-sale — attach only if the customer already has an
    // order row; never create one. Dieline/invoice (post-close) may append.
    const appendIfMissing = !["mockup", "video"].includes(kind);
    const feishu = await attachFileToOrder(customerName, kind, blob.url, quotationNo, appendIfMissing).catch((e) => ({
      ok: false as const, skipped: e instanceof Error ? e.message : "feishu failed",
    }));
    if ("needQuotation" in feishu && feishu.needQuotation) {
      return NextResponse.json({ ok: false, url: blob.url, needQuotation: feishu.needQuotation });
    }

    // 3. send to the customer on WhatsApp (image/video/pdf all via mediaPath)
    let wa: { sent: boolean; waMessageId?: string | null; error?: string } = { sent: false };
    if (send === "whatsapp" && customerSid) {
      try {
        const caption = `שולח לך ${KIND_LABEL[kind] ?? "קובץ"} 🙂`;
        const r = await sendBridgeMessage(customerSid, caption, blob.url, "eli", fileName);
        wa = { sent: true, waMessageId: r.wa_message_id ?? null };
      } catch (e) {
        wa = { sent: false, error: e instanceof Error ? e.message : "send failed" };
      }
    }

    return NextResponse.json({ ok: true, url: blob.url, feishu, wa });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
