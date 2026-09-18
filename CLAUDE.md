@AGENTS.md

# Claude-specific

- Topic files in `docs/agent/` auto-load through the `.claude/rules/*.md`
  symlinks when you read matching paths. If a task spans an area whose file
  did not load, open it from the index above before editing.
- Keep auto-memory (`MEMORY.md`) to one short line per entry and only for what
  the repo does not record; project knowledge belongs in `docs/agent/`.
