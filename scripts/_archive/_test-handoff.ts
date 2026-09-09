/** Scratch — verify handoff vs stop-word classification and the mirror-label strip. */
import { isHumanHandoffRequest, isStopWord } from "../lib/messaging/templates";

const HANDOFF = [
  "כבה בוט",
  "תכבה את הבוט בבקשה",
  "אני רוצה לדבר עם בן אדם",
  "אפשר לדבר עם נציג?",
  "מספיק עם הבוט",
  "תפסיק עם הבוט אני רוצה בן אדם",
  "לא רוצה בוט",
];
const STOP = ["תפסיק", "לא מעוניין", "הסר אותי", "stop", "אל תשלחו לי יותר"];
const NORMAL = [
  "5,000 יחידות",
  "H40*D15*W50",
  "כמה זה עולה?",
  "יש לכם נציג באזור הצפון?",
  "אקספרס (~25 יום)",
  "2 צבעים",
  "יקר לי",
];

let fails = 0;
const check = (label: string, cond: boolean, detail: string) => {
  if (!cond) { fails++; console.log(`❌ ${label}: ${detail}`); }
};

console.log("--- handoff phrases must be handoff, and must win over stop ---");
for (const t of HANDOFF) {
  check("handoff", isHumanHandoffRequest(t), `"${t}" not detected as handoff`);
  console.log(`  "${t}" → handoff=${isHumanHandoffRequest(t)} stop=${isStopWord(t)}`);
}

console.log("--- stop words must NOT be misread as a handoff request ---");
for (const t of STOP) {
  check("stop", isStopWord(t), `"${t}" not detected as stop`);
  check("stop-not-handoff", !isHumanHandoffRequest(t), `"${t}" wrongly read as handoff`);
  console.log(`  "${t}" → stop=${isStopWord(t)} handoff=${isHumanHandoffRequest(t)}`);
}

console.log("--- ordinary answers must trigger neither ---");
for (const t of NORMAL) {
  check("normal", !isHumanHandoffRequest(t) && !isStopWord(t), `"${t}" wrongly flagged`);
  console.log(`  "${t}" → stop=${isStopWord(t)} handoff=${isHumanHandoffRequest(t)}`);
}

console.log(fails === 0 ? "\n✅ all classification checks passed" : `\n❌ ${fails} failures`);
process.exit(fails === 0 ? 0 : 1);
