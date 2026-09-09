import { runCallbackRequests } from "../lib/autoresponder/callback-request";
import { getBotSettings } from "../lib/bot-settings/store";

async function main() {
  const S = await getBotSettings();
  console.log("callbackEnabled בהגדרות:", S.callbackEnabled);
  const live = await runCallbackRequests({ dry: false });
  console.log(
    `ריצה אמיתית → enabled=${live.enabled} · מועמדים=${live.count} · הודעות שנוסחו=${live.items.length} · נשלחו=${live.items.filter((i) => i.sent).length}`
  );
}
main().then(() => process.exit(0));
