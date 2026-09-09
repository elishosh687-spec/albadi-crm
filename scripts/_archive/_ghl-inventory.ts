import { db } from '../lib/db';
import { ghlOauthTokens } from '../drizzle/schema';
import { desc } from 'drizzle-orm';

(async () => {
  const tok = await db.select().from(ghlOauthTokens).orderBy(desc(ghlOauthTokens.updatedAt)).limit(1);
  if (!tok[0]) { console.log('NO TOKEN'); process.exit(1); }
  const { accessToken, locationId } = tok[0];
  const headers = {
    'Authorization': `Bearer ${accessToken}`,
    'Version': '2021-07-28',
    'Accept': 'application/json',
  };

  console.log('=== Location ID:', locationId);

  // 1. Custom Fields on Contact
  console.log('\n=== CUSTOM FIELDS (Contact) ===');
  const cf = await fetch(`https://services.leadconnectorhq.com/locations/${locationId}/customFields?model=contact`, { headers });
  const cfJson = await cf.json();
  for (const f of cfJson.customFields || []) {
    console.log(`- ${f.name} (${f.fieldKey}) [${f.dataType}]`);
  }

  // 2. Custom Fields on Opportunity
  console.log('\n=== CUSTOM FIELDS (Opportunity) ===');
  const cfo = await fetch(`https://services.leadconnectorhq.com/locations/${locationId}/customFields?model=opportunity`, { headers });
  const cfoJson = await cfo.json();
  for (const f of cfoJson.customFields || []) {
    console.log(`- ${f.name} (${f.fieldKey}) [${f.dataType}]`);
  }

  // 3. Pipelines & stages
  console.log('\n=== PIPELINES ===');
  const pip = await fetch(`https://services.leadconnectorhq.com/opportunities/pipelines?locationId=${locationId}`, { headers });
  const pipJson = await pip.json();
  for (const p of pipJson.pipelines || []) {
    console.log(`Pipeline: ${p.name} (${p.id})`);
    for (const s of p.stages || []) console.log(`  - ${s.name} (${s.id})`);
  }

  // 4. Workflows
  console.log('\n=== WORKFLOWS ===');
  const wf = await fetch(`https://services.leadconnectorhq.com/workflows/?locationId=${locationId}`, { headers });
  const wfJson = await wf.json();
  for (const w of wfJson.workflows || []) {
    console.log(`- ${w.name} (${w.id}) [${w.status}]`);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
