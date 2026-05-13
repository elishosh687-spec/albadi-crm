/**
 * Test JIDs — leads in this set get auto-reset to NEW state on every
 * inbound message. Lets Eli message the production bot from his own
 * phone and always see the questionnaire from Stage 1 regardless of
 * what stage the lead happens to be at.
 *
 * IMPORTANT: only add JIDs you fully control. Anything in this list
 * loses all stage/q_state history on every inbound.
 */
export const TEST_JIDS = new Set<string>([
  "133144455962747@lid", // Eli — 0525755705
]);

export function isTestJid(jid: string): boolean {
  return TEST_JIDS.has(jid.trim());
}
