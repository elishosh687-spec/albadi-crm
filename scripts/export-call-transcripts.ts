/**
 * Export every call transcript + its analysis to readable files on disk.
 *
 * The transcripts only ever lived in the database (`call_recording_imports`
 * for GHL calls, `elevenlabs_call_imports` for the voice agent), which is fine
 * for the CRM and useless for reading a customer's history yourself or feeding
 * it to something else. This writes them out.
 *
 *   npx tsx scripts/export-call-transcripts.ts              # a file per CUSTOMER
 *   npx tsx scripts/export-call-transcripts.ts --by call    # a file per CALL
 *   npx tsx scripts/export-call-transcripts.ts --out <dir>  # default below
 *   npx tsx scripts/export-call-transcripts.ts --dry        # count, write nothing
 *
 * Per customer is the one to read: every call in order, oldest first, with the
 * analysis above each transcript so the verdict is visible without reading the
 * call. Per call is the one to feed a machine.
 *
 * ⚠️ THIS IS REAL CUSTOMER CONVERSATION DATA. It writes OUTSIDE the repo by
 * default (`content/albadi/call-transcripts/`, alongside the customer folders)
 * — never into a git working tree, and never anywhere it could be published.
 *
 * Needs DATABASE_URL — see CLAUDE.md for the neonctl one-liner.
 */
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_OUT = "/Users/eli/Projects/content/albadi/call-transcripts";

interface CallRow {
  source: "ghl" | "elevenlabs";
  sid: string | null;
  name: string | null;
  phone: string | null;
  started: Date | null;
  durationSec: number | null;
  transcript: string;
  analysis: Record<string, unknown> | null;
  summary: string | null;
}

/** Safe, readable file name: keeps Hebrew, drops anything a path dislikes. */
function slug(s: string): string {
  return (s || "")
    .replace(/[/\\:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60) || "ללא-שם";
}

const ilDate = (d: Date | null): string =>
  d ? new Date(d).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "תאריך לא ידוע";

const mmss = (sec: number | null): string =>
  sec == null ? "" : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

/** The analysis is a flat jsonb of known keys — render the ones worth reading. */
const ANALYSIS_LABELS: [string, string][] = [
  ["call_summary", "סיכום"],
  ["sentiment", "טון"],
  ["follow_up_urgency", "דחיפות"],
  ["customer_needs", "צרכים"],
  ["buying_signals", "סימני קנייה"],
  ["objections", "התנגדויות"],
  ["price_discussion", "מחיר"],
  ["competitor_mentions", "מתחרים"],
  ["red_flags", "דגלים אדומים"],
  ["next_steps", "צעדים הבאים"],
  ["callback_reason", "סיבת חזרה"],
  ["callback_at", "מועד חזרה"],
];

function renderAnalysis(a: Record<string, unknown> | null, fallback: string | null): string {
  if (!a) return fallback ? `**סיכום:** ${fallback}` : "_(אין ניתוח)_";
  const lines: string[] = [];
  for (const [key, label] of ANALYSIS_LABELS) {
    const v = a[key];
    // The analyser writes the literal string "null"/"none" for an empty field,
    // which rendered as `**מתחרים:** null` — noise in every other call.
    const empty = (x: unknown) => x == null || x === "" || (typeof x === "string" && /^(null|none|n\/a|לא רלוונטי)$/i.test(x.trim()));
    if (empty(v) || (Array.isArray(v) && !v.length)) continue;
    // Objections come as {text, quote} — the verbatim quote is the valuable
    // half, so render it as a quote instead of dumping JSON.
    const one = (x: unknown): string => {
      if (typeof x === "string") return x;
      if (x && typeof x === "object") {
        const o = x as Record<string, unknown>;
        const body = [o.text, o.label, o.name].find((y) => typeof y === "string") as string | undefined;
        const quote = typeof o.quote === "string" ? o.quote : undefined;
        if (body) return quote ? `${body} — "${quote}"` : body;
        if (quote) return `"${quote}"`;
      }
      return JSON.stringify(x);
    };
    const items = (Array.isArray(v) ? v : [v]).map(one).filter((x) => !empty(x));
    if (!items.length) continue;
    lines.push(`- **${label}:** ${items.join(" · ")}`);
  }
  return lines.length ? lines.join("\n") : "_(ניתוח ריק)_";
}

function renderCall(c: CallRow, n?: number): string {
  const head = `## ${n != null ? `שיחה ${n} — ` : ""}${ilDate(c.started)}${c.durationSec ? ` · ${mmss(c.durationSec)} דק׳` : ""}${c.source === "elevenlabs" ? " · סוכן קולי" : ""}`;
  return [head, "", renderAnalysis(c.analysis, c.summary), "", "### תמלול", "", c.transcript.trim(), ""].join("\n");
}

async function load(): Promise<CallRow[]> {
  const ghl = await db.execute(sql`
    SELECT l.manychat_sub_id AS sid, l.name, l.phone_e164 AS phone,
           c.call_started_at AS started, c.call_duration_sec AS dur,
           c.transcript, c.analysis
    FROM call_recording_imports c
    LEFT JOIN leads l ON l.ghl_contact_id = c.ghl_contact_id
    WHERE c.transcript IS NOT NULL AND length(trim(c.transcript)) > 0
    ORDER BY c.call_started_at ASC`);
  const el = await db.execute(sql`
    SELECT l.manychat_sub_id AS sid, l.name, e.phone,
           e.call_started_at AS started, e.call_duration_sec AS dur,
           e.transcript, e.analysis, e.eleven_summary AS summary
    FROM elevenlabs_call_imports e
    LEFT JOIN leads l ON l.ghl_contact_id = e.ghl_contact_id
    WHERE e.transcript IS NOT NULL AND length(trim(e.transcript)) > 0
    ORDER BY e.call_started_at ASC`);

  const map = (rows: unknown[], source: CallRow["source"]): CallRow[] =>
    (rows as Record<string, never>[]).map((r) => ({
      source,
      sid: r.sid ?? null,
      name: r.name ?? null,
      phone: r.phone ?? null,
      started: r.started ?? null,
      durationSec: r.dur ?? null,
      transcript: r.transcript ?? "",
      analysis: r.analysis ?? null,
      summary: r.summary ?? null,
    }));

  return [...map(ghl.rows ?? [], "ghl"), ...map(el.rows ?? [], "elevenlabs")].sort(
    (a, b) => (a.started?.valueOf() ?? 0) - (b.started?.valueOf() ?? 0),
  );
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const byCall = argv.includes("--by") && argv[argv.indexOf("--by") + 1] === "call";
  const dry = argv.includes("--dry");
  const i = argv.indexOf("--out");
  const out = i >= 0 ? argv[i + 1] : DEFAULT_OUT;

  const calls = await load();
  // A call with no lead still has a transcript worth keeping — bucket it by
  // phone, and by "לא משויך" only when there is nothing at all to key on.
  const groups = new Map<string, CallRow[]>();
  for (const c of calls) {
    const key = c.sid ?? c.phone ?? "לא-משויך";
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(c);
  }

  console.log(`${calls.length} תמלולים · ${groups.size} לקוחות · יעד: ${out}${dry ? "  (יבש — לא נכתב כלום)" : ""}`);
  if (dry) {
    const top = [...groups.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 5);
    for (const [key, cs] of top) console.log(`  ${cs.length.toString().padStart(3)} שיחות · ${cs[0].name ?? key}`);
    return;
  }

  rmSync(out, { recursive: true, force: true }); // a stale file is worse than none
  mkdirSync(out, { recursive: true });

  const index: string[] = ["# תמלולי שיחות", "", `נוצר ${ilDate(new Date())} · ${calls.length} שיחות · ${groups.size} לקוחות`, ""];

  if (byCall) {
    mkdirSync(join(out, "calls"), { recursive: true });
    calls.forEach((c, n) => {
      const stamp = (c.started ? new Date(c.started).toISOString().slice(0, 16) : "no-date").replace(/[:T]/g, "-");
      writeFileSync(join(out, "calls", `${stamp}_${slug(c.name ?? c.phone ?? "unknown")}_${n}.md`), renderCall(c));
    });
    index.push(`קובץ לכל שיחה, ב-\`calls/\`.`);
  } else {
    const used = new Set<string>();
    for (const [key, cs] of groups) {
      const name = cs.find((c) => c.name)?.name ?? key;
      const body = [
        `# ${name}`,
        "",
        `${cs.length} שיחות · ${ilDate(cs[0].started)} → ${ilDate(cs[cs.length - 1].started)}`,
        cs[0].phone ? `טלפון: ${cs[0].phone}` : "",
        "",
        "---",
        "",
        ...cs.map((c, n) => renderCall(c, n + 1)),
      ]
        .filter((l) => l !== "")
        .join("\n");
      // Two customers can share a name — without the key suffix one silently
      // overwrote the other (285 groups produced 282 files on the first run).
      const base = slug(name);
      const file = used.has(base) ? `${base} (${slug(key).slice(-6)})` : base;
      used.add(base);
      writeFileSync(join(out, `${file}.md`), body + "\n");
    }
  }

  for (const [key, cs] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const name = cs.find((c) => c.name)?.name ?? key;
    index.push(`- **${name}** — ${cs.length} שיחות (${ilDate(cs[0].started).slice(0, 10)} → ${ilDate(cs[cs.length - 1].started).slice(0, 10)})`);
  }
  writeFileSync(join(out, "index.md"), index.join("\n") + "\n");
  console.log(`נכתב. התחל מ-${join(out, "index.md")}`);
}

main().then(() => process.exit(0));
