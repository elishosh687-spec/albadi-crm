/**
 * Studio shared helpers — talks to the prod CRM over HTTP (never imports CRM
 * server code, so the isolated node_modules stays clean). Mirrors the fetch
 * logic in scripts/deal-file.ts but returns structured data for the web UI.
 */
import { readFile, readdir, stat, mkdir } from "node:fs/promises";
import { join, basename } from "node:path";
import { homedir } from "node:os";

export const CRM_BASE = (process.env.CRM_BASE || "https://albadi-crm.vercel.app").replace(/\/$/, "");
/** Env fallback; the token can also arrive per-request from the hub URL. */
export const TOKEN = process.env.WIDGET_TOKEN || "";
/** Where the studio keeps per-customer working folders (skills read/write here). */
export const ROOT = join(homedir(), "albadi-studio");

export function u(path: string, tok: string): string {
  const sep = path.includes("?") ? "&" : "?";
  return `${CRM_BASE}${path}${sep}widget_token=${encodeURIComponent(tok || TOKEN)}`;
}

// --- spec interpretation (same rules as scripts/deal-file.ts) ---
export function handleType(finishing: string): string {
  const f = (finishing || "").toLowerCase();
  if (/no handle|ללא ידיות|die.?cut|punch/.test(f)) return "die-cut handle bag (flat, punched hole)";
  return "loop-handle tote (sewn handles + bottom gusset)";
}
export function laminated(finishing: string): boolean {
  return /laminat|מבריק|מט|lamin/i.test(finishing || "") && !/not laminat|לא/i.test(finishing || "");
}
export function colorCount(printing: string): string {
  const m = (printing || "").match(/(\d+)/);
  return m ? m[1] : "?";
}

export interface Brief {
  dealId: string | null;
  leadSid: string | null;
  quotationNo: string | null;
  customerName: string | null;
  customerPhone: string | null;
  spec: Record<string, unknown> | null;
  hasDeal: boolean;
}

export interface LeadRow {
  sid: string | null;
  name: string | null;
  phone: string | null;
  stage: string | null;
}

/** Typeahead search over leads (name/phone/sid) via the CRM. */
export async function searchLeads(q: string, tok: string): Promise<LeadRow[]> {
  const res = await fetch(u(`/api/widget/leads/recent?q=${encodeURIComponent(q)}&limit=20`, tok), { cache: "no-store" });
  const j = (await res.json()) as { ok?: boolean; leads?: LeadRow[] };
  return j.leads ?? [];
}

/** Map a dealId → its lead sid via the quotes list (no CRM change needed). */
export async function resolveLeadSid(dealId: string, tok: string): Promise<string | null> {
  try {
    const res = await fetch(u(`/api/widget/quotes/list?limit=400`, tok), { cache: "no-store" });
    const j = (await res.json()) as { rows?: { id: string; leadSid: string | null }[] };
    const row = (j.rows ?? []).find((r) => r.id === dealId);
    return row?.leadSid ?? null;
  } catch {
    return null;
  }
}

/** Pull a deal's brief (spec + customer) and resolve its lead sid. */
export async function pullDeal(dealId: string, tok: string): Promise<Brief> {
  const res = await fetch(u(`/api/widget/factory/deal/${dealId}`, tok), { cache: "no-store" });
  const j = (await res.json()) as {
    ok: boolean; error?: string;
    deal?: {
      quotationNo: string | null; customerName: string | null;
      customerPhone: string | null; productSpec: Record<string, unknown> | null;
    };
  };
  if (!res.ok || !j.ok || !j.deal) throw new Error(j.error ?? `deal ${dealId} not found (${res.status})`);
  const d = j.deal;
  const leadSid = await resolveLeadSid(dealId, tok);
  return {
    dealId, leadSid,
    quotationNo: d.quotationNo, customerName: d.customerName,
    customerPhone: d.customerPhone, spec: d.productSpec, hasDeal: true,
  };
}

/** Human brief to seed the Claude conversation with. */
export function briefText(b: Brief): string {
  const s = b.spec ?? {};
  const dims = `H${s.heightCm ?? "?"} × D${s.depthCm ?? "?"} × W${s.widthCm ?? "?"} cm`;
  const colors = colorCount(String(s.printing ?? ""));
  const handle = handleType(String(s.finishing ?? ""));
  const lam = laminated(String(s.finishing ?? "")) ? "מלאמינציה (laminated)" : "בלי למינציה (matte non-woven)";
  return [
    `לקוח: ${b.customerName ?? "—"} (${b.customerPhone ?? "—"})`,
    b.quotationNo ? `הצעה #${b.quotationNo}` : null,
    `מידות: ${dims}`,
    `צבעי הדפסה: ${colors}`,
    `ידיות: ${handle}`,
    `גימור: ${lam}`,
    s.material ? `חומר: ${s.material}` : null,
    s.quantity ? `כמות: ${s.quantity}` : null,
    s.notes ? `הערות: ${s.notes}` : null,
  ].filter(Boolean).join("\n");
}

function mimeFor(name: string): { mime: string; media: "image" | "video" } {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  if (ext === "pdf") return { mime: "application/pdf", media: "image" };
  if (["mp4", "mov", "webm"].includes(ext)) return { mime: "video/mp4", media: "video" };
  if (ext === "png") return { mime: "image/png", media: "image" };
  return { mime: "image/jpeg", media: "image" };
}

/** Upload a local file into a deal's timeline stage (mockup|invoice|layout). */
export async function pushFile(dealId: string, stage: string, filePath: string, tok: string): Promise<string> {
  const buf = await readFile(filePath);
  const name = basename(filePath);
  const { mime } = mimeFor(name);
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buf)], { type: mime }), name);
  const res = await fetch(u(`/api/widget/factory/deal-upload/${dealId}?stage=${stage}`, tok), { method: "POST", body: form });
  const j = (await res.json()) as { ok: boolean; url?: string; error?: string; message?: string };
  if (!res.ok || !j.ok) throw new Error(j.message ?? j.error ?? `upload failed (${res.status})`);
  return j.url ?? "";
}

/** Send a local file to the lead on WhatsApp via the existing CRM endpoint (GreenAPI). */
export async function sendWhatsApp(leadSid: string, filePath: string, tok: string): Promise<string> {
  const buf = await readFile(filePath);
  const name = basename(filePath);
  const { mime, media } = mimeFor(name);
  const form = new FormData();
  form.append("manychatSubId", leadSid);
  form.append("widgetToken", tok || TOKEN);
  form.append("mediaType", media);
  form.append("filename", name);
  form.append("file", new Blob([new Uint8Array(buf)], { type: mime }), name);
  const res = await fetch(`${CRM_BASE}/api/configurator/send-to-customer`, { method: "POST", body: form });
  const j = (await res.json()) as { ok: boolean; error?: string; waMessageId?: string | null };
  if (!res.ok || !j.ok) throw new Error(j.error ?? `send failed (${res.status})`);
  return j.waMessageId ?? "sent";
}

/** List files in a work dir newest-first (skills write their outputs here). */
export async function listOutputs(dir: string): Promise<{ name: string; mtime: number; size: number }[]> {
  try {
    const names = await readdir(dir);
    const out: { name: string; mtime: number; size: number }[] = [];
    for (const n of names) {
      if (n.startsWith(".")) continue;
      const st = await stat(join(dir, n)).catch(() => null);
      if (!st || !st.isFile()) continue;
      out.push({ name: n, mtime: +st.mtime, size: st.size });
    }
    return out.sort((a, b) => b.mtime - a.mtime);
  } catch {
    return [];
  }
}

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}
