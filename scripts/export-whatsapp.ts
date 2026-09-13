/**
 * Export every WhatsApp conversation to readable files on disk.
 *
 * The sibling of `export-call-transcripts.ts`, same shape and same warning:
 * the messages live only in the `messages` table, which serves the CRM and
 * serves nobody who wants to read a customer's history or feed it elsewhere.
 *
 *   npx tsx scripts/export-whatsapp.ts                 # a file per customer
 *   npx tsx scripts/export-whatsapp.ts --with-calls    # + call transcripts, interleaved
 *   npx tsx scripts/export-whatsapp.ts --include-eli   # + Eli's own alert thread
 *   npx tsx scripts/export-whatsapp.ts --out <dir> | --dry
 *
 * `--with-calls` is the one worth running: WhatsApp and phone calls in ONE
 * chronological timeline is the actual story of a customer — a quote sent on
 * WhatsApp, the call where he pushed back on it, the silence after.
 *
 * Each file opens with the lead's latest analyst verdict when there is one
 * (root cause, blocker, recommended next action), so the conclusion is visible
 * before the evidence.
 *
 * ⚠️ REAL CUSTOMER CONVERSATIONS. Writes OUTSIDE the repo by default — never
 * into a git working tree.
 *
 * Needs DATABASE_URL — see CLAUDE.md for the neonctl one-liner.
 */
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_OUT = "/Users/eli/Projects/content/albadi/whatsapp";
/** Eli's own thread with the business number — system alerts, not a customer. */
const ELI_SID = "972525755705@s.whatsapp.net";

interface Entry {
  at: Date;
  kind: "msg" | "call";
  who: string;
  body: string;
}

interface Lead {
  sid: string;
  name: string | null;
  phone: string | null;
  stage: string | null;
  source: string | null;
  verdict: Record<string, unknown> | null;
}

function slug(s: string): string {
  return (s || "").replace(/[/\\:*?"<>|]/g, "-").replace(/\s+/g, " ").trim().slice(0, 60) || "ללא-שם";
}

const ilDate = (d: Date | null): string =>
  d ? new Date(d).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

const SENDER = { lead: "👤 לקוח", bot: "🤖 בוט", eli: "🧑 אלי" } as const;

/**
 * A poll vote is stored as the raw GreenAPI payload, so the customer's actual
 * answer ("1,000 יחידות") rendered as a wall of JSON. Rare — 1 in 11,256 — but
 * it is an ANSWER to the questionnaire, which is the content that matters most.
 */
function readable(text: string): string {
  if (!text.startsWith("{")) return text;
  try {
    const o = JSON.parse(text) as { selected_options?: unknown };
    if (Array.isArray(o.selected_options) && o.selected_options.length) {
      return `☑️ ${o.selected_options.join(" · ")}`;
    }
  } catch {
    /* not JSON after all — show it as it was written */
  }
  return text;
}

/** The verdict's readable half. The rest (grounding, sample) is machinery. */
function renderVerdict(v: Record<string, unknown> | null): string[] {
  if (!v) return [];
  const out: string[] = ["## ניתוח", ""];
  const push = (label: string, val: unknown) => {
    if (val == null || val === "" || (Array.isArray(val) && !val.length)) return;
    const text = Array.isArray(val)
      ? val.map((x) => (typeof x === "string" ? x : ((x as Record<string, string>).text ?? JSON.stringify(x)))).join(" · ")
      : typeof val === "object"
        ? String((val as Record<string, unknown>).evidence ?? JSON.stringify(val))
        : String(val);
    out.push(`- **${label}:** ${text}`);
  };
  push("שורש התקיעה", v.root_cause);
  push("חסם עיקרי", v.primary_blocker);
  push("רמת ודאות", v.confidence);
  push("התנגדויות", v.objections);
  push("סימני כוונה", v.intent_signals);
  push("פעולה מומלצת", v.recommended_next_action);
  if (v.insufficient_data === true) out.push("- _(הניתוח סומן כחסר נתונים)_");
  out.push("");
  return out.length > 3 ? out : [];
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const withCalls = argv.includes("--with-calls");
  const includeEli = argv.includes("--include-eli");
  const dry = argv.includes("--dry");
  const i = argv.indexOf("--out");
  const out = i >= 0 ? argv[i + 1] : DEFAULT_OUT;

  // One row per lead that has any message, with its newest verdict.
  const leadRows = (
    await db.execute(sql`
      SELECT l.manychat_sub_id AS sid, l.name, l.phone_e164 AS phone,
             l.pipeline_stage AS stage, l.lead_source AS source,
             (SELECT a.verdict FROM lead_analyses a
               WHERE a.manychat_sub_id = l.manychat_sub_id
               ORDER BY a.created_at DESC LIMIT 1) AS verdict
      FROM leads l`)
  ).rows as unknown as Lead[];
  const leads = new Map(leadRows.map((l) => [l.sid, l]));

  const msgs = (
    await db.execute(sql`
      SELECT manychat_sub_id AS sid, received_at AS at, sender, direction, text
      FROM messages ORDER BY received_at ASC`)
  ).rows as unknown as { sid: string; at: Date; sender: string | null; direction: string; text: string | null }[];

  const byLead = new Map<string, Entry[]>();
  const add = (sid: string, e: Entry) => (byLead.get(sid) ?? byLead.set(sid, []).get(sid)!).push(e);

  for (const m of msgs) {
    if (!includeEli && m.sid === ELI_SID) continue;
    const who = SENDER[(m.sender ?? "") as keyof typeof SENDER] ?? (m.direction === "in" ? SENDER.lead : SENDER.bot);
    add(m.sid, { at: m.at, kind: "msg", who, body: readable((m.text ?? "").trim()) || "_(מדיה או הודעה ללא טקסט)_" });
  }

  let callCount = 0;
  if (withCalls) {
    const calls = (
      await db.execute(sql`
        SELECT l.manychat_sub_id AS sid, c.call_started_at AS at,
               c.call_duration_sec AS dur, c.transcript,
               c.analysis ->> 'call_summary' AS summary
        FROM call_recording_imports c
        JOIN leads l ON l.ghl_contact_id = c.ghl_contact_id
        WHERE c.transcript IS NOT NULL AND length(trim(c.transcript)) > 0
        ORDER BY c.call_started_at ASC`)
    ).rows as unknown as { sid: string; at: Date; dur: number | null; transcript: string; summary: string | null }[];
    for (const c of calls) {
      if (!includeEli && c.sid === ELI_SID) continue;
      const mins = c.dur ? ` (${Math.floor(c.dur / 60)}:${String(c.dur % 60).padStart(2, "0")} דק׳)` : "";
      add(c.sid, {
        at: c.at,
        kind: "call",
        who: `📞 שיחת טלפון${mins}`,
        body: (c.summary ? `_${c.summary}_\n\n` : "") + c.transcript.trim(),
      });
      callCount++;
    }
  }

  for (const list of byLead.values()) list.sort((a, b) => a.at.valueOf() - b.at.valueOf());

  console.log(
    `${msgs.length} הודעות${withCalls ? ` + ${callCount} שיחות` : ""} · ${byLead.size} לקוחות · יעד: ${out}${dry ? "  (יבש)" : ""}`,
  );
  if (dry) {
    for (const [sid, es] of [...byLead.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 5)) {
      console.log(`  ${String(es.length).padStart(4)} · ${leads.get(sid)?.name ?? sid}`);
    }
    return;
  }

  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  const index: string[] = [
    "# שיחות וואטסאפ" + (withCalls ? " + שיחות טלפון" : ""),
    "",
    `נוצר ${ilDate(new Date())} · ${byLead.size} לקוחות · ${msgs.length} הודעות${withCalls ? ` · ${callCount} שיחות טלפון` : ""}`,
    "",
  ];

  const used = new Set<string>();
  for (const [sid, entries] of byLead) {
    const l = leads.get(sid);
    const name = l?.name ?? sid;
    const fromLead = entries.filter((e) => e.who === SENDER.lead).length;
    const body = [
      `# ${name}`,
      "",
      [
        l?.phone ? `טלפון: ${l.phone}` : "",
        l?.stage ? `שלב: ${l.stage}` : "",
        l?.source ? `מקור: ${l.source}` : "",
      ].filter(Boolean).join(" · "),
      "",
      `${entries.length} רשומות · ${fromLead} מהלקוח · ${ilDate(entries[0].at)} → ${ilDate(entries[entries.length - 1].at)}`,
      "",
      ...renderVerdict(l?.verdict ?? null),
      "## ציר הזמן",
      "",
      ...entries.map((e) =>
        e.kind === "call"
          ? `### ${e.who} — ${ilDate(e.at)}\n\n${e.body}\n`
          : `**[${ilDate(e.at)}] ${e.who}:**\n${e.body}\n`,
      ),
    ].filter((x) => x !== "").join("\n");

    const base = slug(name);
    const file = used.has(base) ? `${base} (${slug(sid).slice(-6)})` : base;
    used.add(base);
    writeFileSync(join(out, `${file}.md`), body + "\n");
  }

  for (const [sid, es] of [...byLead.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const l = leads.get(sid);
    index.push(
      `- **${l?.name ?? sid}** — ${es.length} רשומות${l?.stage ? ` · ${l.stage}` : ""} (${ilDate(es[0].at).slice(0, 10)} → ${ilDate(es[es.length - 1].at).slice(0, 10)})`,
    );
  }
  writeFileSync(join(out, "index.md"), index.join("\n") + "\n");
  console.log(`נכתב. התחל מ-${join(out, "index.md")}`);
}

main().then(() => process.exit(0));
