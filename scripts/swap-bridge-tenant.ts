import "dotenv/config";

const BASE = "https://wa-bridge-yehuda.fly.dev";
const OLD_TOKEN = "wat_NRnABP9odJsz0zGKBbvJLgKktzIdD-FDBhDBl2b58IA";
const OLD_SUB_ID = "sub_01KREB8RMHFKPGR5A7DYWC78YW";
const NEW_TOKEN = "wat_pgTj_RfHLobS7Ira9pDt7-ozCBiLUcQfIbYBeI5hIE8";
const WEBHOOK_URL = "https://albadi-crm.vercel.app/api/bridge/webhook";
const EVENTS = [
  "message.received",
  "message.sent",
  "message.delivered",
  "message.read",
  "message.failed",
];

async function call(method: string, path: string, token: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text };
}

(async () => {
  console.log("=== STEP 1: DELETE old subscription ===");
  const del = await call("DELETE", `/v1/subscriptions/${OLD_SUB_ID}`, OLD_TOKEN);
  console.log(`status=${del.status}`);
  console.log(del.body);

  console.log("\n=== STEP 2: POST new subscription on new tenant ===");
  const create = await call("POST", "/v1/subscriptions", NEW_TOKEN, {
    url: WEBHOOK_URL,
    events: EVENTS,
  });
  console.log(`status=${create.status}`);
  console.log(create.body);

  if (create.status >= 200 && create.status < 300) {
    const parsed = JSON.parse(create.body);
    console.log("\n=== NEW VALUES — copy into .env + Vercel envs ===");
    console.log(`BRIDGE_TENANT_TOKEN=${NEW_TOKEN}`);
    console.log(`BRIDGE_SUBSCRIPTION_ID=${parsed.id ?? parsed.subscription_id ?? "??"}`);
    console.log(`BRIDGE_WEBHOOK_SECRET=${parsed.signing_secret ?? parsed.secret ?? "??"}`);
  }
})();
