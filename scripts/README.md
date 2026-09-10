# scripts/

Maintenance CLIs run with `npx tsx scripts/<name>.ts`. Anything touching the DB
needs the live connection string:

```bash
DATABASE_URL="$(~/.local/node/bin/neonctl connection-string --project-id fragrant-morning-71359670 --org-id org-frosty-star-50411125)" npx tsx scripts/<name>.ts
```

## Convention

| Prefix | Meaning |
|---|---|
| `name.ts` | a reusable tool (backfill, seed, migrate, audit, `team.ts`, `deal-file.ts`) |
| `_name.ts` | a one-off scratch script — diagnostics, a single repair, a test harness. Kept in place **only while something references it** (CLAUDE.md, docs, a memory, another script) |
| `_archive/` | scratch scripts nothing references any more. Kept for the recipe, not to run — they assume the DB shape of their day |

When a scratch script stops being referenced, move it to `_archive/`. When a
scratch script turns out to be needed repeatedly, drop the underscore and give
it a `--dry-run`.

Every script that writes should print a dry run by default and require `--go`
(or `--confirm`) to write — the pattern in `_seed-eli-test-demo.ts`.

## Superseded by tests (2026-09-10)

Several scratch harnesses were `console.log` test suites; their cases now live
as vitest files next to the module and run in CI (`npm test`):

| Script | Test |
|---|---|
| `_archive/_test-cadence.ts` | `lib/autoresponder/followup-cadence.test.ts` |
| `_archive/_check-pause-guard.ts` | `lib/autoresponder/bot-pause.test.ts` |
| `_archive/_test-slots.ts` | `lib/setter/slots.test.ts` |
| `_archive/_test-setter-fixes.ts` / `_test-setter-routing.ts` | `lib/setter/validate.test.ts` |
| `_verify-air-volumetric.ts`, `_verify-thermal.ts` §② | `lib/factory/pricing.test.ts` |
| `_verify-lamination-gradient.ts`, `_verify-lamination-colors.ts` | `lib/factory/calculator/engine.test.ts` |

New assertion-style checks belong in a `*.test.ts`, not in a new `_verify-*.ts`.
The DB-driven diagnostics (`_cbm-accuracy`, `_validate-real-quote`, …) stay
scripts — they read live rows and print statistics, not expected values.
