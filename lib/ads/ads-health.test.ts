import { describe, expect, it } from "vitest";
import { jobCheck, purchaseCheck } from "./ads-health";
import type { JobCheck } from "@/lib/observability/jobs";

describe("purchaseCheck", () => {
  it("a failed Purchase for a lead that came from an ad is a problem, named", () => {
    const c = purchaseCheck([{ name: "סהר צור", error: "Error connecting to database: fetch failed", hasKey: true }]);
    expect(c.ok).toBe(false);
    expect(c.detail).toContain("סהר צור");
    expect(c.detail).toContain("fetch failed");
  });
  it("a deal with no Meta attribution key is not a fault", () => {
    expect(purchaseCheck([{ name: "x", error: "no_leadgen_id_or_fbclid", hasKey: false }]).ok).toBe(true);
    expect(purchaseCheck([]).ok).toBe(true);
  });
});

const job = (health: JobCheck["health"], over: Partial<JobCheck> = {}): JobCheck => ({
  job: "ads-evidence",
  label: "x",
  state: {},
  health,
  minutesSinceOk: 30,
  lateAfterMin: 1800,
  ...over,
});

describe("jobCheck", () => {
  it("ok / late / failed / never read differently", () => {
    expect(jobCheck(job("ok"), "l")).toMatchObject({ ok: true, detail: "רצה בהצלחה לפני 30 דק׳" });
    expect(jobCheck(job("late", { minutesSinceOk: 3000 }), "l").detail).toContain("לא רצה בזמן");
    expect(jobCheck(job("failed", { state: { lastError: "META_ADS_TOKEN לא מוגדר" } }), "l").detail).toBe("נכשלה: META_ADS_TOKEN לא מוגדר");
    expect(jobCheck(job("never"), "l").ok).toBe(false);
    expect(jobCheck(undefined, "l").ok).toBe(false);
  });
});
