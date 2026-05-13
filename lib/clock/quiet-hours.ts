// Quiet hours: no customer-side messages between 21:00 and 09:00 in
// Asia/Jerusalem. Uses Intl.DateTimeFormat with the IANA tz so DST is
// handled correctly without bringing in moment-timezone.

const TZ = "Asia/Jerusalem";
const QUIET_START_HOUR = 21;
const QUIET_END_HOUR = 9;

function jerusalemHour(d: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hour: "numeric",
    hour12: false,
  }).formatToParts(d);
  const hourPart = parts.find((p) => p.type === "hour");
  return hourPart ? Number(hourPart.value) : 0;
}

export function isQuietNow(at: Date = new Date()): boolean {
  const h = jerusalemHour(at);
  // [21..24) OR [0..9) is quiet
  return h >= QUIET_START_HOUR || h < QUIET_END_HOUR;
}

export { TZ as JERUSALEM_TZ };
