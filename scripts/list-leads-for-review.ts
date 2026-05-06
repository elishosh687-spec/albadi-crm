/**
 * Combines pull-new-messages + applies code rules to identify which leads
 * need review. Outputs:
 *   - auto-decisions: leads with clear code-rule classification (Claude can apply)
 *   - needs-claude: leads where rules don't decide → Claude reads + decides
 *   - escalations: leads matching escalation triggers
 *
 * Usage: tsx scripts/list-leads-for-review.ts
 */
import "dotenv/config";
import { getSubscriber, getFieldValue } from "../lib/manychat/client";
import { TAG_IDS, TERMINAL_TAGS, FIELD_IDS } from "../lib/manychat/config";

const KNOWN_SUBSCRIBERS = [
  "1290975646", "335237336", "843866619", "1567115769", "2035644170",
  "1884294789", "1602697859", "933250256", "1945485008", "2121695200",
  "21902603", "342493590", "1342391971", "647013452", "235009133",
  "1109877399", "1233780185", "1168653412", "1745508158", "1559024601",
  "940287852", "969554152", "24594158", "1513055758", "1986772872",
  "3658499", "1890126495", "248319497", "221677737", "347894123",
  "869425808", "1768242677", "956589647", "771607363", "1720207271",
  "774945448", "1701651968", "1258938556", "306431271",
];

interface ReviewItem {
  subscriberId: string;
  name: string;
  currentTag: string | null;
  notes: string | null;
  daysSinceContact: number | null;
  followUp: string | null;
  quoteTotal: number | null;
  // Decision proposal
  proposedTag?: string;
  ruleMatched?: string;
  needsClaude?: boolean;
  reason?: string;
}

const tagIdToName: Record<number, string> = Object.fromEntries(
  Object.entries(TAG_IDS).map(([k, v]) => [v, k])
);

function applyRules(item: ReviewItem): ReviewItem {
  const days = item.daysSinceContact ?? 0;
  const tag = item.currentTag;

  // RULE: > 5 days no contact + currently followup-pending → לא_ענה
  if (
    (tag === "הצעה_בוט" || tag === "הצעה_טלפון" || tag === "ליד_חדש") &&
    days >= 5
  ) {
    return { ...item, proposedTag: "לא_ענה", ruleMatched: "no_contact_5days" };
  }

  // RULE: had quote_total + tag still ליד_חדש → הצעה_בוט
  if (tag === "ליד_חדש" && item.quoteTotal && item.quoteTotal > 0) {
    return { ...item, proposedTag: "הצעה_בוט", ruleMatched: "quote_sent" };
  }

  // No clear rule
  return {
    ...item,
    needsClaude: true,
    reason: "no rule matched — Claude judgment needed",
  };
}

async function main() {
  const today = new Date();
  const items: ReviewItem[] = [];

  for (const sid of KNOWN_SUBSCRIBERS) {
    try {
      const sub = await getSubscriber(sid);
      const tagIds = sub.tags.map((t) => t.id);
      if (tagIds.some((id) => TERMINAL_TAGS.includes(id))) continue;

      const currentTag = tagIds.map((id) => tagIdToName[id]).filter(Boolean)[0] ?? null;
      const notes = getFieldValue(sub.custom_fields, "notes");
      const quoteTotal = getFieldValue(sub.custom_fields, "quote_total");
      const lastContact = getFieldValue(sub.custom_fields, "last_contact_date");
      const followUp = getFieldValue(sub.custom_fields, "follow_up_date");

      let daysSinceContact: number | null = null;
      if (lastContact) {
        const lc = new Date(String(lastContact).slice(0, 10));
        daysSinceContact = Math.floor(
          (today.getTime() - lc.getTime()) / (1000 * 60 * 60 * 24)
        );
      }

      const item: ReviewItem = {
        subscriberId: sid,
        name: sub.name ?? sid,
        currentTag,
        notes: notes ? String(notes) : null,
        daysSinceContact,
        followUp: followUp ? String(followUp) : null,
        quoteTotal: quoteTotal ? Number(quoteTotal) : null,
      };

      items.push(applyRules(item));
    } catch {
      // skip
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  const autoDecisions = items.filter((i) => i.proposedTag && !i.needsClaude);
  const needsClaude = items.filter((i) => i.needsClaude);

  console.log(JSON.stringify({ autoDecisions, needsClaude }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
