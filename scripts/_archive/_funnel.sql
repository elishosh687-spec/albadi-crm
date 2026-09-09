WITH calls AS (
  SELECT ghl_contact_id,
    count(*) AS attempts,
    sum((status <> 'no_answer')::int) AS answered,
    sum((call_duration_sec >= 120)::int) AS meaningful,
    min(call_started_at) AS first_call,
    max(call_started_at) AS last_call,
    max(call_duration_sec) AS max_dur
  FROM call_recording_imports
  WHERE call_started_at >= '2026-06-19'
  GROUP BY 1
),
quotes AS (
  SELECT lead_sid, count(*) AS quotes, min(sent_at) AS first_quote, max(sent_at) AS last_quote
  FROM bot_quotes GROUP BY 1
),
msgs AS (
  SELECT manychat_sub_id,
    max(received_at) FILTER (WHERE sender='lead') AS last_lead_msg,
    max(received_at) FILTER (WHERE sender IN ('bot','eli')) AS last_our_msg,
    count(*) FILTER (WHERE sender='lead') AS lead_msgs,
    count(*) FILTER (WHERE sender='eli') AS eli_msgs,
    count(*) FILTER (WHERE sender='bot') AS bot_msgs
  FROM messages GROUP BY 1
),
tasks AS (
  SELECT manychat_sub_id, count(*) FILTER (WHERE status NOT IN ('completed','deleted')) AS open_tasks
  FROM crm_tasks GROUP BY 1
)
SELECT
  count(*) AS leads_touched,
  sum((c.attempts IS NOT NULL)::int) AS called,
  sum(coalesce(c.attempts,0)) AS total_attempts,
  sum(coalesce(c.answered,0)) AS total_answered,
  sum((c.answered > 0)::int) AS leads_answered,
  sum((c.meaningful > 0)::int) AS leads_meaningful,
  sum((q.quotes > 0)::int) AS leads_quoted,
  sum((t.open_tasks > 0)::int) AS leads_with_open_task,
  sum((m.last_lead_msg > m.last_our_msg)::int) AS awaiting_our_reply,
  sum((m.last_our_msg > m.last_lead_msg AND now()-m.last_our_msg > interval '3 days')::int) AS ghosted_3d
FROM leads l
LEFT JOIN calls c ON c.ghl_contact_id = l.ghl_contact_id
LEFT JOIN quotes q ON q.lead_sid = l.manychat_sub_id
LEFT JOIN msgs m ON m.manychat_sub_id = l.manychat_sub_id
LEFT JOIN tasks t ON t.manychat_sub_id = l.manychat_sub_id
WHERE l.created_at >= '2026-06-19' OR c.ghl_contact_id IS NOT NULL;
