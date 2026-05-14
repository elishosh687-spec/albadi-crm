/**
 * Backfill leads.phone_e164 for ManyChat-origin leads by hitting
 *   GET https://api.manychat.com/fb/subscriber/getInfo?subscriber_id=<id>
 * and reading the `whatsapp_phone` field. ManyChat subscriber ids look like
 * `1768242677` and are NOT phones — the actual WhatsApp number lives on the
 * subscriber payload.
 *
 * Coalesce semantics — never overwrites an existing value. Safe to re-run.
 * Skips bridge-origin leads (sub_id contains `@`).
 *
 * Usage:
 *   npx tsx scripts/backfill-phone-from-manychat.ts            # dry run
 *   npx tsx scripts/backfill-phone-from-manychat.ts --confirm  # apply
 */
import "dotenv/config";
import { db } from "@/lib/db";
import { leads } from "@/drizzle/schema";
import { sql } from "drizzle-orm";

const MANYCHAT_TOKEN = process.env.MANYCHAT_TOKEN;
const MANYCHAT_BASE = process.env.MANYCHAT_BASE ?? "https://api.manychat.com/fb";
const confirm = process.argv.includes("--confirm");

if (!MANYCHAT_TOKEN) {
  console.error("MANYCHAT_TOKEN is not set");
  process.exit(1);
}

interface ManychatSubscriber {
  id: string;
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  whatsapp_phone?: string | null;
  phone?: string | null;
}

async function fetchSubscriber(sid: string): Promise<ManychatSubscriber | null> {
  const url = `${MANYCHAT_BASE}/subscriber/getInfo?subscriber_id=${encodeURIComponent(sid)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${MANYCHAT_TOKEN}` },
  });
  if (!res.ok) {
    throw new Error(`ManyChat ${res.status} for ${sid}`);
  }
  const body = (await res.json()) as { status?: string; data?: ManychatSubscriber };
  if (body.status !== "success" || !body.data) return null;
  return body.data;
}

function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // Strip "+" and any non-digits.
  return raw.replace(/[^0-9]/g, "") || null;
}

(async () => {
  // ManyChat-origin leads: sub_id is numeric, not a JID (no `@`). Filter to
  // those with null phone_e164.
  const candidates = await db
    .select({
      sid: leads.manychatSubId,
      name: leads.name,
    })
    .from(leads)
    .where(
      sql`${leads.phoneE164} IS NULL AND ${leads.active} = true AND position('@' in ${leads.manychatSubId}) = 0`
    );

  console.log(`[backfill-mc-phone] ${candidates.length} leads need phone backfill`);

  let fetched = 0;
  let updated = 0;
  const errors: Array<{ sid: string; err: string }> = [];

  for (const row of candidates) {
    const cleanSid = row.sid.trim();
    try {
      const sub = await fetchSubscriber(cleanSid);
      fetched++;
      const phone = normalizePhone(sub?.whatsapp_phone ?? sub?.phone);
      if (!phone) {
        console.log(`  ${cleanSid.padEnd(14)}  ${(row.name ?? "").padEnd(20)}  no whatsapp_phone`);
        continue;
      }
      console.log(`  ${cleanSid.padEnd(14)}  ${(row.name ?? "").padEnd(20)}  +${phone}`);
      updated++;
      if (confirm) {
        await db
          .update(leads)
          .set({
            phoneE164: sql`coalesce(${leads.phoneE164}, ${phone})`,
            updatedAt: new Date(),
          })
          .where(sql`trim(${leads.manychatSubId}) = ${cleanSid}`);
      }
      // ManyChat rate-limit: ~50 req/min. Sleep 1.3s between requests.
      await new Promise((r) => setTimeout(r, 1300));
    } catch (e) {
      errors.push({
        sid: cleanSid,
        err: e instanceof Error ? e.message : String(e),
      });
    }
  }

  console.log(`\n[backfill-mc-phone] fetched=${fetched}  updated=${updated}`);
  if (errors.length) {
    console.log("\nERRORS:");
    for (const e of errors) console.log(`  ${e.sid}  ${e.err}`);
  }
  if (!confirm) {
    console.log("\nRe-run with --confirm to apply.");
  }
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
