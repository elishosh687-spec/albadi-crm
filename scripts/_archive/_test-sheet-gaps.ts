import { loadSheetGaps } from "../lib/sheets/lead-gaps";

process.env.GOOGLE_SHEETS_FB_LEADS_ID = "1AnswoeBAFV-z4aN3KhqyJjb9DegyiDNH-0FcB8ry518";

async function main() {
  const snap = await loadSheetGaps({ force: true });
  console.log(`\n=== Sheet-gap snapshot (sheet: ${snap.spreadsheetId}) ===`);
  console.log(`fetched at: ${snap.fetchedAt.toISOString()}`);
  console.log(`total gaps : ${snap.total}`);
  console.log(`  pending    : ${snap.pendingCount}`);
  console.log(`  bad_phone  : ${snap.badPhoneCount}`);
  console.log(`  send_failed: ${snap.sendFailedCount}`);
  console.log(`  other_error: ${snap.otherErrorCount}`);
  if (snap.rows.length > 0) {
    console.log(`\nRows:`);
    for (const r of snap.rows.slice(0, 10)) {
      console.log(`  row ${r.rowIndex}  ${r.name}  ${r.rawPhone}  cat=${r.category}  lastStatus=${r.lastStatus}  sid=${r.sid}`);
    }
  } else {
    console.log(`\n(no gap rows — happy path, all processed or test rows filtered)`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
