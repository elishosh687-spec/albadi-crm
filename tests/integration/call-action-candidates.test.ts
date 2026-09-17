import { afterAll, describe, expect, it } from "vitest";
import { ciId, sql } from "./_db";

const key = ciId("call-action-candidate");

afterAll(async () => {
  await sql(`DELETE FROM call_action_candidates WHERE idempotency_key = $1`, [key]);
});

describe("call_action_candidates migration", () => {
  it("persists the original proposal and enforces idempotency", async () => {
    const proposal = {
      action: {
        actionType: "callback",
        description: "test-only callback",
        responsibleParty: "salesperson",
        dueAt: "2026-09-18T07:00:00.000Z",
        confidence: 0.91,
        evidence: { quote: "test quote", validation: "valid" },
      },
      resolvedDueAt: "2026-09-18T07:00:00.000Z",
    };
    await sql(
      `INSERT INTO call_action_candidates
       (source, source_record_id, analysis_version, input_hash, proposal,
        original_proposal, policy_decision, decision_reason, status,
        execution_status, idempotency_key)
       VALUES ($1,$2,$3,$4,$5::jsonb,$5::jsonb,$6,$7,$8,$9,$10)`,
      [
        "ghl",
        ciId("source-call"),
        "2.0",
        ciId("input-hash"),
        JSON.stringify(proposal),
        "needs_approval",
        "shadow_mode",
        "pending",
        "not_requested",
        key,
      ],
    );

    await expect(
      sql(
        `INSERT INTO call_action_candidates
         (source, source_record_id, analysis_version, input_hash, proposal,
          original_proposal, policy_decision, decision_reason, status,
          execution_status, idempotency_key)
         VALUES ('ghl','duplicate','2.0','duplicate','{}'::jsonb,'{}'::jsonb,
          'needs_approval','shadow_mode','pending','not_requested',$1)`,
        [key],
      ),
    ).rejects.toThrow();

    const rows = (await sql(
      `SELECT proposal, original_proposal, status, execution_status
       FROM call_action_candidates WHERE idempotency_key = $1`,
      [key],
    )) as Array<{
      proposal: typeof proposal;
      original_proposal: typeof proposal;
      status: string;
      execution_status: string;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].proposal).toEqual(proposal);
    expect(rows[0].original_proposal).toEqual(proposal);
    expect(rows[0]).toMatchObject({ status: "pending", execution_status: "not_requested" });
  });
});
