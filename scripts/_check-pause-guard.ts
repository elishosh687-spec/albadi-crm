import { ghlPauseChange, GHL_IRREVOCABLE_REASONS } from "@/lib/autoresponder/bot-pause";

const cases: [boolean, string | null, "refuse" | "pause" | "resume"][] = [
  [false, "opt_out", "refuse"],
  [false, "human_handoff", "refuse"],
  [false, "no_reply", "resume"],
  [false, "legacy", "resume"],
  [false, "escalation", "resume"],
  [false, null, "resume"],
  [true, "opt_out", "pause"],
  [true, null, "pause"],
];
let bad = 0;
for (const [paused, reason, want] of cases) {
  const r = ghlPauseChange(paused, reason);
  const got = r === null ? "refuse" : r.botPaused ? "pause" : "resume";
  const ok = got === want;
  if (!ok) bad++;
  const cleared = r && !r.botPaused ? ` reasonCleared=${r.botPauseReason === null}` : "";
  console.log(`${ok ? "ok  " : "FAIL"}  ghl says ${paused ? "pause " : "resume"} · reason=${reason ?? "-"} → ${got}${cleared}`);
}
console.log(`\nirrevocable: ${[...GHL_IRREVOCABLE_REASONS].join(", ")}`);
console.log(bad === 0 ? "ALL PASS" : `${bad} FAILED`);
process.exit(bad === 0 ? 0 : 1);
