export function buildFunnelEventIdentity(input: {
  leadSid: string;
  event: string;
  explicitAttemptId?: string | null;
  stateAttemptId?: string | null;
  explicitEventKey?: string | null;
}): { leadSid: string; attemptId: string; eventKey: string } {
  const leadSid = input.leadSid.trim();
  const attemptId =
    input.explicitAttemptId?.trim() ||
    input.stateAttemptId?.trim() ||
    `legacy:${leadSid}`;
  const eventKey = input.explicitEventKey?.trim() || `${attemptId}:${input.event}`;
  return { leadSid, attemptId, eventKey };
}
