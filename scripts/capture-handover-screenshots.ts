/**
 * Fresh screenshots for CLIENT-HANDOVER (English PDF).
 * Run: npx tsx scripts/capture-handover-screenshots.ts
 * Requires: CRM on :3000 (or set NEXT_PUBLIC_SITE_URL). ADMIN_PASSWORD for dashboard shots.
 */

import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { chromium, type Page } from "playwright";

dotenv.config();

const ASSETS = path.join(process.cwd(), "public/docs/assets");
const CRM = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || "http://localhost:3000";
const WEB = process.env.HANDOVER_WEB_URL || "http://localhost:8081";
const WEB_FALLBACK = "https://albadi.ecobrotherss.com/configurator";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";
const LEAD_SID = encodeURIComponent("972525551234@s.whatsapp.net");

/** Ordered list — filenames match CLIENT-HANDOVER.html */
export const HANDOVER_SHOTS = [
  "handover-01-configurator-color.jpg",
  "handover-02-configurator-logo.jpg",
  "handover-03-configurator-quote.jpg",
  "handover-04-website-embed.jpg",
  "handover-05-crm-command-center.jpg",
  "handover-06-crm-leads.jpg",
  "handover-07-crm-lead-detail.jpg",
  "handover-08-crm-conversations.jpg",
  "handover-09-crm-pipeline.jpg",
  "handover-10-crm-drafts.jpg",
  "handover-11-crm-factory.jpg",
  "handover-12-crm-analytics.jpg",
  "handover-13-crm-calculator.jpg",
  "handover-14-crm-settings.jpg",
  "handover-15-lead-3d-designer.jpg",
] as const;

function wipeHandoverAssets() {
  fs.mkdirSync(ASSETS, { recursive: true });
  for (const name of fs.readdirSync(ASSETS)) {
    if (name.startsWith("handover-")) {
      fs.unlinkSync(path.join(ASSETS, name));
    }
  }
}

async function waitForConfigurator(page: Page) {
  await page.waitForSelector('[data-dock-tab="color"], button:has-text("בד וצבע")', {
    timeout: 45_000,
  });
  await page.waitForTimeout(4000);
}

async function shot(page: Page, file: string) {
  await page.screenshot({
    path: path.join(ASSETS, file),
    type: "jpeg",
    quality: 88,
    fullPage: false,
  });
  console.log("  ✓", file);
}

async function gotoPage(page: Page, url: string) {
  await page.goto(url, { waitUntil: "load", timeout: 60_000 });
  if (page.url().startsWith("chrome-error:")) {
    throw new Error(`Navigation failed: ${url}`);
  }
  await page.waitForTimeout(1200);
}

async function captureEmbedShot(page: Page): Promise<boolean> {
  const targets = [`${WEB}/configurator`, WEB_FALLBACK];
  for (const url of targets) {
    try {
      console.log("[handover] 04 — Website embed from", url);
      await page.goto(url, { waitUntil: "load", timeout: 45_000 });
      await page.waitForTimeout(5000);
      if (page.url().includes("configurator") && !page.url().startsWith("chrome-error:")) {
        await shot(page, HANDOVER_SHOTS[3]);
        return true;
      }
    } catch {
      if (page.url().includes("configurator") && !page.url().startsWith("chrome-error:")) {
        await page.waitForTimeout(2000);
        await shot(page, HANDOVER_SHOTS[3]);
        return true;
      }
      console.warn("  ⚠ embed failed for", url);
    }
  }
  console.warn("  ⚠ Using CRM configurator as embed fallback");
  await page.goto(`${CRM}/configurator`, { waitUntil: "load", timeout: 45_000 });
  await waitForConfigurator(page);
  await shot(page, HANDOVER_SHOTS[3]);
  return true;
}

async function loginDashboard(page: Page) {
  if (!ADMIN_PASSWORD) {
    console.warn("  ⚠ ADMIN_PASSWORD missing — skipping CRM dashboard shots");
    return false;
  }
  await gotoPage(page, `${CRM}/login`);
  await page.fill('input[type="password"]', ADMIN_PASSWORD);
  const [loginRes] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/api/auth/login") && r.request().method() === "POST"
    ),
    page.click('button[type="submit"]'),
  ]);
  if (!loginRes.ok()) {
    console.warn("  ⚠ Login failed — skipping CRM dashboard shots");
    return false;
  }
  await page.waitForTimeout(800);
  return true;
}

async function main() {
  wipeHandoverAssets();
  console.log("[handover] Capturing from", CRM);

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "he-IL",
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();

  console.log("[handover] 01 — Configurator color tab");
  await gotoPage(page, `${CRM}/configurator`);
  await waitForConfigurator(page);
  await shot(page, HANDOVER_SHOTS[0]);

  console.log("[handover] 02 — Configurator logo tab");
  const logoTab = page.locator('[data-dock-tab="logo"]').first();
  if (await logoTab.count()) {
    await logoTab.click();
  } else {
    await page.click('button:has-text("לוגו")');
  }
  await page.waitForTimeout(2000);
  await shot(page, HANDOVER_SHOTS[1]);

  console.log("[handover] 03 — Configurator quote drawer");
  const quoteBtn = page.getByRole("button", { name: /Quote|הצעת מחיר/i }).first();
  await quoteBtn.click({ force: true });
  await page.waitForTimeout(2800);
  await shot(page, HANDOVER_SHOTS[2]);

  await captureEmbedShot(page);

  const loggedIn = await loginDashboard(page);
  if (loggedIn) {
    try {
      console.log("[handover] 05 — Command center");
      await gotoPage(page, `${CRM}/dashboard/v3`);
      await page.waitForTimeout(3000);
      await shot(page, HANDOVER_SHOTS[4]);

      console.log("[handover] 06 — Leads grid");
      await gotoPage(page, `${CRM}/dashboard/v3/leads`);
      await page.waitForTimeout(2500);
      await shot(page, HANDOVER_SHOTS[5]);

      console.log("[handover] 07 — Lead detail");
      await gotoPage(page, `${CRM}/dashboard/v3/leads?lead=${LEAD_SID}`);
      await page.waitForTimeout(3000);
      await shot(page, HANDOVER_SHOTS[6]);

      console.log("[handover] 08 — Conversations");
      await gotoPage(page, `${CRM}/dashboard/v3/conversations`);
      await page.waitForTimeout(3000);
      await shot(page, HANDOVER_SHOTS[7]);

      console.log("[handover] 09 — Pipeline");
      await gotoPage(page, `${CRM}/dashboard/v3/pipeline`);
      await page.waitForTimeout(3000);
      await shot(page, HANDOVER_SHOTS[8]);

      console.log("[handover] 10 — Drafts");
      await gotoPage(page, `${CRM}/dashboard/v3/drafts`);
      await page.waitForTimeout(3000);
      await shot(page, HANDOVER_SHOTS[9]);

      console.log("[handover] 11 — Factory quotes");
      await gotoPage(page, `${CRM}/dashboard/v3/factory`);
      await page.waitForTimeout(3000);
      await shot(page, HANDOVER_SHOTS[10]);

      console.log("[handover] 12 — Analytics");
      await gotoPage(page, `${CRM}/dashboard/v3/analytics`);
      await page.waitForTimeout(3000);
      await shot(page, HANDOVER_SHOTS[11]);

      console.log("[handover] 13 — Calculator");
      await gotoPage(page, `${CRM}/dashboard/v3/calculator`);
      await page.waitForTimeout(3000);
      await shot(page, HANDOVER_SHOTS[12]);

      console.log("[handover] 14 — Settings");
      await gotoPage(page, `${CRM}/dashboard/v3/settings`);
      await page.waitForTimeout(3000);
      await shot(page, HANDOVER_SHOTS[13]);

      console.log("[handover] 15 — Send 3D Designer on lead");
      await gotoPage(page, `${CRM}/dashboard/v3/leads?lead=${LEAD_SID}`);
      await page.waitForTimeout(2500);
      const send3d = page.getByRole("button", { name: /3D|מעצב/i }).first();
      if (await send3d.count()) {
        await send3d.scrollIntoViewIfNeeded();
        await page.waitForTimeout(600);
      }
      await shot(page, HANDOVER_SHOTS[14]);
    } catch (err) {
      console.warn("  ⚠ CRM dashboard shots failed:", err instanceof Error ? err.message : err);
    }
  }

  await browser.close();
  const captured = HANDOVER_SHOTS.filter((f) => fs.existsSync(path.join(ASSETS, f)));
  console.log(`[handover] Done — ${captured.length}/${HANDOVER_SHOTS.length} images → public/docs/assets/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
