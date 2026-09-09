-- 1. New leads in window: time to first call
SELECT
  count(*) AS new_leads,
  sum((c.first_call IS NOT NULL)::int) AS called,
  round(avg(EXTRACT(EPOCH FROM (c.first_call - l.created_at))/3600) FILTER (WHERE c.first_call IS NOT NULL), 1) AS avg_hours_to_first_call,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (c.first_call - l.created_at))/3600) AS median_hours,
  sum((EXTRACT(EPOCH FROM (c.first_call - l.created_at))/3600 <= 1)::int) AS within_1h,
  sum((EXTRACT(EPOCH FROM (c.first_call - l.created_at))/3600 <= 24)::int) AS within_24h,
  sum((EXTRACT(EPOCH FROM (c.first_call - l.created_at))/3600 > 72)::int) AS over_72h
FROM leads l
LEFT JOIN (SELECT ghl_contact_id, min(call_started_at) AS first_call FROM call_recording_imports GROUP BY 1) c
  ON c.ghl_contact_id = l.ghl_contact_id
WHERE l.created_at >= '2026-06-19';
