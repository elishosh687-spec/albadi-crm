#!/bin/zsh
# Wrapper for the launchd agent com.albadi.inspection-photos.
#
# launchd starts with a bare environment — no PATH, no shell profile, no cwd —
# so everything here is absolute and every credential is loaded explicitly.
# Run it by hand to reproduce exactly what the scheduled job does.
set -u

REPO=/Users/eli/Projects/albadi-crm
NODE_BIN=/Users/eli/.local/node/bin
LOG=/Users/eli/Library/Logs/albadi-inspection-sync.log

export PATH="$NODE_BIN:/usr/bin:/bin:/usr/sbin:/sbin"

cd "$REPO" || exit 1

# FEISHU_APP_ID / FEISHU_APP_SECRET / FEISHU_SHEET_TOKEN
if [ -f "$REPO/.env" ]; then
  set -a; . "$REPO/.env"; set +a
fi

# The Neon connection string is minted per run — never stored on disk.
DATABASE_URL="$("$NODE_BIN/neonctl" connection-string \
  --project-id fragrant-morning-71359670 \
  --org-id org-frosty-star-50411125 2>/dev/null)"
export DATABASE_URL
if [ -z "$DATABASE_URL" ]; then
  echo "[$(date '+%F %T')] ABORT: neonctl returned no connection string (re-auth needed?)" >> "$LOG"
  exit 1
fi

echo "[$(date '+%F %T')] --- sync start ---" >> "$LOG"
"$NODE_BIN/npx" tsx scripts/sync-inspection-photos.ts >> "$LOG" 2>&1
echo "[$(date '+%F %T')] --- exit $? ---" >> "$LOG"

# Keep the log from growing forever: last 2000 lines is months of runs.
tail -n 2000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
