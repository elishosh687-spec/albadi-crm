/**
 * Dry-run for the call-recording pipeline. Runs against the LIVE prod DB +
 * GHL but does NOT post the note back — instead prints the formatted body
 * that WOULD be posted, so you can eyeball it before flipping the cron.
 *
 * Usage:
 *   # Use the most recent call discovered by stage 1 polling:
 *   DATABASE_URL="$(neonctl connection-string ...)" npx tsx scripts/_test-call-pipeline.ts
 *
 *   # Pin to a specific GHL message id:
 *   DATABASE_URL=... GHL_MESSAGE_ID=<id> npx tsx scripts/_test-call-pipeline.ts
 */
import {
  downloadRecording,
  searchCallMessages,
  type GHLCallMessage,
} from "../integrations/ghl/client";
import { transcribeAudio } from "../lib/transcription/whisper";
import { analyzeCall } from "../lib/autoresponder/call-analysis";
import { db } from "../lib/db";
import { ghlOauthTokens } from "../drizzle/schema";
import { desc } from "drizzle-orm";

// Local-only convenience: if the env var is missing (because Vercel's
// encrypted-at-rest secrets come back empty in `vercel env pull`), hydrate
// from the ghl_oauth_tokens table — same pattern as scripts/check-ping-landed.ts
async function hydrateGhlEnvFromDb() {
  if (process.env.GHL_LOCATION_ID && process.env.GHL_API_KEY) return;
  const tok = await db
    .select({
      locationId: ghlOauthTokens.locationId,
      accessToken: ghlOauthTokens.accessToken,
    })
    .from(ghlOauthTokens)
    .orderBy(desc(ghlOauthTokens.updatedAt))
    .limit(1);
  if (!tok[0]) {
    throw new Error("No ghl_oauth_tokens row in DB to hydrate env from.");
  }
  if (!process.env.GHL_LOCATION_ID) process.env.GHL_LOCATION_ID = tok[0].locationId;
  if (!process.env.GHL_API_KEY) process.env.GHL_API_KEY = tok[0].accessToken;
  console.log(`(env hydrated from ghl_oauth_tokens: location=${tok[0].locationId})`);
}

async function main() {
  await hydrateGhlEnvFromDb();
  if (!process.env.OPENAI_API_KEY) {
    console.log("⚠️  OPENAI_API_KEY missing — will exit after stage 1.");
  }

  const explicit = process.env.GHL_MESSAGE_ID;

  let target: GHLCallMessage | null = null;

  if (explicit) {
    console.log(`Targeting GHL message id from env: ${explicit}`);
    target = {
      id: explicit,
      conversationId: "",
      contactId: process.env.GHL_CONTACT_ID,
    } as GHLCallMessage;
  } else {
    console.log("No GHL_MESSAGE_ID set — searching for recent calls…");
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const calls = await searchCallMessages({ startAfterDate: since, limit: 20 });
    const completed = calls.filter(
      (c) =>
        !c.meta?.call?.status || c.meta.call.status === "completed",
    );
    console.log(`  found ${calls.length} calls in last 7 days, ${completed.length} completed`);
    if (completed.length === 0) {
      console.log("Nothing to test against. Make a call in GHL first, then re-run.");
      return;
    }
    target = completed[0];
    console.log(`  picked: id=${target.id} contact=${target.contactId} dur=${target.meta?.call?.duration}s`);
  }

  console.log(`\n=== Stage: download ===`);
  const { audio, contentType } = await downloadRecording(target.id);
  console.log(`  ${audio.byteLength} bytes  content-type=${contentType}`);
  if (audio.byteLength > 25 * 1024 * 1024) {
    console.log(`  ⚠️  > 25MB — Whisper will reject. Phase B needs ffmpeg downcompression.`);
    return;
  }

  if (!process.env.OPENAI_API_KEY) {
    console.log("\n⏭️  Skipping transcribe/analyze (no OPENAI_API_KEY in env).");
    console.log("    Stage 1 (GHL search + recording download) verified ✅");
    return;
  }

  console.log(`\n=== Stage: transcribe ===`);
  const t0 = Date.now();
  const transcript = await transcribeAudio(audio, { contentType, filename: `call-${target.id}.mp3` });
  console.log(`  ${Date.now() - t0}ms  ${transcript.length} chars`);
  console.log(`  preview: ${transcript.slice(0, 200).replace(/\s+/g, " ")}…`);

  console.log(`\n=== Stage: analyze ===`);
  const callStartedAt = target.dateAdded ? new Date(target.dateAdded) : null;
  console.log(`  call-start anchor: ${callStartedAt?.toISOString() ?? "(unknown → now)"}`);
  const t1 = Date.now();
  const analysis = await analyzeCall(transcript, { callStartedAt });
  console.log(`  ${Date.now() - t1}ms`);
  if (!analysis) {
    console.error("  ❌ analyzeCall returned null");
    return;
  }
  console.log(JSON.stringify(analysis, null, 2));

  console.log(`\n=== Stage: callback task (DRY — not creating) ===`);
  if (!analysis.callback_at) {
    console.log("  (no callback_at extracted → no task would be created)");
  } else {
    const { clampToWorkWindow } = await import("../lib/clock/callback-window");
    const due = await clampToWorkWindow(new Date(analysis.callback_at));
    const reason = (analysis.callback_reason ?? "").trim();
    const dueLocal = due.toLocaleString("he-IL", {
      timeZone: "Asia/Jerusalem",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    console.log(`  callback_at (raw):     ${analysis.callback_at}`);
    console.log(`  callback_reason:       ${reason || "—"}`);
    console.log(`  clamped due (ISO):     ${due.toISOString()}`);
    console.log(`  clamped due (Israel):  ${dueLocal}`);
    console.log(
      `  task title:            ${reason ? `📞 חזרה ללקוח: ${reason.slice(0, 60)}` : "📞 חזרה ללקוח"}`,
    );
    console.log(`  assignedTo:            ${process.env.GHL_SALESPERSON_USER_ID || "(unset)"}`);
  }

  console.log(`\n=== Stage: format note (DRY — not posting) ===`);
  // Hand-inline the formatter to avoid importing the cron handler.
  const lines = [
    `[CALL-ANALYSIS v1] msg=${target.id}`,
    `📞 שיחה: ${target.dateAdded ?? "—"} · ${target.meta?.call?.duration ?? "—"}s`,
    ``,
    `🧭 סיכום: ${analysis.call_summary || "—"}`,
    ``,
    `🎯 צרכי לקוח:`,
    analysis.customer_needs.length ? analysis.customer_needs.map((x) => `• ${x}`).join("\n") : "—",
    ``,
    `⚠️ התנגדויות:`,
    analysis.objections.length
      ? analysis.objections.map((o) => `• ${o.text}${o.quote ? `  ("${o.quote}")` : ""}`).join("\n")
      : "—",
    ``,
    `💰 מחיר: ${analysis.price_discussion ?? "—"}`,
    ``,
    `➡️ צעדים הבאים:`,
    analysis.next_steps.length ? analysis.next_steps.map((x) => `• ${x}`).join("\n") : "—",
    ``,
    `רגש: ${analysis.sentiment}  ·  דחיפות מעקב: ${analysis.follow_up_urgency}`,
  ];
  console.log(lines.join("\n"));

  console.log(`\n✅ Dry-run OK. Note above is what would land on contact ${target.contactId}.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
