/**
 * Feishu "ALBADI ORDER FOLLOW" → the local customer folders.
 *
 * Column AG ("Inspection Pic" / 验货照片) holds a LINK to a Feishu Drive folder
 * of factory inspection photos — not the images themselves. This walks every
 * row that has such a link, resolves the customer, and files the photos under
 *
 *     content/albadi/customers/<customer>/inspection-photos/
 *
 * Runs on Eli's Mac only: the CRM is on Vercel and cannot write to his disk.
 *
 * The customer is resolved by QUOTATION NUMBER (column B) against
 * factory_quote_requests, never by the name in the sheet — the factory writes
 * English ("Gold Baby") while the CRM and the folders are Hebrew
 * ("יוסי גולד בייבי", folder "גולד ביייבי"), and those do not map by string.
 * An existing folder wins over a new one so the tree doesn't sprout duplicates
 * (there are already both "איציק חודדה" and "איציק חודידה").
 *
 * Idempotent: a file already on disk is skipped, so it is safe on a schedule.
 * HEIC is converted to JPG with `sips` and the original kept — most of the
 * factory's photos are HEIC, which nothing outside Apple will open.
 *
 *   DATABASE_URL=… npx tsx scripts/sync-inspection-photos.ts [--dry] [--no-jpg]
 */
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { neon } from "@neondatabase/serverless";
import { getTenantAccessToken, getFeishuBaseUrl } from "../lib/feishu/client";

const SHEET_TOKEN = process.env.FEISHU_SHEET_TOKEN || "E727shGUTh0BZ8tA7bZcivRhnsh";
const TAB = "xEIUB8";
const ROOT = "/Users/eli/Projects/content/albadi/customers";
const SUBFOLDER = "inspection-photos";
const COL_CUSTOMER = 0;   // A
const COL_QUOTATION = 1;  // B
const COL_PIC = 32;       // AG

const DRY = process.argv.includes("--dry");
const NO_JPG = process.argv.includes("--no-jpg");

const cellText = (c: unknown): string =>
  Array.isArray(c)
    ? c.map((s: { text?: string }) => s?.text ?? "").join("").trim()
    : String(c ?? "").trim();

/** The Drive folder token inside an AG cell, or null. */
function folderToken(cell: unknown): string | null {
  if (!Array.isArray(cell)) return null;
  for (const seg of cell as { link?: string; text?: string }[]) {
    const url = seg?.link || seg?.text || "";
    const m = url.match(/\/drive\/folder\/([A-Za-z0-9]+)/);
    if (m) return m[1];
  }
  return null;
}

/** Filesystem-safe, but keeps Hebrew — these folders are read by a human. */
const safe = (s: string) => s.replace(/[/\\:*?"<>|]/g, "-").trim();

/**
 * Prefer a customer folder that already exists. The CRM name and the folder
 * name drift ("יוסי גולד בייבי" vs "גולד ביייבי"), so match on any shared word
 * of 3+ characters before creating anything new.
 */
function resolveCustomerDir(crmName: string): string {
  const existing = fs.existsSync(ROOT)
    ? fs.readdirSync(ROOT, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
    : [];
  const words = crmName.split(/\s+/).filter((w) => w.length >= 3);
  const hit = existing.find((dir) => words.some((w) => dir.includes(w)));
  return path.join(ROOT, safe(hit ?? crmName));
}

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const token = await getTenantAccessToken();
  const base = getFeishuBaseUrl();
  const auth = { Authorization: `Bearer ${token}` };

  const res = await fetch(
    `${base}/open-apis/sheets/v2/spreadsheets/${SHEET_TOKEN}/values/${TAB}!A1:AG400`,
    { headers: auth },
  );
  const body = (await res.json()) as { code?: number; msg?: string; data?: { valueRange: { values: unknown[][] } } };
  if (body.code) throw new Error(`Feishu ${body.code}: ${body.msg}`);
  const rows = body.data!.valueRange.values;

  let folders = 0, downloaded = 0, skipped = 0, converted = 0, unresolved = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const folder = folderToken(row[COL_PIC]);
    if (!folder) continue;
    folders++;

    const quotation = cellText(row[COL_QUOTATION]);
    const sheetName = cellText(row[COL_CUSTOMER]);
    let crmName = "";
    if (quotation) {
      const q = await sql`
        SELECT l.name FROM factory_quote_requests f
        LEFT JOIN leads l ON trim(l.manychat_sub_id) = trim(f.manychat_sub_id)
        WHERE f.quotation_no = ${quotation} AND l.name IS NOT NULL LIMIT 1`;
      crmName = (q as { name: string }[])[0]?.name ?? "";
    }
    if (!crmName) {
      // Falling back to the factory's English name would create a folder the
      // rest of the tree doesn't use — say so instead of quietly splitting it.
      console.warn(`  ⚠ row ${i + 1}: no CRM match for ${quotation || "(no quotation no.)"} — using "${sheetName}"`);
      crmName = sheetName || `unknown-row-${i + 1}`;
      unresolved++;
    }

    const dir = path.join(resolveCustomerDir(crmName), SUBFOLDER);
    console.log(`row ${i + 1}  ${quotation.padEnd(10)} ${crmName}`);
    console.log(`   → ${dir}`);
    if (!DRY) fs.mkdirSync(dir, { recursive: true });

    const listed = await fetch(
      `${base}/open-apis/drive/v1/files?folder_token=${folder}&page_size=200`,
      { headers: auth },
    );
    const files = ((await listed.json()) as { data?: { files?: { token: string; name: string }[] } }).data?.files ?? [];

    for (const f of files) {
      const dest = path.join(dir, f.name);
      if (fs.existsSync(dest)) { skipped++; continue; }
      if (DRY) { downloaded++; continue; }
      const dl = await fetch(`${base}/open-apis/drive/v1/files/${f.token}/download`, { headers: auth });
      if (!dl.ok) { console.warn(`   ✗ ${f.name}: HTTP ${dl.status}`); continue; }
      fs.writeFileSync(dest, Buffer.from(await dl.arrayBuffer()));
      downloaded++;
    }

    // Convert only AFTER every original is on disk. Converting inline lost
    // files: the factory ships "X (1).heic" AND a real "X (1).jpg", so a
    // conversion done mid-loop occupied the .jpg name and the genuine photo
    // was then skipped as "already there". Three were lost that way.
    if (!NO_JPG && !DRY) {
      for (const f of files) {
        if (!/\.heic$/i.test(f.name)) continue;
        const src = path.join(dir, f.name);
        if (!fs.existsSync(src)) continue;
        // The target name is decided by what FEISHU ships, never by what is
        // already on disk: "is there a .jpg here?" is true both when the
        // factory sent one and when a previous run converted this same file,
        // and treating the second case as a clash re-converted every photo on
        // every run (11 duplicates in one folder before this was caught).
        const plain = f.name.replace(/\.heic$/i, ".jpg");
        const factoryHasJpg = files.some((o) => o.name.toLowerCase() === plain.toLowerCase());
        const jpg = path.join(dir, factoryHasJpg ? f.name.replace(/\.heic$/i, "-heic.jpg") : plain);
        if (fs.existsSync(jpg)) continue;
        try {
          execFileSync("sips", ["-s", "format", "jpeg", src, "--out", jpg], { stdio: "ignore" });
          converted++;
        } catch {
          console.warn(`   ✗ could not convert ${f.name}`);
        }
      }
    }
    console.log(`   ${files.length} files in Feishu`);
  }

  console.log(
    `\n${DRY ? "[dry] " : ""}folders: ${folders} · downloaded: ${downloaded} · already there: ${skipped}` +
    ` · converted to jpg: ${converted}${unresolved ? ` · unresolved customers: ${unresolved}` : ""}`,
  );
}

main().catch((e) => { console.error(e); process.exit(1); });
