/**
 * Apply a tag to a subscriber. Removes existing status tags first.
 *
 * Usage: tsx scripts/apply-tag.ts <subscriberId> <tagName>
 *   tagName: ליד_חדש | מעוניין | הצעה_בוט | הצעה_טלפון | בתהליך | לקוח | לא_ענה | לא_רלוונטי
 */
import "dotenv/config";
import { addTag, removeTag, setCustomFields } from "../lib/manychat/client";
import { TAG_IDS, STATUS_TAG_IDS, TagName } from "../lib/manychat/config";

async function main() {
  const [subscriberId, tagName] = process.argv.slice(2);

  if (!subscriberId || !tagName) {
    console.error("Usage: tsx scripts/apply-tag.ts <subscriberId> <tagName>");
    console.error(`tagName: ${Object.keys(TAG_IDS).join(" | ")}`);
    process.exit(1);
  }

  if (!(tagName in TAG_IDS)) {
    console.error(`Unknown tag: ${tagName}`);
    console.error(`Valid: ${Object.keys(TAG_IDS).join(", ")}`);
    process.exit(1);
  }

  const newTagId = TAG_IDS[tagName as TagName];

  for (const oldTagId of STATUS_TAG_IDS) {
    if (oldTagId === newTagId) continue;
    try {
      await removeTag(subscriberId, oldTagId);
    } catch {
      // ignore — tag may not be set
    }
  }

  await addTag(subscriberId, newTagId);

  const today = new Date().toISOString().slice(0, 10);
  await setCustomFields(subscriberId, [
    { name: "last_contact_date", value: today },
  ]);

  console.log(`OK: ${subscriberId} → ${tagName}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
