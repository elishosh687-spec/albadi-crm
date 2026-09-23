/**
 * website-import stores the Google click + UTM in their own columns
 * (migration 0005, 2026-09-23) — new lead, and blanks-only on an existing one.
 *
 * The branch is copied from production, which may not have 0005/0006 yet; the
 * migrations are idempotent, so this file applies them first.
 *
 * GHL and WhatsApp are mocked: nothing leaves the test.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ciPhone, purgeSid, sql } from "./_db";

vi.mock("@/integrations/ghl/sync", () => ({ syncLeadToGHL: vi.fn(async () => undefined) }));
vi.mock("@/lib/bridge/client", () => ({ sendBridgeMessage: vi.fn(async () => undefined) }));

const SECRET = "ci-website-import-secret";
const PHONE = ciPhone(7305);
const SID = `${PHONE}@s.whatsapp.net`;
const GCLID = "Cj0KCQjwCI-first-click";

// Every leads migration the schema knows about: drizzle's INSERT names every
// column in drizzle/schema.ts, so ONE missing column fails every lead insert.
async function applyMigration() {
  for (const f of ["0005_google_click_attribution.sql", "0006_google_click_campaign.sql", "0007_google_conversions.sql"]) {
    const file = readFileSync(join(process.cwd(), "drizzle/migrations", f), "utf8");
    for (const stmt of file.split("--> statement-breakpoint")) {
      const body = stmt.replace(/^\s*--.*$/gm, "").trim();
      if (body) await sql(body);
    }
  }
}

async function post(body: Record<string, unknown>) {
  const { POST } = await import("@/app/api/leads/website-import/route");
  const res = await POST(
    new NextRequest(new URL("http://localhost/api/leads/website-import"), {
      method: "POST",
      headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json" },
      body: JSON.stringify({ phone: PHONE, fullName: "CI Google", ...body }),
    }),
    undefined as never,
  );
  return { status: res.status, json: (await res.json()) as any };
}

const row = async () =>
  (await sql(
    `SELECT lead_source, google_gclid, google_gbraid, utm_source, utm_campaign, utm_term, utm_content, landing_url, notes
     FROM leads WHERE manychat_sub_id = $1`,
    [SID],
  ))[0] as Record<string, string | null>;

beforeAll(async () => {
  process.env.WEBSITE_IMPORT_SECRET = SECRET;
  process.env.WEBSITE_IMPORT_SEND_OPENING = "0";
  await applyMigration();
  await purgeSid(SID);
});
afterAll(async () => {
  await purgeSid(SID);
});

describe("website-import → Google columns", () => {
  it("a new lead from a Google click keeps gclid + UTM in columns (and still in notes)", async () => {
    const r = await post({
      gclid: GCLID,
      utmSource: "google",
      utmMedium: "cpc",
      utmCampaign: "albadi-search-nonbrand",
      utmTerm: "שקיות אלבד",
      utmContent: "187654321",
      landingUrl: `https://albadisael.com/calculator?gclid=${GCLID}`,
    });
    expect(r.status).toBe(200);
    expect(r.json.status).toBe("created");
    const l = await row();
    expect(l.lead_source).toBe("google");
    expect(l.google_gclid).toBe(GCLID);
    expect(l.utm_campaign).toBe("albadi-search-nonbrand");
    expect(l.utm_term).toBe("שקיות אלבד");
    expect(l.utm_content).toBe("187654321");
    expect(l.landing_url).toContain("albadisael.com/calculator");
    expect(l.notes).toContain(`gclid: ${GCLID}`);
  });

  it("a second form fill never overwrites the first click, but fills what was empty", async () => {
    const r = await post({ gclid: "Cj0KCQjwCI-second-click", gbraid: "0AAAAAgbraid-second", utmTerm: "other term" });
    expect(r.json.status).toBe("tagged_only");
    const l = await row();
    expect(l.google_gclid).toBe(GCLID);
    expect(l.utm_term).toBe("שקיות אלבד");
    expect(l.google_gbraid).toBe("0AAAAAgbraid-second");
  });
});
