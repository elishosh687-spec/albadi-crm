/**
 * Generates public/docs/CONFIGURATOR-GUIDE.pdf from the guide content.
 * Run: npx tsx scripts/generate-configurator-guide-pdf.ts
 */

import fs from "fs";
import path from "path";
import { jsPDF } from "jspdf";

const OUT = path.join(process.cwd(), "public/docs/CONFIGURATOR-GUIDE.pdf");
const FONT_REG = path.join(process.cwd(), "public/fonts/Heebo-Regular.ttf");
const FONT_BOLD = path.join(process.cwd(), "public/fonts/Heebo-Bold.ttf");

function toBase64(file: string) {
  return fs.readFileSync(file).toString("base64");
}

type FontDoc = jsPDF & {
  addFileToVFS: (name: string, data: string) => void;
  addFont: (postScriptName: string, id: string, style: string) => void;
};

const sections: Array<{ title: string; lines: string[] }> = [
  {
    title: "מעצב שקיות Albadi — מדריך שימוש",
    lines: [
      "גרסה 2026-06-11",
      "",
      "פורטים מקומיים:",
      "• albadi-crm → http://localhost:3000/configurator",
      "• bag-quote-app → http://localhost:8081/configurator",
      "• Dashboard Eli → http://localhost:3000/dashboard/v3",
    ],
  },
  {
    title: "מה הושלם",
    lines: [
      "✓ 44 צבעי בד (SKU אמיתי) + בחירה בזמן אמת",
      "✓ העלאת לוגו PNG/JPG/SVG + Decal על שקית 3D",
      "✓ מודל GLB אינטראקטיבי (סיבוב, זום, צילום)",
      "✓ מחירון אמיתי בשקלים (מנוע המפעל + הגדרות CRM)",
      "✓ PDF עם מוקאפ 3D + פירוט מחיר",
      "✓ שליחת קישור אישי מ-CRM ל-WhatsApp (כפתור מעצב 3D)",
      "✓ מילוי פרטי לקוח מקישור (?t=token)",
      "✓ שמירת עיצוב בליד אחרי הורדת PDF",
      "✓ route /configurator ב-bag-quote-app (iframe)",
      "⏳ דיפלוי לנחיתה / albadi.ecobrotherss.com — צוות חיצוני",
    ],
  },
  {
    title: "שימוש ללקוח (מעצב 3D)",
    lines: [
      "1. בד וצבע — גלילה בין 44 גוונים, לחיצה מעדכנת את השקית.",
      "2. לוגו — העלאה, גרירה על השקית, סליידרים לגודל/מיקום/סיבוב.",
      "3. הצעת מחיר — גודל שקית p1-p14, כמות, משלוח, ידיות, למינציה.",
      "   מחיר מתעדכן אוטומטית. מלא שם/אימייל/טלפון → הורד PDF.",
    ],
  },
  {
    title: "שימוש ל-Eli (CRM)",
    lines: [
      "1. Dashboard v3 → פתח ליד.",
      "2. לחץ מעצב 3D (סקירה או צ׳אט).",
      "3. הלקוח מקבל כפתור WhatsApp CTA עם קישור אישי.",
      "4. אחרי שהלקוח מוריד PDF — העיצוב מופיע בפאנל עיצובי 3D בליד.",
      "5. לוג פעילות: נשלח קישור / עיצוב נשמר.",
    ],
  },
  {
    title: "רשימת בדיקה",
    lines: [
      "□ /configurator — שקית 3D נטענת",
      "□ בחירת צבע משנה את השקית",
      "□ לוגו מופיע על השקית",
      "□ מחיר מתעדכן לפי כמות/גודל",
      "□ PDF יורד עם מוקאפ",
      "□ :8081/configurator — iframe עובד",
      "□ כפתור מעצב 3D שולח WhatsApp (DB+Bridge)",
    ],
  },
  {
    title: "English summary",
    lines: [
      "Two repos: albadi-crm (engine+API+CRM) and bag-quote-app (site iframe).",
      "Pricing uses the same factory calculator as the bot (ILS).",
      "Set CONFIGURATOR_PUBLIC_URL for production WhatsApp links.",
    ],
  },
];

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

  const newPageIfNeeded = (need: number) => {
    if (y + need > 285) {
      doc.addPage();
      y = margin;
    }
  };

  for (const section of sections) {
    newPageIfNeeded(14);
    doc.setFont("Heebo", "bold");
    doc.setFontSize(13);
    doc.setTextColor(156, 66, 33);
    doc.text(section.title, pageW - margin, y, { align: "right" });
    y += 8;

    doc.setFont("Heebo", "normal");
    doc.setFontSize(10);
    doc.setTextColor(28, 24, 21);

    for (const line of section.lines) {
      if (line === "") {
        y += 4;
        continue;
      }
      const wrapped = doc.splitTextToSize(line, maxW) as string[];
      for (const w of wrapped) {
        newPageIfNeeded(6);
        doc.text(w, pageW - margin, y, { align: "right" });
        y += 5.5;
      }
    }
    y += 6;
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const buf = Buffer.from(doc.output("arraybuffer"));
  fs.writeFileSync(OUT, buf);
  console.log("Wrote", OUT);
}

main();
