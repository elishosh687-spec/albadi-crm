/**
 * Implementation delivery PDF (English, developer handoff tone).
 * Run: npx tsx scripts/generate-client-delivery-pdf-en.ts
 */

import fs from "fs";
import path from "path";
import { jsPDF } from "jspdf";

const OUT = path.join(process.cwd(), "public/docs/CLIENT-DELIVERY-EN.pdf");
const FONT_REG = path.join(process.cwd(), "public/fonts/Heebo-Regular.ttf");
const FONT_BOLD = path.join(process.cwd(), "public/fonts/Heebo-Bold.ttf");
const IMG_LEADS = path.join(process.cwd(), "public/docs/assets/crm-leads-grid.png");
const IMG_LEAD = path.join(process.cwd(), "public/docs/assets/crm-lead-3d-button.png");

type FontDoc = jsPDF & {
  addFileToVFS: (name: string, data: string) => void;
  addFont: (postScriptName: string, id: string, style: string) => void;
};

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

  const margin = 16;
  const pageW = 210;
  const maxW = pageW - margin * 2;
  let y = margin;

  const newPage = () => {
    doc.addPage();
    y = margin;
  };
  const need = (h: number) => {
    if (y + h > 285) newPage();
  };

  const title = (t: string) => {
    need(12);
    doc.setFont("Heebo", "bold");
    doc.setFontSize(14);
    doc.setTextColor(156, 66, 33);
    doc.text(t, margin, y);
    y += 8;
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
    for (const line of doc.splitTextToSize(`• ${t}`, maxW - 4) as string[]) {
      need(5.5);
      doc.text(line, margin + 2, y);
      y += 5;
    }
  };

  const addImage = (file: string, caption: string) => {
    if (!fs.existsSync(file)) return;
    const imgH = 52;
    need(imgH + 12);
    doc.addImage(
      `data:image/png;base64,${toBase64(file)}`,
      "PNG",
      margin,
      y,
      maxW,
      imgH
    );
    y += imgH + 3;
    doc.setFont("Heebo", "normal");
    doc.setFontSize(8);
    doc.setTextColor(115, 107, 98);
    for (const line of doc.splitTextToSize(caption, maxW) as string[]) {
      need(5);
      doc.text(line, margin, y);
      y += 4;
    }
    y += 4;
  };

  doc.setFillColor(240, 233, 220);
  doc.rect(0, 0, pageW, 297, "F");
  doc.setFont("Heebo", "bold");
  doc.setFontSize(20);
  doc.setTextColor(156, 66, 33);
  doc.text("3D Bag Configurator", margin, 48);
  doc.text("Implementation Delivery Report", margin, 58);
  doc.setFont("Heebo", "normal");
  doc.setFontSize(10);
  doc.setTextColor(60, 56, 52);
  doc.text("Albadi CRM + Website · June 2026", margin, 72);
  para(
    "Full-stack delivery: public 3D designer, factory pricing, PDF export, CRM lead capture from website sessions, WhatsApp outbound from dashboard. Status: SHIPPED."
  );
  newPage();

  title("1. Scope delivered");
  bullet("Website: 44 colors, logo upload, 3D GLB viewer, ILS pricing, PDF download.");
  bullet("CRM: WhatsApp CTA link (3D Designer button), session tokens, design history.");
  bullet("Anonymous website visitors auto-register as CRM leads on PDF submit (phone match).");
  bullet("Two repos: albadi-crm (engine) + bag-quote-app (/configurator iframe).");

  title("2. Feature matrix");
  const features = [
    "44 fabric colors + live 3D — SHIPPED",
    "Logo PNG/JPG/SVG decal — SHIPPED",
    "Factory pricing API (ILS) — SHIPPED",
    "PDF with mockup — SHIPPED",
    "CRM WhatsApp send — SHIPPED",
    "Website lead auto-create — SHIPPED",
    "bag-quote-app embed — SHIPPED",
  ];
  features.forEach(bullet);

  title("3. Architecture");
  para("bag-quote-app /configurator iframes albadi-crm /configurator.");
  para("POST /api/configurator/designs upserts lead by phone + stores design row.");
  para("CRM operator uses 3D Designer button → configurator_sessions → WhatsApp CTA.");

  title("4. Screenshots");
  addImage(IMG_LEADS, "Fig 1: Leads index — website leads appear after configurator PDF submit.");
  addImage(IMG_LEAD, "Fig 2: Lead detail — 3D Designer sends WhatsApp CTA link.");

  title("5. Website flow");
  bullet("Open /configurator → color → logo → quote tab → fill contact → PDF.");
  bullet("API creates/updates lead (leadSource=website_configurator, stage INTAKE).");

  title("6. CRM flow");
  bullet("Login: /login (ADMIN_PASSWORD env).");
  bullet("Leads → open card → 3D Designer → customer completes → design on record.");

  title("7. URLs");
  bullet("Production CRM: https://albadi-crm.vercel.app");
  bullet("Configurator: /configurator");
  bullet("Dashboard: /dashboard/v3/leads");
  bullet("Quote API: GET /api/configurator/quote?productId=p1&quantity=1000&shippingOptionId=s1");

  title("8. Local ports");
  bullet("albadi-crm: localhost:3000");
  bullet("bag-quote-app web: localhost:8081");

  title("9. Sign-off");
  para(
    "All integration points specified in the project brief are implemented and verified in staging. Interactive 3D replaces the originally discussed video approach. Remaining ops task: point albadi.ecobrotherss.com/configurator to the deployed build."
  );

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, Buffer.from(doc.output("arraybuffer")));
  console.log("Wrote", OUT);
}

main();
