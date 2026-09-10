/**
 * lib/observability/jobs.ts against a real database: the heartbeat that the
 * watchdog reads. The unit test proved the SQL text; this proves the row.
 *
 * Restores the `jobs.status` document afterwards — the branch is throwaway,
 * but a developer may run this against a branch they keep.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkJobs, recordJobRun, withJob } from "@/lib/observability/jobs";
import { sleep, sql } from "./_db";

const JOB = "greenapi-health" as const;
let original: unknown;

async function statusDoc(): Promise<Record<string, any>> {
  const rows = (await sql(`SELECT value FROM app_config WHERE key = 'jobs.status'`)) as { value: Record<string, any> }[];
  return rows[0]?.value ?? {};
}

beforeAll(async () => {
  original = (await statusDoc()) ?? {};
});
afterAll(async () => {
  await sql(`UPDATE app_config SET value = $1::jsonb, updated_at = now() WHERE key = 'jobs.status'`, [JSON.stringify(original)]);
});

describe("recordJobRun", () => {
  it("a success stamps lastOkAt = lastRunAt and clears lastError", async () => {
    const before = Date.now();
    await recordJobRun(JOB, { ok: true, status: 200, durationMs: 7 });
    const st = (await statusDoc())[JOB];
    expect(st.lastStatus).toBe("ok");
    expect(st.lastDurationMs).toBe(7);
    expect(st.lastOkAt).toBe(st.lastRunAt);
    expect(Date.parse(st.lastOkAt)).toBeGreaterThanOrEqual(before - 1000);
    expect(st.lastError).toBeUndefined();
  });

  it("a failure records the error and leaves lastOkAt where it was", async () => {
    const okAt = (await statusDoc())[JOB].lastOkAt;
    await recordJobRun(JOB, { ok: false, status: 500, error: "boom" });
    const st = (await statusDoc())[JOB];
    expect(st.lastStatus).toBe("failed");
    expect(st.lastError).toBe("boom");
    expect(st.lastOkAt).toBe(okAt);
  });

  it("only touches its own job's sub-object", async () => {
    const before = await statusDoc();
    await recordJobRun(JOB, { ok: true, status: 200 });
    const after = await statusDoc();
    for (const k of Object.keys(before)) {
      if (k === JOB) continue;
      expect(after[k], k).toEqual(before[k]);
    }
  });
});

describe("withJob", () => {
  const req = (p = "") => new Request(`http://x/api/cron/greenapi-health${p}`, { headers: { authorization: "Bearer nope" } });

  it("a 401 probe is not a run — the document does not move", async () => {
    const before = JSON.stringify((await statusDoc())[JOB]);
    const h = withJob(JOB, "cron", async () => Response.json({ ok: false }, { status: 401 }));
    const res = await h(req(), undefined);
    expect(res.status).toBe(401);
    await sleep(300);
    expect(JSON.stringify((await statusDoc())[JOB])).toBe(before);
  });

  it("a 2xx is a heartbeat", async () => {
    await recordJobRun(JOB, { ok: false, status: 500, error: "seed" });
    const h = withJob(JOB, "cron", async () => Response.json({ ok: true }));
    await h(req(), undefined);
    await sleep(500);
    const st = (await statusDoc())[JOB];
    expect(st.lastStatus).toBe("ok");
  });

  it("a handler that throws is recorded as failed AND answered with the logger's 500", async () => {
    const h = withJob(JOB, "cron", async () => {
      throw new Error("kaboom");
    });
    const res = await h(req(), undefined);
    expect(res.status).toBe(500);
    await sleep(500);
    const st = (await statusDoc())[JOB];
    expect(st.lastStatus).toBe("failed");
    expect(st.lastError).toContain("kaboom");
  });
});

describe("checkJobs", () => {
  it("reads health from the stored document: failed → 'failed', old success → 'late'", async () => {
    await recordJobRun(JOB, { ok: true, status: 200 });
    const okAt = Date.parse((await statusDoc())[JOB].lastOkAt);
    const fresh = await checkJobs(new Date(okAt + 60_000));
    expect(fresh.checks.find((c) => c.job === JOB)?.health).toBe("ok");
    const stale = await checkJobs(new Date(okAt + 10 * 24 * 60 * 60_000));
    expect(stale.checks.find((c) => c.job === JOB)?.health).toBe("late");
    await recordJobRun(JOB, { ok: false, status: 500, error: "x" });
    const failed = await checkJobs(new Date(okAt + 60_000));
    expect(failed.checks.find((c) => c.job === JOB)?.health).toBe("failed");
  });

  it("every JOBS entry appears exactly once in the check list", async () => {
    const { checks } = await checkJobs();
    const names = checks.map((c) => c.job);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("expense-reminder");
    expect(names).toContain("vat-reminder");
  });
});
