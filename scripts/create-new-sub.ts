import "dotenv/config";

const BASE = "https://wa-bridge-yehuda.fly.dev";
const NEW_TOKEN = "wat_pgTj_RfHLobS7Ira9pDt7-ozCBiLUcQfIbYBeI5hIE8";
const WEBHOOK_URL = "https://albadi-crm.vercel.app/api/bridge/webhook";
const EVENTS = [
  "message.received",
  "message.sent",
  "message.delivered",
  "message.read",
  "message.failed",
];

(async () => {
  const res = await fetch(`${BASE}/v1/subscriptions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${NEW_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url: WEBHOOK_URL, events: EVENTS }),
  });
  const text = await res.text();
  console.log(`status=${res.status}`);
  console.log(text);

  if (res.ok) {
    const p = JSON.parse(text);
    console.log("\n=== NEW VALUES ===");
    console.log(`BRIDGE_TENANT_TOKEN=${NEW_TOKEN}`);
    console.log(`BRIDGE_SUBSCRIPTION_ID=${p.id ?? p.subscription_id ?? "??"}`);
    console.log(`BRIDGE_WEBHOOK_SECRET=${p.signing_secret ?? p.secret ?? "??"}`);
  }
})();
