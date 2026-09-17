# Session handoff — call analysis V2

## Current state

- The evidence-backed call analysis and action pipeline is implemented locally.
- The GHL widget is the canonical UI. The matching dashboard settings and drafts
  routes import the same widget components and do not maintain a separate UI.
- Operational behavior is controlled from the GHL settings screen, with Hebrew
  explanations for every control and explicit warnings for settings that may
  write to GHL.
- Safe launch defaults remain enabled: task mode is `shadow`, and status changes
  are recommendations only.
- The feature has not been pushed, deployed, or migrated in production yet.

## Commits

- `fe05a10` — sales transcript analysis V2 design
- `8597f90` — implementation plan
- `f0d8871` — evidence-backed call action pipeline
- `9f7ca55` — settings and approvals UI

## Verification completed

- Unit suite: 513 passed, 2 expected failures.
- TypeScript typecheck passed.
- Integration suite on a throwaway Neon branch after applying the migration:
  176 passed.
- Production build on a throwaway Neon branch passed.
- Widget settings and call-action approvals were visually checked locally.
- Temporary Neon branches and the temporary local server were removed.

## Production next step

After Eli explicitly approves production rollout:

1. Apply `drizzle/migrations/0003_call_action_candidates.sql` to production.
2. Push the four commits above and deploy.
3. Smoke-test the GHL settings widget, dry preview, pending approvals, and one
   safe shadow-mode call without allowing automatic task or status writes.
4. Keep shadow mode active until reviewed candidates show acceptable precision.

## Unrelated local work

The remaining modified and untracked files shown by `git status` predate this
feature or belong to other work. They were deliberately excluded from the four
commits above and must not be overwritten or bundled into this rollout.
