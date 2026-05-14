import "dotenv/config";

const BASE = "https://wa-bridge-yehuda.fly.dev";
const TOKEN = "wat_pgTj_RfHLobS7Ira9pDt7-ozCBiLUcQfIbYBeI5hIE8";
const SUB_ID = "sub_01KRHJD89E3FQ288S5SRK5MBGT";

(async () => {
  const res = await fetch(`${BASE}/v1/subscriptions/${SUB_ID}/ping`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  console.log(`status=${res.status}`);
  console.log(await res.text());
})();
