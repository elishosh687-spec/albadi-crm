import { getBotSettings, saveBotSettings } from "../lib/bot-settings/store";

async function main() {
  const cur = await getBotSettings({ fresh: true });
  const next = await saveBotSettings({
    ...cur,
    intentModel: "gpt-5.6-luna",
    analysisModel: "gpt-5.6-terra",
    setterModel: "gpt-5.6-terra",
  });
  console.log("stored:", next.intentModel, next.analysisModel, next.setterModel);
}
main().then(() => process.exit(0));
