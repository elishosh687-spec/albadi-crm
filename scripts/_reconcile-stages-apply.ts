/**
 * APPLY stage reconcile: make DB follow GHL (source of truth) for mismatched
 * leads. EXCLUDES rows where the DB currently says LOST (Eli's decision:
 * keep those closed, don't revive them). Dry-run by default; pass --go to write.
 * Only touches leads.pipeline_stage — no GHL write (GHL is already correct).
 */
import { db } from "@/lib/db";
import { leads, ghlOauthTokens } from "@/drizzle/schema";
import { desc, eq } from "drizzle-orm";
import { normalizeStage } from "@/lib/manychat/stages";

const GO = process.argv.includes("--go");
const GHL_BASE = "https://services.leadconnectorhq.com";
const V = "2021-07-28";

function ghlNameToEnum(name: string): string {
  const map: Record<string, string> = {
    "קליטה": "INTAKE", "אפיון": "DISCAVERY", "מחכה למפעל": "FACTORY_WAIT",
    "משא ומתן": "CONSIDERATION", "נסגר": "WON", "לא נסגר": "LOST",
    "להתקשר בעתיד": "FUTURE_FOLLOW_UP", "לא ענו": "NO_RESPONSE_REENGAGE",
  };
  return map[name.trim()] ?? `?(${name})`;
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

  const pl = await ghl("/opportunities/pipelines", token, { locationId });
  const pipeline = (pl.pipelines ?? []).find((p: any) => (p.stages ?? []).some((s: any) => ghlNameToEnum(s.name) === "DISCAVERY"));
  const stageName = new Map<string, string>();
  for (const s of pipeline.stages ?? []) stageName.set(s.id, s.name);

  const oppStageByContact = new Map<string, string>();
  let startAfter: string | undefined, startAfterId: string | undefined, page = 0;
  do {
    const params: Record<string, string | number> = { location_id: locationId, pipeline_id: pipeline.id, limit: 100 };
    if (startAfter) params.startAfter = startAfter;
    if (startAfterId) params.startAfterId = startAfterId;
    const r = await ghl("/opportunities/search", token, params);
    const opps = r.opportunities ?? [];
    for (const o of opps) {
      if (!o.contactId) continue;
      oppStageByContact.set(o.contactId, ghlNameToEnum(stageName.get(o.pipelineStageId) ?? o.pipelineStageId));
    }
    startAfter = r.meta?.startAfter; startAfterId = r.meta?.startAfterId; page++;
    if (opps.length === 0) break;
  } while (startAfter && startAfterId && page < 40);

  const dbLeads = await db.select({ sid: leads.manychatSubId, name: leads.name, stage: leads.pipelineStage, ghl: leads.ghlContactId })
    .from(leads).where(eq(leads.active, true));

  const toApply: { sid: string; name: string | null; from: string; to: string }[] = [];
  const skippedLost: { name: string | null; to: string }[] = [];
  for (const l of dbLeads) {
    if (!l.ghl) continue;
    const ghlStage = oppStageByContact.get(l.ghl);
    if (!ghlStage || ghlStage.startsWith("?(")) continue;
    const dbStage = normalizeStage(l.stage) ?? "NULL";
    if (dbStage === ghlStage) continue;
    if (dbStage === "LOST") { skippedLost.push({ name: l.name, to: ghlStage }); continue; } // Eli: keep closed
    toApply.push({ sid: l.sid, name: l.name, from: dbStage, to: ghlStage });
  }

  console.log(`${GO ? "APPLYING" : "DRY-RUN"} — ${toApply.length} to sync, ${skippedLost.length} LOST kept as-is\n`);
  for (const c of toApply) console.log(`  ${(c.name ?? "—").padEnd(24)} ${c.from.padEnd(14)} → ${c.to}`);
  console.log(`\nkept LOST (not revived): ${skippedLost.map((s) => s.name).join(", ")}`);

  if (GO) {
    let n = 0;
    for (const c of toApply) {
      await db.update(leads).set({ pipelineStage: c.to === "NULL" ? null : c.to, updatedAt: new Date() }).where(eq(leads.manychatSubId, c.sid));
      n++;
    }
    console.log(`\n✅ updated ${n} leads.pipeline_stage`);
  } else {
    console.log(`\n(dry-run — pass --go to write)`);
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
