---
paths:
  - "tests/**"
  - "**/*.test.ts"
  - "vitest.config.mts"
  - ".github/workflows/test.yml"
---

# Tests
- `npm test` (unit), `npm run test:watch`, `npm run typecheck`, `npm run test:integration`; config `vitest.config.mts`. Tests sit next to their module; architecture tests in `tests/unit/architecture/`.
- An incident with a "symptom to watch" gets a regression test in the same commit.
- Unit tests have no DB: `tests/setup.unit.ts` replaces `@/lib/db` with a throwing Proxy. Fixtures use `lib/factory/config-defaults.ts` / `estimator-defaults.ts`, never `config.ts`; never import `lib/factory/calculator/index.ts` (use `calculator/constants.ts`).
- Integration `DATABASE_URL` must be a throwaway Neon branch; `tests/setup.integration.ts` refuses prod. Only external edges are stubbed; `BRIDGE_DRY_RUN=1` forced; seed own `test:ci-*` rows, never print customer data.
- `tests/integration/route-gates.test.ts`: every `app/api/**/route.ts` must be in exactly one bucket (`bearer` / `own-gate` / `middleware` / `public` with a reason / `unprotected` as `it.fails`); a new unmatched route fails coverage.
- `/api/integrations/outbound` fails CLOSED without `GHL_OUTBOUND_SECRET`; rotate it in Vercel and the GHL provider Delivery URL together, GHL first.
- Integration aliases `@/lib/messaging` to `tests/shims/messaging.ts`; `MANYCHAT_TOKEN` must stay set (`lib/manychat/config.ts` throws at import).
- CI (`.github/workflows/test.yml`) informs, does not gate deploys; red `main` alerts via `/api/admin/ci-alert`. Integration job needs `NEON_API_KEY`, not run on PRs.
- An `it.fails` is a known finding; when fixed it "fails" by passing — drop `.fails`.
- `npm run lint` is dead; `scripts/` is not type-checked or tested; LLM output is not unit-tested.

Full detail: `docs/agent/testing.md` — read it before non-trivial changes here.
