/**
 * Deterministic aggregate rollup over the persisted per-lead verdicts.
 *
 * This is the "why aren't 120 leads closing" report — and crucially it is a
 * pure groupby over structured fields, NOT a second LLM pass. Every pattern
 * carries a denominator ("14 of 60 analyzed") and the exact list of supporting
 * leads, so it cannot cherry-pick: a pattern exists iff that many lead verdicts
 * actually carry it.
 */

import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { getObjectionPlay } from "@/lib/sales/objection-playbook.he";
import { matchedSidsSubquery, type LeadFilter } from "./batch";
import type { LeadAnalysis } from "./analyze-lead";

export interface LeadRef {
  sid: string;
  name: string | null;
}
export interface Pattern {
  key: string;
  label: string;
  count: number;
  leads: LeadRef[];
}
export interface AnalysisAggregate {
  total_analyzed: number;
  insufficient: number;
  conclusive: number;
  avg_commitment: number;
  by_blocker: Pattern[];
  by_objection: Pattern[];
  followup_failures: Pattern;
  sample_gaps: Pattern;
}

const BLOCKER_HE: Record<string, string> = {
  price: "מחיר",
  moq: "כמות מינימום",
  sample_trust: "דוגמה/אמון",
  payment_terms: "תנאי תשלום",
  product_mismatch: "מוצר לא מתאים",
  followup_drop: "נפילת מעקב",
  spec_open: "מפרט פתוח",
  wrong_lead: "ליד לא רלוונטי",
  other: "אחר",
};

export async function aggregateAnalyses(
  filter?: LeadFilter
): Promise<AnalysisAggregate> {
  // Latest verdict per lead, optionally scoped to leads matching the filter.
  const scope =
    filter && (filter.stages?.length || filter.dateFrom || filter.dateTo || filter.withCalls)
      ? sql`WHERE a.manychat_sub_id IN (${matchedSidsSubquery(filter)})`
      : sql``;
  const res = await db.execute(sql`
    SELECT DISTINCT ON (a.manychat_sub_id) a.manychat_sub_id, a.verdict
    FROM lead_analyses a
    ${scope}
    ORDER BY a.manychat_sub_id, a.created_at DESC
  `);
  const verdicts = (res.rows as { manychat_sub_id: string; verdict: LeadAnalysis }[]).map(
    (r) => r.verdict
  );

  const total = verdicts.length;
  const conclusiveVerdicts = verdicts.filter((v) => !v.insufficient_data);
  const insufficient = total - conclusiveVerdicts.length;

  const blockerMap = new Map<string, LeadRef[]>();
  const objMap = new Map<string, LeadRef[]>();
  const sampleLeads: LeadRef[] = [];
  let commitmentSum = 0;
  const nameBySid = new Map<string, string | null>();

  for (const v of conclusiveVerdicts) {
    const ref: LeadRef = { sid: v.sid, name: v.name };
    nameBySid.set(v.sid, v.name);
    push(blockerMap, v.primary_blocker, ref);
    // one lead counts once per distinct objection taxonomy key
    const keys = new Set((v.objections ?? []).map((o) => o.taxonomy_key));
    for (const k of keys) push(objMap, k, ref);
    // "asked to see the product" — a signal, NOT a failure. Albadi does not
    // send physical samples by policy; counted regardless of "fulfilled".
    if (v.sample?.asked) sampleLeads.push(ref);
    commitmentSum += v.commitment_scorecard?.score_1_5 ?? 0;
  }

  // Follow-up DROPS — computed DETERMINISTICALLY from the message timeline, not
  // the LLM (which conflated bot messages, missed delivered quotes, and counted
  // "ball in customer's court" as our failure → ~92% false). A real drop = the
  // CUSTOMER sent the last message and it's been >3 days with no reply.
  const followupLeads = await deterministicFollowupDrops([...nameBySid.keys()], nameBySid);

  const by_blocker = toPatterns(blockerMap, (k) => BLOCKER_HE[k] ?? k);
  const by_objection = toPatterns(objMap, (k) => getObjectionPlay(k).label);

  return {
    total_analyzed: total,
    insufficient,
    conclusive: conclusiveVerdicts.length,
    avg_commitment: conclusiveVerdicts.length
      ? Math.round((commitmentSum / conclusiveVerdicts.length) * 10) / 10
      : 0,
    by_blocker,
    by_objection,
    followup_failures: {
      key: "followup_failures",
      label: "נפלנו — לקוח כתב אחרון, 3+ ימים ללא מענה",
      count: followupLeads.length,
      leads: followupLeads,
    },
    sample_gaps: {
      key: "sample_gaps",
      label: "ביקשו לראות מוצר (לטפל בהוכחה ויזואלית)",
      count: sampleLeads.length,
      leads: sampleLeads,
    },
  };
}

const FOLLOWUP_DROP_DAYS = 3;

/** A drop = the customer's message is the latest one and it's been >N days. */
async function deterministicFollowupDrops(
  sids: string[],
  nameBySid: Map<string, string | null>
): Promise<LeadRef[]> {
  if (!sids.length) return [];
  const rows = await db.execute(sql`
    SELECT DISTINCT ON (manychat_sub_id) manychat_sub_id, direction, received_at
    FROM messages
    WHERE manychat_sub_id IN (${sql.join(sids.map((s) => sql`${s}`), sql`, `)})
    ORDER BY manychat_sub_id, received_at DESC
  `);
  const cutoffMs = FOLLOWUP_DROP_DAYS * 86400000;
  const drops: LeadRef[] = [];
  for (const r of rows.rows as { manychat_sub_id: string; direction: string; received_at: unknown }[]) {
    if (
      r.direction === "in" &&
      Date.now() - new Date(r.received_at as string).getTime() > cutoffMs
    ) {
      drops.push({ sid: r.manychat_sub_id, name: nameBySid.get(r.manychat_sub_id) ?? null });
    }
  }
  return drops;
}

function push(m: Map<string, LeadRef[]>, key: string, ref: LeadRef): void {
  const arr = m.get(key) ?? [];
  arr.push(ref);
  m.set(key, arr);
}

function toPatterns(
  m: Map<string, LeadRef[]>,
  labelFor: (k: string) => string
): Pattern[] {
  return [...m.entries()]
    .map(([key, leads]) => ({ key, label: labelFor(key), count: leads.length, leads }))
    .sort((a, b) => b.count - a.count);
}
