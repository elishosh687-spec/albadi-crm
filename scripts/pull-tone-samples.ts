/**
 * Phase 0 — auto-pull tone samples.
 *
 * Pulls Eli's outbound replies from ManyChat conversation history across
 * all known subscribers and saves them to scripts/tone-samples.json
 * for use as few-shot examples when calibrating the bot's reply tone.
 *
 * NOTE: ManyChat's public API does not expose full message history.
 * This script tries the documented endpoints and falls back to whatever
 * fields ManyChat exposes (last_input_text, custom field "notes" if used as log).
 * For full transcript export the user may need to use ManyChat's UI export.
 *
 * Run: npm run tone:pull
 */
import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { getSubscriber } from "../lib/manychat/client";

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

interface ToneSample {
  subscriberId: string;
  name?: string;
  lastInput?: string;
  notes?: string;
}

async function main() {
  const samples: ToneSample[] = [];

  for (const sid of KNOWN_SUBSCRIBERS) {
    try {
      const sub = await getSubscriber(sid);
      const notes = sub.custom_fields.find((f) => f.id === 14447147)?.value;
      samples.push({
        subscriberId: sid,
        name: sub.name,
        notes: notes ? String(notes) : undefined,
      });
      process.stdout.write(".");
    } catch (e) {
      process.stdout.write("x");
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  process.stdout.write("\n");

  const outPath = path.join(__dirname, "tone-samples.json");
  fs.writeFileSync(outPath, JSON.stringify(samples, null, 2), "utf-8");
  console.log(`\nSaved ${samples.length} samples to ${outPath}`);
  console.log(
    "\nNOTE: This pulls 'notes' field as a proxy for tone. For real reply text, " +
      "export the conversation transcript from ManyChat UI (Contacts -> select -> Export)."
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
