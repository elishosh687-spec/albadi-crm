/**
 * Advanced implementation delivery PDF (English, developer handoff).
 * Run: npx tsx scripts/capture-delivery-screenshots.ts   (optional, refreshes images)
 *      npx tsx scripts/generate-client-delivery-pdf-en.ts
 */

import fs from "fs";
import path from "path";
import { jsPDF } from "jspdf";

const OUT = path.join(process.cwd(), "public/docs/CLIENT-DELIVERY-EN.pdf");
const FONT_REG = path.join(process.cwd(), "public/fonts/Heebo-Regular.ttf");
const FONT_BOLD = path.join(process.cwd(), "public/fonts/Heebo-Bold.ttf");
const ASSETS = path.join(process.cwd(), "public/docs/assets");

type FontDoc = jsPDF & {
  addFileToVFS: (name: string, data: string) => void;
  addFont: (postScriptName: string, id: string, style: string) => void;
};

interface Figure {
  file: string;
  caption: string;
  height?: number;
  format?: "JPEG" | "PNG";
}

const FIGURES: Figure[] = [
  {
    file: "configurator-3d-main.jpg",
    format: "JPEG",
    caption:
      "Figure 1 — Public 3D configurator. Real-time GLB bag preview, 44 fabric colors, orbit/zoom controls.",
    height: 58,
  },
  {
    file: "configurator-logo-tab.jpg",
    format: "JPEG",
    caption:
      "Figure 2 — Logo tab. PNG/JPG/SVG upload with scale, position, and rotation on the 3D decal.",
    height: 58,
  },
  {
    file: "configurator-quote-panel.jpg",
    format: "JPEG",
    caption:
      "Figure 3 — Quote drawer. Factory ILS pricing, customer contact fields, PDF download (triggers CRM lead upsert).",
    height: 58,
  },
  {
    file: "website-embed-configurator.jpg",
    format: "JPEG",
    caption:
      "Figure 4 — bag-quote-app embed. Customer website iframes the CRM-hosted configurator (single engine, no duplicate logic).",
    height: 52,
  },
  {
    file: "crm-leads-grid.jpg",
    format: "JPEG",
    caption:
      "Figure 5 — CRM leads index. Website visitors appear after PDF submit; green “3D Designer” badge marks website_configurator source.",
    height: 52,
  },
  {
    file: "crm-lead-detail.jpg",
    format: "JPEG",
    caption:
      "Figure 6 — Lead detail card. Overview, chat, bot decisions, saved 3D designs, and operator actions.",
    height: 52,
  },
  {
    file: "crm-lead-3d-button.jpg",
    format: "JPEG",
    caption:
      "Figure 7 — WhatsApp outbound. Operator sends personalized 3D Designer CTA with signed session token (?t=).",
    height: 52,
  },
];

function toBase64(file: string) {
  return fs.readFileSync(file).toString("base64");
}

function main() {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const fontDoc = doc as FontDoc;
  fontDoc.addFileToVFS("Heebo-Regular.ttf", toBase64(FONT_REG));
  fontDoc.addFileToVFS("Heebo-Bold.ttf", toBase64(FONT_BOLD));
  fontDoc.addFont("Heebo-Regular.ttf", "Heebo", "normal");
  fontDoc.addFont("Heebo-Bold.ttf", "Heebo", "bold");

  const margin = 14;
  const pageW = 210;
  const maxW = pageW - margin * 2;
  let y = margin;
  let pageNum = 1;

  const footer = () => {
    doc.setFont("Heebo", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(140, 132, 120);
    doc.text(`Albadi 3D Configurator · Delivery Report · Page ${pageNum}`, margin, 292);
    doc.text("June 2026 · Confidential", pageW - margin, 292, { align: "right" });
  };

  const newPage = () => {
    footer();
    doc.addPage();
    pageNum += 1;
    y = margin;
  };

  const need = (h: number) => {
    if (y + h > 278) newPage();
  };

  const title = (t: string) => {
    need(14);
    doc.setFont("Heebo", "bold");
    doc.setFontSize(13);
    doc.setTextColor(156, 66, 33);
    doc.text(t, margin, y);
    y += 9;
  };

  const sub = (t: string) => {
    need(10);
    doc.setFont("Heebo", "bold");
    doc.setFontSize(10);
    doc.setTextColor(80, 72, 64);
    doc.text(t, margin, y);
    y += 7;
  };

  const para = (t: string) => {
    doc.setFont("Heebo", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(50, 46, 42);
    for (const line of doc.splitTextToSize(t, maxW) as string[]) {
      need(5.5);
      doc.text(line, margin, y);
      y += 5;
    }
    y += 2;
  };

  const bullet = (t: string) => {
    doc.setFont("Heebo", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(50, 46, 42);
    for (const line of doc.splitTextToSize(`• ${t}`, maxW - 4) as string[]) {
      need(5.5);
      doc.text(line, margin + 2, y);
      y += 5;
    }
  };

  const addImage = (
    file: string,
    caption: string,
    imgH = 52,
    format: "JPEG" | "PNG" = "JPEG"
  ) => {
    const full = path.join(ASSETS, file);
    const altPng = path.join(ASSETS, file.replace(/\.jpe?g$/i, ".png"));
    const resolved = fs.existsSync(full) ? full : fs.existsSync(altPng) ? altPng : null;
    if (!resolved) {
      para(`[Screenshot pending: ${file}]`);
      return;
    }
    const fmt = resolved.endsWith(".png") ? "PNG" : format;
    const mime = fmt === "PNG" ? "image/png" : "image/jpeg";
    need(imgH + 14);
    doc.addImage(`data:${mime};base64,${toBase64(resolved)}`, fmt, margin, y, maxW, imgH);
    y += imgH + 3;
    doc.setFont("Heebo", "normal");
    doc.setFontSize(8);
    doc.setTextColor(95, 88, 80);
    for (const line of doc.splitTextToSize(caption, maxW) as string[]) {
      need(5);
      doc.text(line, margin, y);
      y += 4;
    }
    y += 5;
  };

  const table = (headers: string[], rows: string[][], colWidths: number[]) => {
    const rowH = 7;
    const tableW = colWidths.reduce((a, b) => a + b, 0);
    need(rowH * (rows.length + 1) + 4);

    let x = margin;
    doc.setFillColor(240, 233, 220);
    doc.rect(margin, y - 4, tableW, rowH, "F");
    doc.setFont("Heebo", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(60, 52, 44);
    headers.forEach((h, i) => {
      doc.text(h, x + 2, y);
      x += colWidths[i];
    });
    y += rowH;

    doc.setFont("Heebo", "normal");
    doc.setFontSize(8);
    for (const row of rows) {
      need(rowH);
      x = margin;
      row.forEach((cell, i) => {
        const lines = doc.splitTextToSize(cell, colWidths[i] - 4) as string[];
        doc.text(lines[0] ?? "", x + 2, y);
        x += colWidths[i];
      });
      doc.setDrawColor(226, 219, 208);
      doc.line(margin, y + 2, margin + tableW, y + 2);
      y += rowH;
    }
    y += 4;
  };

  // ── Cover ─────────────────────────────────────────────────────────────
  doc.setFillColor(247, 244, 239);
  doc.rect(0, 0, pageW, 297, "F");
  doc.setFillColor(156, 66, 33);
  doc.rect(0, 0, pageW, 6, "F");

  doc.setFont("Heebo", "bold");
  doc.setFontSize(22);
  doc.setTextColor(156, 66, 33);
  doc.text("3D Non-Woven Bag Configurator", margin, 52);
  doc.setFontSize(16);
  doc.setTextColor(50, 46, 42);
  doc.text("Implementation Delivery Report", margin, 64);

  doc.setFont("Heebo", "normal");
  doc.setFontSize(10);
  doc.setTextColor(90, 82, 74);
  doc.text("Albadi CRM + Customer Website  ·  June 2026", margin, 78);

  doc.setFillColor(232, 245, 233);
  doc.roundedRect(margin, 88, 42, 10, 2, 2, "F");
  doc.setFont("Heebo", "bold");
  doc.setFontSize(9);
  doc.setTextColor(45, 106, 79);
  doc.text("SHIPPED", margin + 8, 95);

  para(
    "End-to-end delivery: interactive 3D bag designer, factory pricing engine, PDF export with mockup, automatic CRM lead capture from anonymous website sessions, and WhatsApp outbound from the operations dashboard."
  );

  sub("Repositories");
  bullet("albadi-crm — configurator UI, pricing API, CRM integration, dashboard");
  bullet("bag-quote-app — customer website; /configurator iframes the CRM engine");

  sub("Prepared for");
  para("Client technical review and sign-off. All screenshots captured from local staging build.");

  newPage();

  // ── 1. Executive summary ───────────────────────────────────────────────
  title("1. Executive summary");
  para(
    "The project replaces a static/video-based bag preview with a full interactive 3D configurator integrated into both the public website and the CRM. Customers design bags (color + logo + quantity), receive real ILS factory pricing, and download a branded PDF. Operators send personalized WhatsApp links and see completed designs on each lead record."
  );

  title("2. Feature matrix");
  table(
    ["Deliverable", "Status", "Where"],
    [
      ["44 fabric colors, live 3D material", "Shipped", "/configurator"],
      ["Logo upload (PNG/JPG/SVG) + 3D decal", "Shipped", "Logo tab"],
      ["GLB model — orbit, zoom, snapshot", "Shipped", "Three.js viewer"],
      ["Factory pricing (ILS)", "Shipped", "GET /api/configurator/quote"],
      ["PDF with 3D mockup + pricing", "Shipped", "Quote drawer"],
      ["Website iframe embed", "Shipped", "bag-quote-app /configurator"],
      ["CRM WhatsApp CTA (3D Designer)", "Shipped", "Lead overview / chat"],
      ["Session links (?t=token)", "Shipped", "configurator_sessions"],
      ["Design history on lead", "Shipped", "configurator_designs table"],
      ["Anonymous visitor → CRM lead", "Shipped", "POST /api/configurator/designs"],
      ["Israeli phone normalization", "Shipped", "lib/phone/israel.ts"],
    ],
    [72, 22, 76]
  );

  title("3. Architecture");
  para("Single engine pattern: bag-quote-app embeds albadi-crm /configurator. All pricing and persistence APIs live on the CRM deploy.");
  bullet("Website visitor completes PDF → POST /api/configurator/designs → upsert lead by phone → store design row");
  bullet("CRM operator clicks 3D Designer → create session token → sendBridgeMessage CTA URL");
  bullet("Lead matching: E.164 972… normalization + last-9-digit fuzzy match prevents duplicates");

  sub("Data flow");
  para(
    "bag-quote-app (iframe) → albadi-crm /configurator → /api/configurator/quote + /api/configurator/designs → leads + configurator_designs → /dashboard/v3/leads"
  );

  newPage();

  // ── 4. Screenshots ─────────────────────────────────────────────────────
  title("4. Product screenshots");
  para("Captured from local staging (localhost:3000 CRM, localhost:8081 website embed).");
  for (const fig of FIGURES) {
    addImage(fig.file, fig.caption, fig.height ?? 52, fig.format ?? "JPEG");
  }

  newPage();

  title("5. Website visitor flow");
  bullet("Open /configurator (direct or via bag-quote-app iframe)");
  bullet("Select fabric color from 44 swatches → 3D bag updates in real time");
  bullet("Upload logo → adjust scale/position on 3D model");
  bullet("Open Quote tab → choose product size, quantity, shipping → live ILS price");
  bullet("Enter name, email, phone → Download PDF");
  bullet("Backend: upsert lead (leadSource=website_configurator, stage=INTAKE), save design");

  title("6. CRM operator flow");
  bullet("Sign in at /login (ADMIN_PASSWORD env var)");
  bullet("Leads → filter ALL → search by phone or name");
  bullet("Open lead card → Overview → 3D designs panel shows saved configs");
  bullet("Send 3D Designer via WhatsApp → customer opens ?t= session link");
  bullet("Customer completes design → record updates in place (no duplicate lead)");

  title("7. API reference");
  table(
    ["Endpoint", "Method", "Purpose"],
    [
      ["/api/configurator/quote", "GET", "Factory ILS pricing by product/qty/shipping"],
      ["/api/configurator/designs", "POST", "Save design + upsert CRM lead"],
      ["/api/configurator/session/:token", "GET", "Prefill contact from CRM session"],
      ["/configurator?t=…", "GET", "Personalized customer entry point"],
    ],
    [58, 18, 94]
  );

  title("8. Deployment URLs");
  bullet("Production CRM: https://albadi-crm.vercel.app");
  bullet("Configurator: /configurator");
  bullet("Dashboard: /dashboard/v3/leads");
  bullet("Website embed target: https://albadi.ecobrotherss.com/configurator");
  bullet("Env: CONFIGURATOR_PUBLIC_URL, NEXT_PUBLIC_CONFIGURATOR_API_URL");

  title("9. Local development");
  bullet("albadi-crm: npm run dev → localhost:3000");
  bullet("bag-quote-app: npx expo start --web → localhost:8081");
  bullet("Seed test lead: POST /api/configurator/designs with customerPhone + source=website");
  bullet("Refresh screenshots: npx tsx scripts/capture-delivery-screenshots.ts");

  title("10. Sign-off");
  para(
    "All integration points specified in the project brief are implemented and verified in staging. Interactive 3D replaces the originally discussed video approach. Remaining ops task: point albadi.ecobrotherss.com/configurator DNS to the deployed CRM build and set production env vars."
  );
  para("Contact the development team for deployment assistance or training on the CRM 3D Designer workflow.");

  footer();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, Buffer.from(doc.output("arraybuffer")));
  console.log("Wrote", OUT);
}

main();
