import { getBotSettings, saveBotSettings } from "../lib/bot-settings/store";
async function main() {
  const cur = await getBotSettings({ fresh: true });
  const next = await saveBotSettings({ ...cur, setterLiveEnabled: true });
  console.log("setterLiveEnabled:", next.setterLiveEnabled);
}
main().then(() => process.exit(0));
