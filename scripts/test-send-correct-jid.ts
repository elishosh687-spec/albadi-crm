import "dotenv/config";
import { sendBridgeMessage } from "../lib/bridge/client";
import { phoneToJid } from "../lib/bridge/jid";

async function main() {
  const phone = process.argv[2] || "972525755705";
  const text = process.argv[3] || "בדיקת JID - תקין?";
  const jid = phoneToJid(phone);
  console.log("sending to JID:", jid);
  console.log("text:", text);
  const r = await sendBridgeMessage(jid, text, undefined, "eli");
  console.log("result:", JSON.stringify(r));
  process.exit(0);
}
main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
