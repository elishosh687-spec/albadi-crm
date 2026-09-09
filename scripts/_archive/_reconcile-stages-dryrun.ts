/**
 * DRY-RUN stage reconcile: pull every opportunity's REAL stage from GHL
 * (source of truth) and compare to leads.pipeline_stage in the DB.
 * READ-ONLY — writes nothing. Prints the exact drift list + direction.
 */
import { db } from "@/lib/db";
import { leads, ghlOauthTokens } from "@/drizzle/schema";
import { desc, eq } from "drizzle-orm";
import { normalizeStage } from "@/lib/manychat/stages";

const GHL_BASE = "https://services.leadconnectorhq.com";
const V = "2021-07-28";

// GHL stage NAME (label) → our internal enum. Handles both Hebrew labels and
// internal names so it survives however the pipeline is named in GHL.
function ghlNameToEnum(name: string): string {
  const n = name.trim();
  const map: Record<string, string> = {
    "קליטה": "INTAKE", "שאלון": "INTAKE", "שאלון + הצעה אוטומטית": "INTAKE", INTAKE: "INTAKE",
    "אפיון": "DISCAVERY", "שיחת בירור": "DISCAVERY", DISCAVERY: "DISCAVERY",
    "מחכה למפעל": "FACTORY_WAIT", "בדיקת מפעל": "FACTORY_WAIT", FACTORY_WAIT: "FACTORY_WAIT",
    "משא ומתן": "CONSIDERATION", "שוקל הצעה": "CONSIDERATION", "שוקל / משא ומתן": "CONSIDERATION", CONSIDERATION: "CONSIDERATION",
    "נסגר": "WON", "זכה": "WON", WON: "WON",
    "לא נסגר": "LOST", "אבוד": "LOST", LOST: "LOST",
    "מעקב עתידי": "FUTURE_FOLLOW_UP", FUTURE_FOLLOW_UP: "FUTURE_FOLLOW_UP",
    "אין מענה": "NO_RESPONSE_REENGAGE", NO_RESPONSE_REENGAGE: "NO_RESPONSE_REENGAGE",
  };
  return map[n] ?? `?(${n})`;
}

async function ghl(path: string, token: string, params?: Record<string, string | number>) {
  const url = new URL(GHL_BASE + path);
  if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Version: V, Accept: "application/json" } });
  if (!res.ok) throw new Error(`GHL ${path} → ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json() as Promise<any>;
}

async function main() {
  const tok = (await db.select().from(ghlOauthTokens).orderBy(desc(ghlOauthTokens.updatedAt)).limit(1))[0];
  if (!tok) throw new Error("no ghl_oauth_tokens row");
  const token = tok.accessToken, locationId = tok.locationId;
  console.log(`GHL location=${locationId} | token updated=${tok.updatedAt?.toISOString()?.slice(0,16)} | expires=${tok.expiresAt?.toISOString()?.slice(0,16)}`);

  // 1) Pipelines → stage id→name
  const pl = await ghl("/opportunities/pipelines", token, { locationId });
  const pipelines = pl.pipelines ?? [];
  console.log(`\npipelines: ${pipelines.map((p: any) => `${p.name}(${p.stages?.length})`).join(", ")}`);
  // Pick the pipeline whose stages match our funnel (has אפיון/DISCAVERY-like).
  const pipeline = pipelines.find((p: any) => (p.stages ?? []).some((s: any) => ghlNameToEnum(s.name) === "DISCAVERY")) ?? pipelines[0];
  const stageName = new Map<string, string>();
  for (const s of pipeline.stages ?? []) stageName.set(s.id, s.name);
  console.log(`\nusing pipeline "${pipeline.name}" (${pipeline.id})`);
  for (const s of pipeline.stages ?? []) console.log(`  stage ${s.id} = "${s.name}" → ${ghlNameToEnum(s.name)}`);

  // 2) All opportunities in the pipeline (paginated)
  const oppStageByContact = new Map<string, string>();
  const ghlCounts: Record<string, number> = {};
  let startAfter: string | undefined, startAfterId: string | undefined, page = 0, total = 0;
  do {
    const params: Record<string, string | number> = { location_id: locationId, pipeline_id: pipeline.id, limit: 100 };
    if (startAfter) params.startAfter = startAfter;
    if (startAfterId) params.startAfterId = startAfterId;
    const r = await ghl("/opportunities/search", token, params);
    const opps = r.opportunities ?? [];
    for (const o of opps) {
      const enumStage = ghlNameToEnum(stageName.get(o.pipelineStageId) ?? o.pipelineStageId);
      if (o.contactId) oppStageByContact.set(o.contactId, enumStage);
      ghlCounts[enumStage] = (ghlCounts[enumStage] ?? 0) + 1;
    }
    total = r.meta?.total ?? total;
    startAfter = r.meta?.startAfter; startAfterId = r.meta?.startAfterId;
    page++;
    if (opps.length === 0) break;
  } while (startAfter && startAfterId && page < 40);
  console.log(`\nGHL opportunities pulled: ${oppStageByContact.size} (meta.total=${total}, pages=${page})`);
  console.log("GHL stage distribution:", JSON.stringify(ghlCounts));

  // 3) DB active leads with a ghl_contact_id
  const dbLeads = await db.select({ sid: leads.manychatSubId, name: leads.name, stage: leads.pipelineStage, ghl: leads.ghlContactId, active: leads.active }).from(leads).where(eq(leads.active, true));
  const withGhl = dbLeads.filter((l) => l.ghl);
  const mism: any[] = [];
  let match = 0, noOpp = 0;
  for (const l of withGhl) {
    const ghlStage = oppStageByContact.get(l.ghl!);
    if (!ghlStage) { noOpp++; continue; }
    const dbStage = normalizeStage(l.stage) ?? "NULL";
    if (dbStage === ghlStage) { match++; continue; }
    mism.push({ sid: l.sid, name: l.name, db: dbStage, ghl: ghlStage });
  }

  console.log(`\nDB active leads: ${dbLeads.length} | with ghl_contact_id: ${withGhl.length}`);
  console.log(`  ✅ match: ${match} | ❌ mismatch: ${mism.length} | ⚠️ no GHL opp: ${noOpp}\n`);
  console.log("=== MISMATCHES (GHL = truth, DB is stale) ===");
  // group by direction
  mism.sort((a, b) => (a.db + a.ghl).localeCompare(b.db + b.ghl));
  for (const m of mism) console.log(`  ${(m.name ?? "—").padEnd(22)} | DB=${m.db.padEnd(14)} → GHL=${m.ghl}`);
  // direction summary
  const dir: Record<string, number> = {};
  for (const m of mism) { const k = `${m.db} → ${m.ghl}`; dir[k] = (dir[k] ?? 0) + 1; }
  console.log("\n=== drift directions ===");
  for (const [k, c] of Object.entries(dir).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${c}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
