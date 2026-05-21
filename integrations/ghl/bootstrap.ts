/**
 * One-time GHL bootstrap.
 *
 * Idempotent — safe to run repeatedly. Creates only what's missing.
 *
 * Steps:
 *   1. List pipelines, print ids.
 *   2. For the pipeline named "Albadi" (or first pipeline if missing),
 *      list stages and print mapping suggestions.
 *   3. List existing contact custom fields; create the missing ones from
 *      GHL_FIELD_DEFINITIONS.
 *   4. Print env block for the user to paste into .env.
 *
 * Prereqs:
 *   GHL_API_KEY (or GHL_ACCESS_TOKEN) + GHL_LOCATION_ID in .env
 *
 * Run:
 *   npx tsx integrations/ghl/bootstrap.ts
 */
import "dotenv/config";
import {
  listPipelines,
  createPipeline,
  listLocationCustomFields,
  createLocationCustomField,
  type GHLPipeline,
} from "./client";
import {
  GHL_FIELD_DEFINITIONS,
  GHL_STAGE_IDS,
} from "./config";

// 8 stages in Kanban order. Matches `pickStageId` lookup in mapping.ts.
// Source of truth: lib/manychat/stages.ts → V2_PIPELINE_STAGES.
const ALBADI_STAGES = [
  "INITIAL_QUOTE_SENT",
  "AWAITING_FIRST_RESPONSE",
  "SHOWED_INTEREST",
  "FACTORY_CHECK",
  "FINAL_QUOTE_SENT",
  "NEGOTIATING",
  "WON",
  "LOST",
];

interface EnvLine {
  key: string;
  value: string;
}

async function main() {
  const envBlock: EnvLine[] = [];

  // ---- Pipelines ----
  console.log("→ Listing pipelines ...");
  const pipelines = await listPipelines();
  if (pipelines.length === 0) {
    console.log(
      "  ✗ No pipelines in this location. Create one in the GHL UI first."
    );
  } else {
    for (const p of pipelines) {
      console.log(`  · ${p.name.padEnd(24)} id=${p.id}`);
    }
  }

  let pipeline: GHLPipeline | undefined = pipelines.find(
    (p) => p.name.toLowerCase() === "albadi"
  );

  if (!pipeline) {
    console.log('\n→ "Albadi" pipeline not found — attempting to create via API ...');
    try {
      pipeline = await createPipeline({
        name: "Albadi",
        stages: ALBADI_STAGES.map((name, i) => ({
          name,
          position: (i + 1) * 10,
        })),
      });
      console.log(`  ✓ created pipeline id=${pipeline.id}`);
    } catch (err) {
      console.error("  ✗ pipeline create failed:", err instanceof Error ? err.message : err);
      console.error('  → Falling back: create pipeline manually in GHL UI:');
      console.error('     CRM → Opportunities → Pipelines → + Add Pipeline');
      console.error('     Name: "Albadi"');
      console.error('     Stages (in order): INITIAL_QUOTE_SENT, AWAITING_FIRST_RESPONSE,');
      console.error('     SHOWED_INTEREST, FACTORY_CHECK, FINAL_QUOTE_SENT, NEGOTIATING,');
      console.error('     WON, LOST');
      console.error('     Then re-run this script.');
      pipeline = pipelines[0]; // fallback so we still create fields
    }
  }

  if (pipeline) {
    console.log(`\n→ Using pipeline "${pipeline.name}" (${pipeline.id})`);
    envBlock.push({ key: "GHL_PIPELINE_ID", value: pipeline.id });
    console.log("  Stages:");
    for (const s of pipeline.stages ?? []) {
      console.log(`    · ${s.name.padEnd(24)} stage_id=${s.id}`);
    }
    console.log(
      "\n  Map these stage ids to local stages in .env (one per local stage):"
    );
    for (const localStage of Object.keys(GHL_STAGE_IDS)) {
      // 1. Exact match (most reliable — matches names like "AWAITING_ESTIMATE").
      // 2. Case-insensitive exact.
      // 3. Substring with space ↔ underscore fallback.
      const stages = pipeline.stages ?? [];
      const exact = stages.find((s) => s.name === localStage);
      const ci = !exact
        ? stages.find((s) => s.name.toLowerCase() === localStage.toLowerCase())
        : undefined;
      const substr = !exact && !ci
        ? stages.find((s) =>
            s.name.toLowerCase().includes(localStage.toLowerCase().replace(/_/g, " "))
          )
        : undefined;
      const match = exact ?? ci ?? substr;
      const value = match?.id ?? "";
      const envKey = `GHL_STAGE_${localStage}`;
      console.log(`    ${envKey}=${value}${value ? "" : "   # (no match — set manually)"}`);
      envBlock.push({ key: envKey, value });
    }
  }

  // ---- Custom fields ----
  console.log("\n→ Listing existing contact custom fields ...");
  const existing = await listLocationCustomFields("contact");
  const byName = new Map(existing.map((f) => [f.name, f]));
  console.log(`  ${existing.length} fields exist`);

  console.log("\n→ Ensuring required custom fields ...");
  for (const def of GHL_FIELD_DEFINITIONS) {
    let cf = byName.get(def.name);
    if (!cf) {
      try {
        cf = await createLocationCustomField({
          name: def.name,
          dataType: def.dataType,
          model: "contact",
        });
        console.log(`  + created ${def.name.padEnd(30)} (${def.dataType}) id=${cf.id}`);
      } catch (err) {
        console.error(`  ✗ create failed for ${def.name}:`, err);
        continue;
      }
    } else {
      console.log(`  ✓ exists  ${def.name.padEnd(30)} id=${cf.id}`);
    }
    envBlock.push({ key: def.envKey, value: cf.id });
  }

  // ---- Env block ----
  console.log("\n=== Paste into .env (and Vercel) ===\n");
  for (const line of envBlock) {
    console.log(`${line.key}=${line.value}`);
  }
  console.log("\nWhen done, set ENABLE_GHL_SYNC=1 to start mirroring.");
  console.log("Done.");
}

main().catch((err) => {
  console.error("Bootstrap failed:", err);
  process.exit(1);
});
