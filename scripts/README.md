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
