/**
 * Eli's own WhatsApp thread with the business number, as a CLI.
 *
 * WHY: the CRM already DMs Eli every system alert (`sendEliDM`) and every
 * message he writes back to the business number lands in `messages` — so the
 * thread is a two-way console that needs no new integration. This lets a
 * Claude session LISTEN to it (`read`) and answer in the same place (`say`),
 * which is where Eli actually reads things: "ורק בוואטסאפ".
 *
 *   npx tsx scripts/eli-inbox.ts read            # new since the last read
 *   npx tsx scripts/eli-inbox.ts read --since 3h # a window, cursor untouched
 *   npx tsx scripts/eli-inbox.ts read --json     # machine-readable, for check.mjs
 *   npx tsx scripts/eli-inbox.ts say "..."       # sends a real WhatsApp
 *
 * The cursor lives in .claude/ (gitignored, per-machine) and `--since` never
 * moves it, so a look-back can't make the loop skip messages. `ELI_INBOX_CURSOR`
 * points it elsewhere — the launchd assistant keeps its OWN cursor so an
 * interactive session and the background agent don't eat each other's messages.
 *
 * ⚠️ `say` RECORDS what it sent (.claude/eli-inbox-sent.json) and `read` filters
 * those back out. Without that the agent's own reply looks like a new outbound
 * message on the next tick and it answers itself, forever.
 *
 * Needs DATABASE_URL for `read` — see CLAUDE.md for the neonctl one-liner.
 * `say` needs only the bearer (it posts to prod; see below).
 */
import { sql } from "drizzle-orm";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Eli's personal WhatsApp, the target of every sendEliDM. */
const ELI_SID = process.env.ELI_INBOX_SID ?? "972525755705@s.whatsapp.net";
const CURSOR = process.env.ELI_INBOX_CURSOR ?? join(process.cwd(), ".claude", "eli-inbox-cursor");
const SENT_LOG = join(process.cwd(), ".claude", "eli-inbox-sent.json");
/** How long a sent message stays in the echo filter. */
const ECHO_WINDOW_MS = 6 * 36e5;

function readCursor(): string | null {
  try {
    return readFileSync(CURSOR, "utf8").trim() || null;
  } catch {
    return null;
  }
}

function writeCursor(iso: string): void {
  mkdirSync(dirname(CURSOR), { recursive: true });
  writeFileSync(CURSOR, iso);
}

interface SentEntry {
  at: string;
  text: string;
}

function readSent(): SentEntry[] {
  try {
    const all = JSON.parse(readFileSync(SENT_LOG, "utf8")) as SentEntry[];
    const cutoff = Date.now() - ECHO_WINDOW_MS;
    return all.filter((e) => Date.parse(e.at) > cutoff);
  } catch {
    return [];
  }
}

function recordSent(text: string): void {
  const kept = [...readSent(), { at: new Date().toISOString(), text }].slice(-50);
  mkdirSync(dirname(SENT_LOG), { recursive: true });
  writeFileSync(SENT_LOG, JSON.stringify(kept, null, 1));
}

function parseSince(arg: string | undefined): Date | null {
  if (!arg) return null;
  const m = /^(\d+)([mhd])$/.exec(arg.trim());
  if (!m) throw new Error(`--since wants 30m / 3h / 2d, got "${arg}"`);
  const mult = { m: 60e3, h: 36e5, d: 864e5 }[m[2] as "m" | "h" | "d"];
  return new Date(Date.now() - Number(m[1]) * mult);
}

interface Row {
  received_at: Date;
  direction: string;
  sender: string | null;
  text: string | null;
}

interface Msg {
  at: string;
  /** "eli" = he wrote it · "system" = the CRM said it */
  who: "eli" | "system";
  /** A 🚨 line from the watchdog — the only outbound worth waking an agent for. */
  alert: boolean;
  text: string;
}

async function read(opts: { since?: string; json: boolean }): Promise<void> {
  const explicit = parseSince(opts.since);
  // First ever run with no cursor: look back an hour, not at 1069 messages.
  const from = explicit ?? (readCursor() ? new Date(readCursor()!) : new Date(Date.now() - 36e5));
  const startedAt = new Date().toISOString();

  const { db } = await import("@/lib/db"); // lazy: `say` must work without DATABASE_URL
  const r = await db.execute(sql`
    SELECT received_at, direction, sender, text
    FROM messages
    WHERE manychat_sub_id = ${ELI_SID} AND received_at > ${from.toISOString()}
    ORDER BY received_at ASC`);
  const rows = (r.rows ?? []) as unknown as Row[];

  const sent = readSent().map((e) => e.text.trim());
  const msgs: Msg[] = rows
    .map((m) => ({
      at: new Date(m.received_at).toISOString(),
      who: (m.direction === "in" ? "eli" : "system") as Msg["who"],
      alert: m.direction !== "in" && (m.text ?? "").trimStart().startsWith("🚨"),
      text: m.text ?? "",
    }))
    // Drop our own replies, or the agent answers itself on the next tick.
    .filter((m) => !(m.who === "system" && sent.includes(m.text.trim())));

  if (opts.json) {
    console.log(JSON.stringify({ from: from.toISOString(), until: startedAt, messages: msgs }, null, 1));
  } else {
    console.log(`# since ${from.toISOString()} — ${msgs.length} message(s)`);
    for (const m of msgs) {
      console.log(`\n[${m.at.slice(0, 19).replace("T", " ")}] ${m.who === "eli" ? "אלי" : "מערכת"}:\n${m.text || "(ללא טקסט)"}`);
    }
    const fromEli = msgs.filter((m) => m.who === "eli").length;
    console.log(`\n# ${fromEli} מאלי, ${msgs.length - fromEli} מהמערכת`);
  }

  // Only a cursor read advances it, and it advances to when the query STARTED
  // so a message written mid-run is re-read rather than skipped.
  if (!explicit) writeCursor(startedAt);
}

/**
 * Sends through prod, not from here: ELI_NOTIFY_JID and the GreenAPI
 * credentials are Production-scoped and `vercel env pull` masks them to "",
 * so a local sendEliDM can only ever answer `no_jid`. CRON_SECRET is the one
 * bearer this machine can read (see CLAUDE.md).
 */
async function say(text: string): Promise<void> {
  if (!text.trim()) throw new Error("say needs text");
  const secret = process.env.CRON_SECRET ?? process.env.BOT_SECRET ?? process.env.CALL_TRIGGER_SECRET;
  if (!secret) throw new Error("say needs CRON_SECRET / BOT_SECRET / CALL_TRIGGER_SECRET in the env");
  const base = process.env.CRM_BASE ?? "https://albadi-crm.vercel.app";
  const res = await fetch(`${base}/api/admin/eli-dm`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
    body: JSON.stringify({ text }),
  });
  const out = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: string; error?: string };
  if (res.ok && out.ok) recordSent(text); // before anything can read it back as "new"
  console.log(`eli-dm [${res.status}] ${JSON.stringify(out)}`);
  if (!res.ok || !out.ok) process.exitCode = 1;
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "read") {
    const i = rest.indexOf("--since");
    await read({ since: i >= 0 ? rest[i + 1] : undefined, json: rest.includes("--json") });
  } else if (cmd === "say") {
    await say(rest.filter((a) => !a.startsWith("--")).join(" "));
  } else {
    console.log('usage: eli-inbox.ts read [--since 3h] [--json] | say "<text>"');
    process.exitCode = 2;
  }
}

main().then(() => process.exit(process.exitCode ?? 0));
