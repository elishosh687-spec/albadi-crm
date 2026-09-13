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
 *   npx tsx scripts/eli-inbox.ts say "..."       # sends a real WhatsApp
 *
 * The cursor lives in .claude/ (gitignored, per-machine). `--since` never
 * moves it, so a look-back can't make the loop skip messages.
 *
 * Needs DATABASE_URL — see CLAUDE.md for the neonctl one-liner. `say` also
 * needs the GreenAPI credentials, so it only works with a full prod env.
 */
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Eli's personal WhatsApp, the target of every sendEliDM. */
const ELI_SID = process.env.ELI_INBOX_SID ?? "972525755705@s.whatsapp.net";
const CURSOR = join(process.cwd(), ".claude", "eli-inbox-cursor");

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

async function read(sinceArg: string | undefined): Promise<void> {
  const explicit = parseSince(sinceArg);
  // First ever run with no cursor: look back an hour, not at 1069 messages.
  const from = explicit ?? (readCursor() ? new Date(readCursor()!) : new Date(Date.now() - 36e5));
  const startedAt = new Date().toISOString();

  const r = await db.execute(sql`
    SELECT received_at, direction, sender, text
    FROM messages
    WHERE manychat_sub_id = ${ELI_SID} AND received_at > ${from.toISOString()}
    ORDER BY received_at ASC`);
  const rows = (r.rows ?? []) as unknown as Row[];

  console.log(`# since ${from.toISOString()} — ${rows.length} message(s)`);
  for (const m of rows) {
    // "אלי" is what HE wrote to us; everything else is the system talking.
    const who = m.direction === "in" ? "אלי" : "מערכת";
    console.log(`\n[${String(m.received_at).slice(0, 19)}] ${who}:\n${m.text ?? "(ללא טקסט)"}`);
  }
  const fromEli = rows.filter((m) => m.direction === "in").length;
  console.log(`\n# ${fromEli} מאלי, ${rows.length - fromEli} מהמערכת`);

  // Only a cursor read advances it, and it advances to when the query STARTED
  // so a message written mid-run is re-read rather than skipped.
  if (!explicit) writeCursor(startedAt);
}

async function say(text: string): Promise<void> {
  if (!text.trim()) throw new Error("say needs text");
  const { sendEliDM } = await import("@/lib/notify/eli");
  const res = await sendEliDM(text);
  console.log(`sendEliDM -> ${res}`);
  if (res !== "sent" && res !== "dry_run") process.exitCode = 1;
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "read") {
    const i = rest.indexOf("--since");
    await read(i >= 0 ? rest[i + 1] : undefined);
  } else if (cmd === "say") {
    await say(rest.join(" "));
  } else {
    console.log("usage: eli-inbox.ts read [--since 3h] | say \"<text>\"");
    process.exitCode = 2;
  }
}

main().then(() => process.exit(process.exitCode ?? 0));
