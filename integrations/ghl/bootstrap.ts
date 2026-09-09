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
import { logger } from "@/lib/observability/log";

const log = logger("ghl");

// 6 stages in Kanban order. Matches `pickStageId` lookup in mapping.ts.
// Source of truth: lib/manychat/stages.ts → V2_PIPELINE_STAGES.
const ALBADI_STAGES = [
  "INTAKE",
  "DISCAVERY",
  "FACTORY_WAIT",
  "CONSIDERATION",
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
  log.info("bootstrap.pipelines.list");
  const pipelines = await listPipelines();
  if (pipelines.length === 0) {
    log.warn("bootstrap.pipelines.none", { msg: "No pipelines in this location. Create one in the GHL UI first." });
  } else {
    for (const p of pipelines) {
      log.info("bootstrap.pipeline", { name: p.name, id: p.id });
    }
  }

  let pipeline: GHLPipeline | undefined = pipelines.find(
    (p) => p.name.toLowerCase() === "albadi"
  );

  if (!pipeline) {
    log.info("bootstrap.pipeline.creating", { name: "Albadi" });
    try {
      pipeline = await createPipeline({
        name: "Albadi",
        stages: ALBADI_STAGES.map((name, i) => ({
          name,
          position: (i + 1) * 10,
        })),
      });
      log.info("bootstrap.pipeline.created", { id: pipeline.id });
    } catch (err) {
      log.error("bootstrap.pipeline.create_failed", err, {
        msg:
          'Falling back: create pipeline manually in GHL UI: CRM → Opportunities → Pipelines → + Add Pipeline; ' +
          'Name: "Albadi"; Stages (in order): INTAKE, DISCAVERY, FACTORY_WAIT, CONSIDERATION, WON, LOST; ' +
          "Then re-run this script.",
      });
      pipeline = pipelines[0]; // fallback so we still create fields
    }
  }

  if (pipeline) {
    log.info("bootstrap.pipeline.selected", { name: pipeline.name, id: pipeline.id });
    envBlock.push({ key: "GHL_PIPELINE_ID", value: pipeline.id });
    for (const s of pipeline.stages ?? []) {
      log.info("bootstrap.stage", { name: s.name, stageId: s.id });
    }
    log.info("bootstrap.stage_mapping", { msg: "Map these stage ids to local stages in .env (one per local stage)" });
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
      log.info("bootstrap.stage_env", { envKey, value, matched: Boolean(value) });
      envBlock.push({ key: envKey, value });
    }
  }

  // ---- Custom fields ----
  log.info("bootstrap.custom_fields.list");
  const existing = await listLocationCustomFields("contact");
  const byName = new Map(existing.map((f) => [f.name, f]));
  log.info("bootstrap.custom_fields.existing", { count: existing.length });

  log.info("bootstrap.custom_fields.ensure");
  for (const def of GHL_FIELD_DEFINITIONS) {
    let cf = byName.get(def.name);
    if (!cf) {
      try {
        cf = await createLocationCustomField({
          name: def.name,
          dataType: def.dataType,
          model: "contact",
        });
        log.info("bootstrap.custom_field.created", { name: def.name, dataType: def.dataType, id: cf.id });
      } catch (err) {
        log.error("bootstrap.custom_field.create_failed", err, { name: def.name });
        continue;
      }
    } else {
      log.info("bootstrap.custom_field.exists", { name: def.name, id: cf.id });
    }
    envBlock.push({ key: def.envKey, value: cf.id });
  }

  // ---- Env block ----
  log.info("bootstrap.env_block", { count: envBlock.length });
  // Paste-able output for the operator — stays on stdout on purpose.
  console.log("\n=== Paste into .env (and Vercel) ===\n");
  for (const line of envBlock) {
    console.log(`${line.key}=${line.value}`);
  }
  console.log("\nWhen done, set ENABLE_GHL_SYNC=1 to start mirroring.");
  log.info("bootstrap.done");
}

main().catch((err) => {
  log.error("bootstrap.fatal", err);
  process.exit(1);
});
