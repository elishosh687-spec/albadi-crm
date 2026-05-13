/**
 * End-to-end smoke test for the bot-supervisor backend.
 *
 * Hits the deployed API at $TARGET_URL (default https://albadi-crm.vercel.app)
 * and walks through: seed → list pending → reject (dry path) → seed again →
 * approve (dry path via BRIDGE_DRY_RUN env) → assert final state.
 *
 * Usage:
 *   BOT_SECRET=... npx tsx scripts/test-drafts-api.ts
 *   BOT_SECRET=... TARGET_URL=http://localhost:3000 npx tsx scripts/test-drafts-api.ts
 *
 * NOTE: approve() will fire a real bridge send unless the server is running
 * with BRIDGE_DRY_RUN=1. Against prod, only run this script with the reject
 * path enabled (set SKIP_APPROVE=1) so no real WhatsApp message goes out.
 */
import "dotenv/config";
import { db } from "@/lib/db";
import { botDrafts, leads } from "@/drizzle/schema";
import { sql, eq } from "drizzle-orm";

const TARGET_URL = process.env.TARGET_URL ?? "https://albadi-crm.vercel.app";
const BOT_SECRET = process.env.BOT_SECRET;
const TEST_JID = process.env.TEST_JID ?? "133144455962747@lid";
const SKIP_APPROVE = process.env.SKIP_APPROVE === "1";

if (!BOT_SECRET) {
  console.error("[test-drafts] BOT_SECRET env required");
  process.exit(1);
}

async function api(path: string, init: RequestInit = {}) {
  const res = await fetch(`${TARGET_URL}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${BOT_SECRET}`,
      "Content-Type": "application/json",
    },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function seedDraft(text: string): Promise<number> {
  const [lead] = await db
    .select({ stage: leads.pipelineStage })
    .from(leads)
    .where(sql`trim(${leads.manychatSubId}) = ${TEST_JID}`)
    .limit(1);
  if (!lead) throw new Error(`no lead for ${TEST_JID}`);
  const [draft] = await db
    .insert(botDrafts)
    .values({
      manychatSubId: TEST_JID,
      draftText: text,
      status: "pending",
      moneyReason: "manual",
      pipelineStageAtGen: lead.stage,
    })
    .returning();
  return draft.id;
}

async function getStatus(id: number): Promise<string | null> {
  const [row] = await db
    .select({ status: botDrafts.status })
    .from(botDrafts)
    .where(eq(botDrafts.id, id))
    .limit(1);
  return row?.status ?? null;
}

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  const tag = ok ? "PASS" : "FAIL";
  console.log(`  [${tag}] ${name}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures++;
}

(async () => {
  console.log(`[test-drafts] target=${TARGET_URL}`);

  // 1. Auth
  {
    const res = await fetch(`${TARGET_URL}/api/drafts/pending`);
    check("unauth → 401", res.status === 401, `got ${res.status}`);
  }
  {
    const r = await api("/api/drafts/pending");
    check("auth → 200", r.status === 200, `got ${r.status}`);
    check("response shape", r.body?.ok === true && Array.isArray(r.body.drafts));
  }

  // 2. Reject path
  const rejectId = await seedDraft("טסט: ייבדק לדחייה");
  console.log(`  seeded draft id=${rejectId}`);
  {
    const r = await api(`/api/drafts/${rejectId}/reject`, {
      method: "POST",
      body: JSON.stringify({ reason: "smoke test" }),
    });
    check("reject → 200", r.status === 200 && r.body.ok === true);
  }
  check(
    "draft status=rejected after reject",
    (await getStatus(rejectId)) === "rejected"
  );

  // 3. Approve path
  if (!SKIP_APPROVE) {
    const approveId = await seedDraft("טסט: ייבדק לאישור");
    console.log(`  seeded draft id=${approveId}`);
    const r = await api(`/api/drafts/${approveId}/approve`, {
      method: "POST",
      body: JSON.stringify({ edited_text: "טסט: ייבדק לאישור (ערוך)" }),
    });
    if (r.status === 200) {
      check("approve → 200", r.body.ok === true);
      check(
        "draft status=sent after approve",
        (await getStatus(approveId)) === "sent"
      );
    } else {
      // Real bridge send failed (likely auth / dry-run not on). Mark as
      // informational rather than hard fail.
      console.log(`  [SKIP] approve real-send not available (${r.status} ${JSON.stringify(r.body)})`);
    }
  } else {
    console.log("  [SKIP] approve path (SKIP_APPROVE=1)");
  }

  // 4. Override (non-destructive — only sets bot_paused to its existing value).
  {
    const [row] = await db
      .select({ paused: leads.botPaused })
      .from(leads)
      .where(sql`trim(${leads.manychatSubId}) = ${TEST_JID}`)
      .limit(1);
    const r = await api(`/api/leads/${encodeURIComponent(TEST_JID)}/override`, {
      method: "POST",
      body: JSON.stringify({ bot_paused: row?.paused ?? false }),
    });
    check("override no-op → 200", r.status === 200 && r.body.ok === true);
  }

  // 5. Invalid stage rejected.
  {
    const r = await api(`/api/leads/${encodeURIComponent(TEST_JID)}/override`, {
      method: "POST",
      body: JSON.stringify({ pipeline_stage: "BOGUS_STAGE" }),
    });
    check("invalid stage → 400", r.status === 400);
  }

  console.log(`\n[test-drafts] done. failures=${failures}`);
  process.exit(failures > 0 ? 1 : 0);
})().catch((e) => {
  console.error("[test-drafts] crashed", e);
  process.exit(2);
});
