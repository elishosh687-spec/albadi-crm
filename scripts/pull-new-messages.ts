/**
 * Pulls new messages / status from ManyChat for all known subscribers.
 * Filters to leads that may need decisions (excludes terminal: לקוח / לא_רלוונטי).
 *
 * Output: JSON list to stdout, ready for Claude to read.
 *
 * Run: npm run bot:pull-messages
 */
import "dotenv/config";
import { getSubscriber, getFieldValue } from "../lib/manychat/client";
import { TAG_IDS, TERMINAL_TAGS } from "../lib/manychat/config";

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

function tagIdToName(tagId: number): string | null {
  for (const [name, id] of Object.entries(TAG_IDS)) {
    if (id === tagId) return name;
  }
  return null;
}

interface LeadSnapshot {
  subscriberId: string;
  name: string;
  phone: string | null;
  currentTag: string | null;
  notes: string | null;
  quoteTotal: number | null;
  quantity: number | null;
  followUp: string | null;
  lastContact: string | null;
  lastContactType: string | null;
  daysSinceContact: number | null;
}

async function main() {
  const today = new Date();
  const out: LeadSnapshot[] = [];

  for (const sid of KNOWN_SUBSCRIBERS) {
    try {
      const sub = await getSubscriber(sid);
      const tagIds = sub.tags.map((t) => t.id);

      if (tagIds.some((id) => TERMINAL_TAGS.includes(id))) continue;

      const currentTag = tagIds.map(tagIdToName).filter(Boolean)[0] ?? null;
      const notes = getFieldValue(sub.custom_fields, "notes");
      const quoteTotal = getFieldValue(sub.custom_fields, "quote_total");
      const quantity = getFieldValue(sub.custom_fields, "quantity");
      const followUp = getFieldValue(sub.custom_fields, "follow_up_date");
      const lastContact = getFieldValue(sub.custom_fields, "last_contact_date");
      const lastContactType = getFieldValue(sub.custom_fields, "last_contact_type");

      let daysSinceContact: number | null = null;
      if (lastContact) {
        const lc = new Date(String(lastContact).slice(0, 10));
        daysSinceContact = Math.floor(
          (today.getTime() - lc.getTime()) / (1000 * 60 * 60 * 24)
        );
      }

      out.push({
        subscriberId: sid,
        name: sub.name ?? sid,
        phone: sub.phone ?? null,
        currentTag,
        notes: notes ? String(notes) : null,
        quoteTotal: quoteTotal ? Number(quoteTotal) : null,
        quantity: quantity ? Number(quantity) : null,
        followUp: followUp ? String(followUp) : null,
        lastContact: lastContact ? String(lastContact) : null,
        lastContactType: lastContactType ? String(lastContactType) : null,
        daysSinceContact,
      });
    } catch (e) {
      // skip on error
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
