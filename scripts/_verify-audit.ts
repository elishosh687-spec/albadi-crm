import { runPipelineAudit } from "@/lib/analysis/pipeline-audit";
async function main() {
  const a = await runPipelineAudit();
  console.log("noTask:", a.noTask.length, "| stageLag:", a.stageLag.length);
  const bad = a.stageLag.filter((r) => r.currentStage && ["WON","LOST","FUTURE_FOLLOW_UP","NO_RESPONSE_REENGAGE"].includes(r.currentStage));
  console.log("stageLag rows still on hands-off stages (should be 0):", bad.length);
  console.log("sample stageLag current→suggested:", a.stageLag.slice(0,6).map(r => `${r.currentStage ?? "NULL"}→${r.suggestedStage}`).join(", "));
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
