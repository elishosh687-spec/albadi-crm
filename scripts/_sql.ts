import { neon } from "@neondatabase/serverless";
import { readFileSync } from "fs";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const query = process.argv[2] === "-f"
    ? readFileSync(process.argv[3], "utf8")
    : process.argv[2];
  const rows = await (sql as any)(query);
  console.log(JSON.stringify(rows, null, 1));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
