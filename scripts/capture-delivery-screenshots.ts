/**
 * Capture production-quality screenshots for the client delivery PDF.
 * Run: npx tsx scripts/capture-delivery-screenshots.ts
 * Requires: local dev servers on :3000 (CRM) and optionally :8081 (website).
 */

import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { chromium, type Page } from "playwright";

dotenv.config();

const ASSETS = path.join(process.cwd(), "public/docs/assets");
const CRM = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || "http://localhost:3000";
const WEB = "http://localhost:8081";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";
const LEAD_SID = encodeURIComponent("972525551234@s.whatsapp.net");

async function waitFor3D(page: Page) {
  await page.waitForSelector('button:has-text("בד וצבע")', { timeout: 30_000 });
  await page.waitForTimeout(3500);
}

async function shot(page: Page, file: string) {
  const out = path.join(ASSETS, file);
  await page.screenshot({ path: out, type: "jpeg", quality: 82, fullPage: false });
  console.log("  ✓", file);
}

async function gotoPage(page: Page, url: string) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForTimeout(1200);
}

async function loginDashboard(page: Page) {
  if (!ADMIN_PASSWORD) {
    console.warn("  ⚠ ADMIN_PASSWORD missing — skipping dashboard shots");
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
    console.warn("  ⚠ Login failed — skipping dashboard shots");
    return false;
  }
  await gotoPage(page, `${CRM}/dashboard/v3/leads`);
  return true;
}

async function main() {
  fs.mkdirSync(ASSETS, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "he-IL",
  });
  const page = await ctx.newPage();

  console.log("[screenshots] Configurator — 3D main view");
  await gotoPage(page, `${CRM}/configurator`);
  await waitFor3D(page);
  await shot(page, "configurator-3d-main.jpg");

  console.log("[screenshots] Configurator — logo tab");
  await page.click('button:has-text("לוגו")');
  await page.waitForTimeout(1500);
  await shot(page, "configurator-logo-tab.jpg");

  console.log("[screenshots] Configurator — quote panel");
  const quoteBtn = page.getByRole("button", { name: /הצעת מחיר ו-PDF|הצעת מחיר/ }).first();
  await quoteBtn.click({ force: true });
  await page.waitForTimeout(2500);
  await shot(page, "configurator-quote-panel.jpg");

  try {
    console.log("[screenshots] Website embed (bag-quote-app)");
    await gotoPage(page, `${WEB}/configurator`);
    await page.waitForTimeout(4000);
    await shot(page, "website-embed-configurator.jpg");
  } catch {
    console.warn("  ⚠ bag-quote-app :8081 not running — skipped website embed");
  }

  const loggedIn = await loginDashboard(page);
  if (loggedIn) {
    console.log("[screenshots] CRM — leads grid");
    await gotoPage(page, `${CRM}/dashboard/v3/leads`);
    await page.waitForTimeout(2000);
    await shot(page, "crm-leads-grid.jpg");

    console.log("[screenshots] CRM — lead detail + 3D designs");
    await gotoPage(page, `${CRM}/dashboard/v3/leads?lead=${LEAD_SID}`);
    await page.waitForTimeout(2500);
    await shot(page, "crm-lead-detail.jpg");
    await shot(page, "crm-lead-3d-button.jpg");
  }

  await browser.close();
  console.log("[screenshots] Done → public/docs/assets/");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
