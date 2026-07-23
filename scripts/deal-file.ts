/**
 * Deal-file local bridge — the "קישור מהמערכת שרץ מקומי" for mockups & dielines.
 *
 * Generation stays LOCAL (the bag-mockup-video + dieline-print Claude Code
 * skills are better on Eli's Mac: his ChatGPT/Gemini subscriptions, the real
 * reference photos, interactive tweaking). This script is the two-way bridge:
 *
 *   pull  <dealId>                 → fetch the deal's spec+customer from the CRM,
 *                                    download any product photo, and print a
 *                                    ready-to-run brief for the mockup/dieline
 *                                    skill (fills in dims/colors/handles/lam).
 *   push  <dealId> <stage> <file>  → upload the finished image/PDF/video back to
 *                                    the deal timeline (stage = mockup|invoice|
 *                                    layout). It lands in the deal file and
 *                                    mirrors to GHL automatically.
 *
 * Config (env):
 *   CRM_BASE      default https://albadi-crm.vercel.app  (use http://localhost:3100 for dev)
 *   WIDGET_TOKEN  the GHL_WIDGET_TOKEN value (needed for auth)
 *
 * Examples:
 *   WIDGET_TOKEN=… npx tsx scripts/deal-file.ts pull fq_1783433410934_krs2bhr8
 *   WIDGET_TOKEN=… npx tsx scripts/deal-file.ts push fq_1783433410934_krs2bhr8 mockup ~/Downloads/bag.png
 */

import { readFile } from "node:fs/promises";
import { basename } from "node:path";

const CRM_BASE = (process.env.CRM_BASE || "https://albadi-crm.vercel.app").replace(/\/$/, "");
const TOKEN = process.env.WIDGET_TOKEN || "";
const WORK_DIR = `${process.env.HOME}/albadi-deal-files`;

function u(path: string): string {
  const sep = path.includes("?") ? "&" : "?";
  return `${CRM_BASE}${path}${sep}widget_token=${encodeURIComponent(TOKEN)}`;
}

function die(msg: string): never {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

// --- interpret the spec into skill-ready fields ---
function handleType(finishing: string): string {
  const f = (finishing || "").toLowerCase();
  if (/no handle|ללא ידיות|die.?cut|punch/.test(f)) return "die-cut handle bag (flat, punched hole)";
  return "loop-handle tote (sewn handles + bottom gusset)";
}
function laminated(finishing: string): boolean {
  return /laminat|מבריק|מט|lamin/i.test(finishing || "") && !/not laminat|לא/i.test(finishing || "");
}
function colorCount(printing: string): string {
  const m = (printing || "").match(/(\d+)/);
  return m ? m[1] : "?";
}

async function pull(dealId: string) {
  const res = await fetch(u(`/api/widget/factory/deal/${dealId}`), { cache: "no-store" });
  const j = (await res.json()) as {
    ok: boolean; error?: string;
    deal?: {
      quotationNo: string | null;
      customerName: string | null;
      customerPhone: string | null;
      productSpec: Record<string, unknown> | null;
      dealMilestones: Record<string, unknown> | null;
    };
  };
  if (!res.ok || !j.ok || !j.deal) die(`pull failed: ${j.error ?? res.status}`);
  const d = j.deal;
  const s = d.productSpec ?? {};
  const dims = `H${s.heightCm ?? "?"} × D${s.depthCm ?? "?"} × W${s.widthCm ?? "?"} cm`;
  const colors = colorCount(String(s.printing ?? ""));
  const handle = handleType(String(s.finishing ?? ""));
  const lam = laminated(String(s.finishing ?? "")) ? "מבריק/מט (laminated)" : "לא ממבריק (matte non-woven)";

  // download the product photo if the CRM has one
  const picUrl = typeof s.picUrl === "string" ? s.picUrl : null;
  let picNote = "אין תמונת מוצר במערכת — ספק לוגו מקומית.";
  if (picUrl) {
    try {
      const { mkdir, writeFile } = await import("node:fs/promises");
      await mkdir(WORK_DIR, { recursive: true });
      const bin = new Uint8Array(await (await fetch(picUrl)).arrayBuffer());
      const ext = picUrl.split(".").pop()?.split("?")[0]?.slice(0, 5) || "jpg";
      const path = `${WORK_DIR}/${dealId}-product.${ext}`;
      await writeFile(path, bin);
      picNote = `תמונת מוצר נשמרה: ${path}`;
    } catch {
      picNote = `תמונת מוצר קיימת אך לא הורדה: ${picUrl}`;
    }
  }

  console.log(`
╔══════════════════════════════════════════════════════════════╗
  תיק עסקה #${d.quotationNo ?? dealId} — ${d.customerName ?? "לקוח"}
╚══════════════════════════════════════════════════════════════╝

  לקוח:      ${d.customerName ?? "—"}  (${d.customerPhone ?? "—"})
  מידות:     ${dims}
  צבעי הדפסה: ${colors}
  ידיות:     ${handle}
  גימור:     ${lam}
  חומר:      ${s.material ?? "—"}  ·  כמות: ${s.quantity ?? "—"}
  ${s.notes ? `הערות:     ${s.notes}` : ""}
  ${picNote}

─── בריף להדמיה (bag-mockup-video skill) — הדבק ל-Claude Code המקומי ─────
  צור הדמיה של שקית אלבד:
    • סוג: ${handle}
    • מידות: ${dims}
    • צבעי לוגו: ${colors}  ·  ${lam}
    • לוגו: <צרף את קובץ הלוגו של הלקוח>
    • צבע גוף השקית: <בחר/אשר צבע>
  אחרי שהתמונה מאושרת:
    npx tsx scripts/deal-file.ts push ${dealId} mockup <output.png>

─── בריף לפריסה (dieline-print skill) ───────────────────────────────────
  הכן קובץ הפקה: פריסת המפעל + הלוגו של הלקוח, ${colors} צבעים,
  ${laminated(String(s.finishing ?? "")) ? "מלאמינציה" : "בלי למינציה"}.
  אחרי שהקובץ מוכן:
    npx tsx scripts/deal-file.ts push ${dealId} layout <הפקה.pdf>
────────────────────────────────────────────────────────────────────────
`);
}

async function push(dealId: string, stage: string, filePath: string) {
  if (!["mockup", "invoice", "layout"].includes(stage)) {
    die(`stage חייב להיות mockup | invoice | layout (קיבלתי "${stage}")`);
  }
  const buf = await readFile(filePath).catch(() => die(`לא נמצא קובץ: ${filePath}`));
  const name = basename(filePath);
  const ext = name.split(".").pop()?.toLowerCase() || "";
  const mime =
    ext === "pdf" ? "application/pdf" :
    ["mp4", "mov"].includes(ext) ? "video/mp4" :
    ext === "png" ? "image/png" : "image/jpeg";

  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buf)], { type: mime }), name);

  const res = await fetch(u(`/api/widget/factory/deal-upload/${dealId}?stage=${stage}`), {
    method: "POST",
    body: form,
  });
  const j = (await res.json()) as { ok: boolean; url?: string; error?: string; message?: string };
  if (!res.ok || !j.ok) die(`push failed: ${j.message ?? j.error ?? res.status}`);
  console.log(`\n✓ הועלה לשלב "${stage}" בתיק העסקה + שוקף ל-GHL:\n  ${j.url}\n`);
}

async function main() {
  if (!TOKEN) die("חסר WIDGET_TOKEN (משתנה סביבה). קבל אותו מ-Vercel env GHL_WIDGET_TOKEN.");
  const [cmd, dealId, ...rest] = process.argv.slice(2);
  if (cmd === "pull" && dealId) return pull(dealId);
  if (cmd === "push" && dealId && rest.length === 2) return push(dealId, rest[0], rest[1]);
  console.log(`שימוש:
  npx tsx scripts/deal-file.ts pull <dealId>
  npx tsx scripts/deal-file.ts push <dealId> <mockup|invoice|layout> <file>

(CRM_BASE=${CRM_BASE})`);
  process.exit(1);
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));
