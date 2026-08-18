/**
 * Scratch — the cadence box is the one setting where a typo becomes
 * harassment. Prove no reachable input produces a spam loop.
 */
import {
  parseCadence,
  toMs,
  describeCadence,
  MIN_GAP_HOURS,
  MAX_ATTEMPTS_CAP,
} from "../lib/autoresponder/followup-cadence";

const FALLBACK = [2, 12, 23];
let fails = 0;
const check = (label: string, cond: boolean, detail: string) => {
  if (!cond) { fails++; console.log(`❌ ${label} — ${detail}`); }
  else console.log(`✅ ${label}`);
};

console.log("=== normal input ===");
const ok = parseCadence("2,12,23", FALLBACK);
check("2,12,23 parses", JSON.stringify(ok.hours) === "[2,12,23]", JSON.stringify(ok.hours));
check("spaces tolerated", JSON.stringify(parseCadence(" 2 , 12 ,23 ", FALLBACK).hours) === "[2,12,23]", "");
check("spaces as separator", JSON.stringify(parseCadence("2 12 23", FALLBACK).hours) === "[2,12,23]", "");
check("single value", JSON.stringify(parseCadence("72", FALLBACK).hours) === "[72]", "");
check("decimals kept", JSON.stringify(parseCadence("1.5,4", FALLBACK).hours) === "[1.5,4]", "");

console.log("\n=== the dangerous inputs — these MUST NOT produce a spam loop ===");
const zero = parseCadence("0,0,0", FALLBACK);
check("all zeros → fallback, not [0,0,0]",
  JSON.stringify(zero.hours) === JSON.stringify(FALLBACK), JSON.stringify(zero.hours));
const tiny = parseCadence("0.01,0.02", FALLBACK);
check(`0.01h clamped up to ${MIN_GAP_HOURS}h`,
  tiny.hours.every((h) => h >= MIN_GAP_HOURS), JSON.stringify(tiny.hours));
check("clamp is reported, not silent", tiny.warnings.length > 0, "no warnings");
const neg = parseCadence("-5,-1", FALLBACK);
check("negatives → fallback", JSON.stringify(neg.hours) === JSON.stringify(FALLBACK), JSON.stringify(neg.hours));
const empty = parseCadence("", FALLBACK);
check("empty → fallback (never 'no follow-ups ever')",
  JSON.stringify(empty.hours) === JSON.stringify(FALLBACK), JSON.stringify(empty.hours));
const junk = parseCadence("abc,,,;;", FALLBACK);
check("garbage → fallback", JSON.stringify(junk.hours) === JSON.stringify(FALLBACK), JSON.stringify(junk.hours));
const nullish = parseCadence(null, FALLBACK);
check("null → fallback", JSON.stringify(nullish.hours) === JSON.stringify(FALLBACK), "");
const huge = parseCadence("999999", FALLBACK);
check("absurdly large clamped", huge.hours[0] <= 24 * 60, JSON.stringify(huge.hours));
const many = parseCadence("1,1,1,1,1,1,1,1,1,1,1,1", FALLBACK);
check(`length capped at ${MAX_ATTEMPTS_CAP}`, many.hours.length === MAX_ATTEMPTS_CAP, String(many.hours.length));
const mixed = parseCadence("2,abc,12", FALLBACK);
check("bad entry dropped, good ones kept",
  JSON.stringify(mixed.hours) === "[2,12]", JSON.stringify(mixed.hours));

console.log("\n=== every parsed value survives the ms conversion as a real wait ===");
for (const raw of ["0,0,0", "0.01", "abc", "", "2,12,23", "-3"]) {
  const ms = toMs(parseCadence(raw, FALLBACK).hours);
  const smallest = Math.min(...ms);
  const okGap = smallest >= MIN_GAP_HOURS * 3600 * 1000;
  if (!okGap) fails++;
  console.log(`${okGap ? "✅" : "❌"} "${raw}" → min gap ${(smallest / 60000).toFixed(0)} min`);
}

console.log("\n=== human-readable summary shown in settings ===");
for (const raw of ["2,12,23", "1,1,1", "72", "4"]) {
  console.log(`  "${raw}" → ${describeCadence(parseCadence(raw, FALLBACK).hours)}`);
}

console.log(fails === 0 ? "\n✅ no reachable input can produce a spam loop" : `\n❌ ${fails} failures`);
process.exit(fails === 0 ? 0 : 1);
