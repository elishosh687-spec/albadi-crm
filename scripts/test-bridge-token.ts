import "dotenv/config";

const BASE = "https://wa-bridge-yehuda.fly.dev";
const TOKEN = "wat_pgTj_RfHLobS7Ira9pDt7-ozCBiLUcQfIbYBeI5hIE8";

async function probe(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  console.log(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
}

(async () => {
  await probe("GET", "/v1/subscriptions");
  await probe("GET", "/v1/me");
  await probe("GET", "/v1/tenant");
  await probe("GET", "/v1/status");
  await probe("GET", "/healthz");
})();
