/**
 * List the GHL users in the location (id + name + email) so the assignee picker
 * offers the real people instead of hardcoded guesses.
 *   DATABASE_URL="$(...)" npx tsx scripts/_list-ghl-users.ts
 */
import { db } from "@/lib/db";
import { ghlOauthTokens } from "@/drizzle/schema";
import { desc } from "drizzle-orm";

async function main() {
  const [tok] = await db
    .select({ access: ghlOauthTokens.accessToken, loc: ghlOauthTokens.locationId })
    .from(ghlOauthTokens)
    .orderBy(desc(ghlOauthTokens.updatedAt))
    .limit(1);
  if (!tok?.access) { console.log("no GHL token in DB"); return; }

  const res = await fetch(
    `https://services.leadconnectorhq.com/users/?locationId=${encodeURIComponent(tok.loc ?? "")}`,
    { headers: { Authorization: `Bearer ${tok.access}`, Version: "2021-07-28", Accept: "application/json" } }
  );
  const j = (await res.json()) as { users?: { id: string; name?: string; firstName?: string; lastName?: string; email?: string; roles?: unknown }[] };
  if (!res.ok) { console.log("HTTP", res.status, JSON.stringify(j).slice(0, 400)); return; }
  console.log(`location ${tok.loc} · ${j.users?.length ?? 0} users\n`);
  for (const u of j.users ?? []) {
    console.log(`${u.id}  ${u.name ?? `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim()}  <${u.email ?? "—"}>`);
  }
  console.log(`\nenv GHL_SALESPERSON_USER_ID = ${process.env.GHL_SALESPERSON_USER_ID ?? "(not set locally)"}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
