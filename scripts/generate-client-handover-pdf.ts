/**
 * Renders CLIENT-HANDOVER.html → CLIENT-HANDOVER.pdf (Paper & Ink, Mermaid, A4).
 * Run: npx tsx scripts/generate-client-handover-pdf.ts
 */

import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { chromium } from "playwright";

const HTML = path.join(process.cwd(), "public/docs/CLIENT-HANDOVER.html");
const PDF = path.join(process.cwd(), "public/docs/CLIENT-HANDOVER.pdf");

async function waitForMermaid(page: import("playwright").Page) {
  await page
    .waitForFunction(
      () => {
        const blocks = document.querySelectorAll(".mermaid");
        if (blocks.length === 0) return true;
        const ready = document.body.dataset.mermaidReady === "true";
        const svgs = document.querySelectorAll(".mermaid svg");
        return ready && svgs.length >= blocks.length;
      },
      { timeout: 90_000 }
    )
    .catch(() => {
      console.warn("  ⚠ Mermaid render timeout — PDF may miss diagrams");
    });
  await page.waitForTimeout(800);
}

async function main() {
  if (!fs.existsSync(HTML)) {
    console.error("Missing", HTML);
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(pathToFileURL(HTML).href, { waitUntil: "networkidle", timeout: 120_000 });

  console.log("[pdf] Waiting for Mermaid diagrams…");
  await waitForMermaid(page);

  const diagramCount = await page.locator(".mermaid svg").count();
  console.log(`[pdf] Rendered ${diagramCount} diagram(s)`);

  await page.pdf({
    path: PDF,
    format: "A4",
    printBackground: true,
    preferCSSPageSize: true,
    margin: { top: "14mm", right: "16mm", bottom: "18mm", left: "16mm" },
    displayHeaderFooter: true,
    headerTemplate: "<div></div>",
    footerTemplate: `
      <div style="width:100%;font-size:7.5px;color:#736b62;font-family:Heebo,sans-serif;
        padding:0 16mm;display:flex;justify-content:space-between;align-items:center;">
        <span>Albadi Platform Handover · June 2026 · Confidential</span>
        <span>Page <span class="pageNumber"></span> / <span class="totalPages"></span></span>
      </div>`,
  });

  await browser.close();
  console.log("Wrote", PDF);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
