import { db } from "@/lib/db";
import { leads, ghlOauthTokens } from "@/drizzle/schema";
import { desc, eq } from "drizzle-orm";

const GHL_BASE = "https://services.leadconnectorhq.com", V = "2021-07-28";
// COMPLETE map incl. the real side-stage labels used in GHL.
function nameToEnum(n: string): string {
  const m: Record<string, string> = {
    "קליטה": "INTAKE", "אפיון": "DISCAVERY", "מחכה למפעל": "FACTORY_WAIT",
    "משא ומתן": "CONSIDERATION", "נסגר": "WON", "לא נסגר": "LOST",
    "להתקשר בעתיד": "FUTURE_FOLLOW_UP", "לא ענו": "NO_RESPONSE_REENGAGE",
  };
  return m[n.trim()] ?? `?(${n})`;
}
async function ghl(path: string, token: string, params?: Record<string, string | number>) {
  const url = new URL(GHL_BASE + path);
  if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Version: V, Accept: "application/json" } });
  if (!r.ok) throw new Error(`${path} ${r.status}`);
  return r.json() as Promise<any>;
}
async function main() {
  const tok = (await db.select().from(ghlOauthTokens).orderBy(desc(ghlOauthTokens.updatedAt)).limit(1))[0];
  const token = tok.accessToken, locationId = tok.locationId;
  const pl = await ghl("/opportunities/pipelines", token, { locationId });
  const pipeline = pl.pipelines.find((p: any) => (p.stages ?? []).some((s: any) => nameToEnum(s.name) === "DISCAVERY"));
  const stageName = new Map<string, string>();
  for (const s of pipeline.stages) stageName.set(s.id, s.name);
  const truth = new Map<string, string>();
  let after: string | undefined, afterId: string | undefined, page = 0;
  do {
    const q: any = { location_id: locationId, pipeline_id: pipeline.id, limit: 100 };
    if (after) q.startAfter = after; if (afterId) q.startAfterId = afterId;
    const r = await ghl("/opportunities/search", token, q);
    for (const o of r.opportunities ?? []) if (o.contactId) truth.set(o.contactId, nameToEnum(stageName.get(o.pipelineStageId) ?? ""));
    after = r.meta?.startAfter; afterId = r.meta?.startAfterId; page++;
    if (!(r.opportunities ?? []).length) break;
  } while (after && afterId && page < 40);

  const rows = await db.select({ name: leads.name, stage: leads.pipelineStage, ghl: leads.ghlContactId }).from(leads).where(eq(leads.active, true));
  let match = 0, noOpp = 0; const mism: any[] = [];
  for (const l of rows) {
    if (!l.ghl) continue;
    const g = truth.get(l.ghl); if (!g) { noOpp++; continue; }
    const dbStage = l.stage ?? "NULL"; // RAW — no normalizeStage
    if (dbStage === g) match++; else mism.push({ name: l.name, db: dbStage, ghl: g });
  }
  console.log(`✅ MATCH: ${match} | ❌ mismatch: ${mism.length} | no-opp: ${noOpp}\n`);
  for (const m of mism) console.log(`  ${(m.name ?? "—").padEnd(24)} DB=${m.db.padEnd(20)} GHL=${m.ghl}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
