#!/usr/bin/env node
// The assistant's ONLY way to speak to Eli.
//
// Why a wrapper and not `npx tsx scripts/eli-inbox.ts say "..."` directly: a
// permission allow-list matches the command prefix, and the first attempt was
// written as `CRON_SECRET=... npx tsx ...` — the env-var prefix means the
// string no longer starts with `npx`, so the rule did not match and the reply
// was silently refused. The agent diagnosed the fault perfectly and Eli heard
// nothing (13/09/2026). One short, absolute, unambiguous command removes the
// whole class of problem — the same reason the MaxBaby assistant has reply.mjs.
//
//   node scripts/assistant/reply.mjs "<text>"
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const PROJECT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const text = process.argv.slice(2).join(" ").trim();
if (!text) {
  console.error('usage: reply.mjs "<text>"');
  process.exit(2);
}

// check.mjs puts CRON_SECRET in the env; read .env too so a hand-run works.
const env = { ...process.env };
if (!env.CRON_SECRET) {
  try {
    env.CRON_SECRET = (/^CRON_SECRET="?([^"\n]*)"?$/m.exec(readFileSync(join(PROJECT, ".env"), "utf8")) || [])[1] || "";
  } catch {
    /* leave unset — eli-inbox.ts will say what is missing */
  }
}

const r = spawnSync("npx", ["tsx", "scripts/eli-inbox.ts", "say", text], { cwd: PROJECT, encoding: "utf8", env, maxBuffer: 10e6 });
process.stdout.write(r.stdout || "");
process.stderr.write(r.stderr || "");
process.exit(r.status ?? 1);
