/**
 * Reassign EVERYTHING owned by Itay → Eli: pipeline opportunities, their
 * contacts (lead ownership), and open crm_tasks. Eli 2026-08-04.
 *
 * Self-contained: pulls the GHL token + location from ghl_oauth_tokens and hits
 * GHL v2 directly, so it needs only DATABASE_URL.
 *
 *   DATABASE_URL=... npx tsx scripts/_reassign-itay-to-eli.ts        # AUDIT (read-only)
 *   DATABASE_URL=... npx tsx scripts/_reassign-itay-to-eli.ts --go   # EXECUTE
 *
 * On --go it first writes a before-state snapshot to scratchpad for reversibility.
 */
import { neon } from "@neondatabase/serverless";

const GO = process.argv.includes("--go");
const BASE = "https://services.leadconnectorhq.com";
const sql = neon(process.env.DATABASE_URL!);

async function ghl(path: string, token: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Version: "2021-07-28",
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-json */ }
  if (!res.ok) throw new Error(`GHL ${res.status} ${path}: ${text.slice(0, 300)}`);
  return json;
}

function ownerId(o: any): string | null {
  return o?.assignedTo ?? o?.assigned_to ?? o?.assignedUserId ?? null;
}
function fullName(u: any): string {
  return (u.name || `${u.firstName ?? ""} ${u.lastName ?? ""}`).trim();
}

(async () => {
  const [tok] = await sql`
    SELECT access_token, location_id FROM ghl_oauth_tokens ORDER BY updated_at DESC LIMIT 1
  `;
  if (!tok?.access_token) throw new Error("no GHL token in DB");
  const token = tok.access_token as string;
  const loc = tok.location_id as string;

  // 1) Resolve Elazar + Itay user ids.
  const usersResp = await ghl(`/users/?locationId=${loc}`, token);
  const users: any[] = usersResp?.users ?? [];
  const findUser = (needle: string) =>
    users.find((u) => fullName(u).includes(needle) || (u.email ?? "").toLowerCase().includes(needle.toLowerCase()));
  const elazar = findUser("איתי") || findUser("Itay") || findUser("המלך");
  const itay = findUser("Shoshtari") || findUser("Elazar") || findUser("elishosh687");
  if (!elazar || !itay) {
    console.log("users found:", users.map((u) => `${fullName(u)} <${u.email}> ${u.id}`).join("\n"));
    throw new Error("could not resolve Itay/Eli");
  }
  console.log(`FROM Itay  = ${fullName(elazar)} (${elazar.id})`);
  console.log(`TO   Eli   = ${fullName(itay)} (${itay.id})`);

  // 2) Pipelines → collect ALL opportunities across every pipeline.
  const pipeResp = await ghl(`/opportunities/pipelines?locationId=${loc}`, token);
  const pipelines: any[] = pipeResp?.pipelines ?? [];
  const allOpps: any[] = [];
  for (const p of pipelines) {
    let startAfter: string | undefined, startAfterId: string | undefined;
    for (let page = 0; page < 40; page++) {
      const qs = new URLSearchParams({ location_id: loc, pipeline_id: p.id, limit: "100" });
      if (startAfter) qs.set("startAfter", startAfter);
      if (startAfterId) qs.set("startAfterId", startAfterId);
      const r = await ghl(`/opportunities/search?${qs}`, token);
      const opps: any[] = r?.opportunities ?? [];
      allOpps.push(...opps.map((o) => ({ ...o, _pipeline: p.name })));
      if (!opps.length || !r?.meta?.startAfter || !r?.meta?.startAfterId) break;
      startAfter = r.meta.startAfter; startAfterId = r.meta.startAfterId;
    }
  }
  const elazarOpps = allOpps.filter((o) => ownerId(o) === elazar.id);
  const contactIds = [...new Set(elazarOpps.map((o) => o.contactId).filter(Boolean))];

  // 3) crm_tasks owned by Itay (open ones matter most; count both).
  const taskRows = await sql`
    SELECT t.id, t.ghl_task_id, t.status, t.title, t.due_at, l.ghl_contact_id
    FROM crm_tasks t
    LEFT JOIN leads l ON trim(l.manychat_sub_id) = trim(t.manychat_sub_id)
    WHERE t.assigned_to = ${elazar.id}
  `;
  const openTasks = taskRows.filter((t: any) => t.status !== "completed");

  console.log("\n=== SCOPE (what will move Itay → Eli) ===");
  console.log(`opportunities owned by Itay : ${elazarOpps.length}`);
  console.log(`   → distinct contacts (leads): ${contactIds.length}`);
  console.log(`crm_tasks owned by Itay     : ${taskRows.length} (open: ${openTasks.length})`);
  console.log(`total opps in all pipelines   : ${allOpps.length}`);
  if (elazarOpps.length) {
    console.log("\n=== FULL LIST — leads (opportunities) owned by Itay ===");
    elazarOpps
      .slice()
      .sort((a, b) => (a.name || "").localeCompare(b.name || "", "he"))
      .forEach((o, i) => console.log(`${String(i + 1).padStart(3)}. ${o.name || "(ללא שם)"}  [${o._pipeline} · ${o.status}]`));
  }
  if (openTasks.length) {
    console.log("\n=== open tasks owned by Itay ===");
    openTasks.forEach((t: any, i: number) => console.log(`${String(i + 1).padStart(3)}. ${t.title}`));
  }

  if (!GO) {
    console.log("\n(dry run — pass --go to execute)");
    return;
  }

  // ---- EXECUTE ----
  const before = { at: new Date().toISOString(), elazar: elazar.id, itay: itay.id,
    opps: elazarOpps.map((o) => ({ id: o.id, contactId: o.contactId })),
    tasks: taskRows.map((t: any) => ({ id: t.id, ghl: t.ghl_task_id })) };
  const fs = await import("node:fs");
  const snapPath = `/private/tmp/reassign-before-${Date.now()}.json`;
  fs.writeFileSync(snapPath, JSON.stringify(before, null, 2));
  console.log(`\nbefore-state snapshot → ${snapPath}\n`);

  let oppOk = 0, cОk = 0, tOk = 0, err = 0;
  // Opportunities
  for (const o of elazarOpps) {
    try {
      await ghl(`/opportunities/${o.id}`, token, {
        method: "PUT",
        body: JSON.stringify({ pipelineId: o.pipelineId, assignedTo: itay.id }),
      });
      oppOk++;
    } catch (e) { err++; console.warn("opp fail", o.id, String(e).slice(0, 120)); }
  }
  // Contacts (lead ownership)
  for (const cid of contactIds) {
    try {
      await ghl(`/contacts/${cid}`, token, { method: "PUT", body: JSON.stringify({ assignedTo: itay.id }) });
      cОk++;
    } catch (e) { err++; console.warn("contact fail", cid, String(e).slice(0, 120)); }
  }
  // Tasks: DB + push to GHL
  for (const t of taskRows as any[]) {
    try {
      await sql`UPDATE crm_tasks SET assigned_to = ${itay.id}, updated_at = now() WHERE id = ${t.id}`;
      if (t.ghl_task_id && t.ghl_contact_id) {
        await ghl(`/contacts/${t.ghl_contact_id}/tasks/${t.ghl_task_id}`, token, {
          method: "PUT",
          body: JSON.stringify({
            title: t.title ?? "משימה",
            dueDate: (t.due_at ? new Date(t.due_at) : new Date(Date.now() + 864e5)).toISOString(),
            assignedTo: itay.id,
          }),
        });
      }
      tOk++;
    } catch (e) { err++; console.warn("task fail", t.id, String(e).slice(0, 120)); }
  }
  console.log(`\nDONE: opps ${oppOk}/${elazarOpps.length} · contacts ${cОk}/${contactIds.length} · tasks ${tOk}/${taskRows.length} · errors ${err}`);
})().catch((e) => { console.error(e); process.exit(1); });
