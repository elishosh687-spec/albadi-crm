/**
 * Local test of the deterministic analysis pipeline (no OpenAI/GHL network —
 * those keys are masked locally). Validates: dossier build on a REAL lead, the
 * grounding guardrail (a fabricated quote must be DROPPED), playbook mapping,
 * and GHL note rendering.
 *
 * Run: DATABASE_URL="$(neonctl ...)" npx tsx scripts/_test-lead-analysis.ts "תאופיק"
 */
import { resolveLeadSid, buildLeadDossier, renderDossierText } from "@/lib/analysis/build-dossier";
import { normalizeAndGround, renderNoteBody, type RawJudge } from "@/lib/analysis/analyze-lead";

async function main() {
  const query = process.argv[2] || "תאופיק";
  const cands = await resolveLeadSid(query);
  if (!cands.length) {
    console.log(`no lead found for "${query}"`);
    process.exit(0);
  }
  // pick the candidate with the most data
  let best = cands[0];
  let bestDossier = await buildLeadDossier(best.sid);
  for (const c of cands.slice(1)) {
    const d = await buildLeadDossier(c.sid);
    if (d && (!bestDossier || d.stats.callCount > bestDossier.stats.callCount)) {
      best = c;
      bestDossier = d;
    }
  }
  const d = bestDossier!;
  console.log(`LEAD: ${d.name} (${d.sid}) stage=${d.stage}`);
  console.log(`stats:`, d.stats, `phone=${d.phone} ghl=${d.ghlContactId}`);
  console.log(`dossier render length: ${renderDossierText(d).length} chars`);

  // Find a REAL quote substring from the dossier to prove grounding keeps it.
  const firstCallTranscript = d.calls.find((c) => c.transcript)?.transcript || "";
  const realQuote =
    firstCallTranscript.split(/\s+/).slice(10, 18).join(" ") ||
    d.messages.find((m) => m.text && m.text.length > 12)?.text ||
    "יקר";

  const stubbedJudge: RawJudge = {
    insufficient_data: false,
    root_cause: "בדיקה: שורש התקיעה לדוגמה.",
    primary_blocker: "price",
    objections: [
      // grounded — should survive
      { text: "התנגדות אמיתית", quote: realQuote, is_surface_or_root: "root", taxonomy_key: "price_vs_unbranded" },
      // fabricated — should be DROPPED by the grounding check
      { text: "ציטוט מומצא", quote: "זהו משפט שלא נאמר מעולם בשיחה הזו בכלל אבסולוטית", is_surface_or_root: "surface", taxonomy_key: "other" },
    ],
    price_forensics: { our_unit: "1.3", their_alt_unit: "0.9", branded_vs_unbranded: true, gulpha_issue: false },
    commitment_scorecard: { score_1_5: 4, evidence: "עניין גבוה" },
    intent_signals: ["ביקש הצעה"],
    followup_verdict: { promised: true, delivered: false, gap_days: 5 },
    sample: { asked: true, fulfilled: false },
    recommended_next_action: "שלח דוגמה פיזית היום.",
    confidence: "medium",
  };

  const verdict = normalizeAndGround(d, stubbedJudge);
  console.log("\n=== VERDICT ===");
  console.log(JSON.stringify(verdict, null, 2));
  console.log(`\nGROUNDING: dropped ${verdict.grounding.dropped_unverified} fabricated quote(s) (expected 1), kept ${verdict.objections.length}`);

  console.log("\n=== GHL NOTE BODY ===");
  console.log(renderNoteBody(verdict, "[LEAD-ANALYSIS v1] sid=" + d.sid + " h=test1234"));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
