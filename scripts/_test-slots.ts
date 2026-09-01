import { proposeCallSlots, describeNow } from "../lib/setter/slots";
const cases: [string, string][] = [
  ["01/09 19:20 (הזמן שבו הבוט הציע 17:00 היום)", "2026-09-01T16:20:00Z"],
  ["01/09 12:01", "2026-09-01T09:01:00Z"],
  ["02/09 08:30 בבוקר", "2026-09-02T05:30:00Z"],
  ["04/09 שישי 10:00", "2026-09-04T07:00:00Z"],
  ["05/09 שבת 12:00", "2026-09-05T09:00:00Z"],
];
(async () => {
  for (const [label, iso] of cases) {
    const now = new Date(iso);
    console.log(`\n${label}  →  עכשיו: ${describeNow(now)}`);
    for (const sid of ["972502348255@c.us", "972545521186@c.us", "972509037994@c.us"]) {
      const s = await proposeCallSlots(sid, now);
      console.log(`   ${sid.padEnd(26)} ${s.map(x=>x.label).join("  |  ") || "(אין חלון)"}`);
    }
  }
})().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1)});
