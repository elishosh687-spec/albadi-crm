import "dotenv/config";
import { db } from "../lib/db";
import { leads } from "../drizzle/schema";

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

async function main() {
  await db.insert(leads).values(
    KNOWN_SUBSCRIBERS.map((id) => ({ manychatSubId: id, source: "seed" }))
  ).onConflictDoNothing();
  console.log(`Seeded ${KNOWN_SUBSCRIBERS.length} leads`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
