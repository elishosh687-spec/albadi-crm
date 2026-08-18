/**
 * Scratch — the outbound auth gate sits in front of live customer messages
 * (tens a day). Prove all three states before shipping it.
 */
function secretMatches(given: string, expected: string): boolean {
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

type Req = { query?: string; header?: string };
function checkAuth(req: Req, envSecret?: string) {
  const expected = envSecret?.trim();
  if (!expected) return { ok: true, mode: "unconfigured" as const };
  const fromQuery = req.query?.trim() ?? "";
  const fromHeader = (req.header ?? "").replace(/^Bearer\s+/i, "").trim();
  const given = fromQuery || fromHeader;
  if (given && secretMatches(given, expected)) return { ok: true, mode: "verified" as const };
  return { ok: false as const };
}

const S = "s3cret-value-abc";
const cases: [string, ReturnType<typeof checkAuth>, boolean][] = [
  ["unset env, no secret sent → ALLOW (today's live traffic keeps working)",
    checkAuth({}, undefined), true],
  ["unset env, random secret sent → ALLOW",
    checkAuth({ query: "whatever" }, ""), true],
  ["set env, correct query secret → ALLOW",
    checkAuth({ query: S }, S), true],
  ["set env, correct bearer header → ALLOW",
    checkAuth({ header: `Bearer ${S}` }, S), true],
  ["set env, no secret → DENY",
    checkAuth({}, S), false],
  ["set env, wrong secret → DENY",
    checkAuth({ query: "wrong-value-abcd" }, S), false],
  ["set env, right prefix wrong tail → DENY",
    checkAuth({ query: "s3cret-value-abd" }, S), false],
  ["set env, truncated secret → DENY",
    checkAuth({ query: "s3cret" }, S), false],
  ["set env, empty query falls through to header → ALLOW",
    checkAuth({ query: "", header: `Bearer ${S}` }, S), true],
];

let fails = 0;
for (const [label, got, wantOk] of cases) {
  const pass = got.ok === wantOk;
  if (!pass) fails++;
  console.log(`${pass ? "✅" : "❌"} ${label}  →  ${got.ok ? `allow (${(got as any).mode})` : "deny"}`);
}
console.log(fails === 0 ? "\n✅ auth gate correct in all states" : `\n❌ ${fails} failures`);
process.exit(fails === 0 ? 0 : 1);
