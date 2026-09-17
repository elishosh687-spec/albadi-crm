# Standalone Site and GHL Hub Parity — Implementation Plan

> Approved design: `2026-09-17-standalone-ghl-parity-design.md`

## Task 1: Make widget authentication dual-context

- Add a shared admin-cookie verifier beside the widget-token verifier.
- Extend `widgetAuthed(req)` so every route already using it accepts either the
  widget token or the protected-site cookie.
- Add a server-page helper for widget pages, using `cookies()` and the same
  constant-time credential rules.
- Convert the remaining direct `/api/widget/*` token checks to the shared
  request helper.
- Add unit tests for valid token, valid cookie, invalid credentials, and an
  unset admin password.

## Task 2: Extract one shared Hub shell

- Move the Hub tab registry and shell markup to one shared server component.
- Give it only two context inputs: `widget` or `standalone`, plus active tab and
  optional lead `sid`.
- In widget mode, links and iframe URLs carry the existing widget token.
- In standalone mode, links stay under `/` and iframe URLs carry no token.
- Keep the exact same tab order, labels, icons, styling, and iframe contents.

## Task 3: Replace the standalone dashboard entry

- Render the shared Hub directly from `/` after middleware authentication.
- Remove the root rewrite to `/dashboard/v3`.
- Change the post-login default destination to `/` and constrain `from` to a
  local path.
- Redirect `/dashboard`, `/dashboard/v3`, and old dashboard deep links to the
  matching shared Hub tab.

## Task 4: Let every Hub tab run under the site login

- Change widget page guards from token-only checks to the shared page guard.
- Preserve token-only behavior for GHL visitors without the admin cookie.
- Verify that same-origin iframe requests naturally carry the HTTP-only admin
  cookie for APIs and `/api/factory/*` writes.

## Task 5: Lock parity with tests

- Add an architecture test asserting that both entry routes import the shared
  Hub shell and that dashboard routes do not render independent UI.
- Extend route-gate coverage as needed for the dual-context helper.
- Run typecheck, unit tests, targeted integration route-gate tests, and build.

## Task 6: Smoke-check and deploy

- Launch the app locally with the existing data-safe configuration.
- Check login, `/`, representative read/write tabs, tab persistence, `sid`, and
  mobile width.
- Check `/widget/hub` independently with widget authentication.
- Commit only task-related files, push to `main`, verify Vercel deployment, and
  smoke-check both production entry points.

## Deferred cleanup

Delete unreachable legacy dashboard implementation files only after production
parity is confirmed. Until then they remain rollback material and are not a
second user-facing implementation because every dashboard URL redirects away.
