@AGENTS.md

# Claude-specific

- `.claude/rules/*.md` are short digests that auto-load when you read matching
  paths; each points to its full `docs/agent/` file — read that before
  non-trivial changes. Area not auto-loaded? Open it from the index above.
- Keep auto-memory (`MEMORY.md`) to one short line per entry and only for what
  the repo does not record; project knowledge belongs in `docs/agent/`.
