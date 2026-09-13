#!/usr/bin/env node
// Albadi CRM watch assistant — launchd runs this every 5 min
// (com.albadi.crm-assistant). If a 🚨 fault alert landed in Eli's WhatsApp
// thread, or he wrote something there himself, run Claude headless in the repo
// so it investigates and answers him in that thread.
//
// Eli 13/09/2026: "תבנה, אבל תמיד צריך לשאול אותי לפני שמתקנים" — so the
// allow-list below carries no Edit, no Write, no git and no state-changing
// POST. The rule is enforced by the tools, not only by PROMPT.md.
//
// Cheap when idle: the only cost of a quiet tick is one DB query — Claude is
// spawned solely when there is something to react to.
//
//   node check.mjs            normal (launchd)
//   node check.mjs --status   print state, change nothing
//   node check.mjs --dry      report what it WOULD hand Claude, spawn nothing
import { appendFileSync, existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT = join(DIR, "..", "..");
const HOME = process.env.HOME || "/Users/eli";
const CLAUDE = `${HOME}/.local/bin/claude`;
const NEONCTL = `${HOME}/.local/node/bin/neonctl`;
const STATE = join(PROJECT, ".claude", "assistant-state.json");
const CURSOR = join(PROJECT, ".claude", "assistant-cursor");
const LOCK = join(PROJECT, ".claude", "assistant.lock");
const LOG = `${HOME}/Library/Logs/albadi-crm-assistant.log`;
// Absolute, so the allow-list rule and the command the agent types are the
// same string — a mismatch here costs a silently undelivered answer.
const REPLY = join(DIR, "reply.mjs");

const log = (m) => appendFileSync(LOG, `${new Date().toISOString()}  ${m}\n`);
const ilt = (iso) =>
  new Date(iso).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

const dry = process.argv.includes("--dry");
const st = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : { attempts: 0 };
const saveState = () => writeFileSync(STATE, JSON.stringify(st, null, 2) + "\n");
if (process.argv.includes("--status")) {
  console.log(JSON.stringify({ state: st, cursor: existsSync(CURSOR) ? readFileSync(CURSOR, "utf8").trim() : null }, null, 2));
  process.exit(0);
}

// One run at a time. A lock older than 30 min is stale (Claude's own cap is 20).
if (existsSync(LOCK) && Date.now() - statSync(LOCK).mtimeMs < 30 * 60e3) {
  log("skip — previous run still active");
  process.exit(0);
}

// Secrets: DATABASE_URL is resolved at run time from neonctl (nothing sensitive
// on disk), CRON_SECRET comes from the repo .env so the agent can answer.
const neon = spawnSync(NEONCTL, ["connection-string", "--project-id", "fragrant-morning-71359670", "--org-id", "org-frosty-star-50411125"], { encoding: "utf8" });
const DATABASE_URL = (neon.stdout || "").trim();
if (!DATABASE_URL) {
  log(`neonctl gave no connection string (exit=${neon.status}) — is it still authed?`);
  process.exit(1);
}
const CRON_SECRET = (/^CRON_SECRET="?([^"\n]*)"?$/m.exec(readFileSync(join(PROJECT, ".env"), "utf8")) || [])[1] || "";
const env = { ...process.env, DATABASE_URL, CRON_SECRET, ELI_INBOX_CURSOR: CURSOR };

// What is new? The script's own cursor advances here, so a tick that finds
// nothing still moves on and the next one is not handed the same messages.
const read = spawnSync("npx", ["tsx", "scripts/eli-inbox.ts", "read", "--json"], { cwd: PROJECT, encoding: "utf8", env, maxBuffer: 20e6 });
if (read.status !== 0) {
  log(`read failed (exit=${read.status}) — ${String(read.stderr || "").trim().slice(-300)}`);
  process.exit(1);
}
let msgs;
try {
  msgs = JSON.parse(read.stdout).messages;
} catch {
  log(`read returned non-JSON — ${String(read.stdout || "").trim().slice(-300)}`);
  process.exit(1);
}

// Wake for: anything Eli wrote, or a 🚨 fault alert. NOT for a ✅ recovery or
// the daily estimator report — those are news, not work.
const worth = msgs.filter((m) => m.who === "eli" || m.alert);
if (!worth.length) {
  if (dry) console.log(`nothing to do (${msgs.length} message(s) seen, none actionable)`);
  process.exit(0);
}

const fromEli = worth.filter((m) => m.who === "eli");
const alerts = worth.filter((m) => m.alert);
const task = [
  fromEli.length ? `אלי כתב לך ${fromEli.length} הודעות חדשות בוואטסאפ.` : "",
  alerts.length ? `הגיעו ${alerts.length} התראות תקלה (🚨) לוואטסאפ שלו.` : "",
  "",
  "מה שחדש:",
  ...worth.map((m) => `[${ilt(m.at)}] ${m.who === "eli" ? "אלי" : "המערכת"}: ${m.text}`),
  "",
  `חקור, וענה לו רק דרך:  node ${REPLY} "<תשובה>"`,
  "אל תתקן כלום — תשאל אותו קודם.",
].filter(Boolean).join("\n");

// Exact allow-list. Read-only by construction: no Edit, no Write, no git, no
// deploy, and the only POST allowed is the reply itself. If a fix is needed the
// agent asks Eli and he opens a session on the Mac.
const allowed = [
  "Read",
  "Glob",
  "Grep",
  `Bash(node ${REPLY}:*)`,
  `Bash(npx tsx scripts/eli-inbox.ts read:*)`,
  "Bash(gh run list:*)",
  "Bash(gh run view:*)",
  "Bash(git log:*)",
  "Bash(git show:*)",
];

if (dry) {
  console.log(task);
  console.log("\n--- allowed tools ---\n" + allowed.join("\n"));
  process.exit(0);
}

writeFileSync(LOCK, String(process.pid));
log(`handling ${worth.length} item(s): ${fromEli.length} from Eli, ${alerts.length} alert(s)`);
const res = spawnSync(
  CLAUDE,
  ["-p", task, "--append-system-prompt-file", join(DIR, "PROMPT.md"), "--permission-mode", "dontAsk", "--allowedTools", ...allowed],
  { cwd: PROJECT, encoding: "utf8", timeout: 20 * 60e3, env, maxBuffer: 20e6 },
);
rmSync(LOCK, { force: true });
log(`claude exit=${res.status}${res.error ? " err=" + res.error.message : ""} · ${String(res.stdout || "").trim().slice(-400).replace(/\n/g, " ⏎ ")}`);

if (res.status === 0) {
  st.attempts = 0;
  saveState();
  process.exit(0);
}

// Failed: the cursor already moved, so these messages are gone from the queue.
// Retry is not possible — after two failures, say so rather than going quiet.
st.attempts = (st.attempts || 0) + 1;
if (st.attempts >= 2) {
  spawnSync(process.execPath, [REPLY, `לא הצלחתי לטפל בהתראה מ-${ilt(worth[0].at)} (פעמיים ברצף). תפתח אותי במחשב.`], { cwd: PROJECT, env });
  log("gave up after 2 attempts — told Eli");
  st.attempts = 0;
}
saveState();
process.exit(1);
