# launchd agents (Eli's Mac only)

These jobs do work the CRM cannot: they write to the local disk. Vercel has no
access to it, so anything that files photos or documents into
`content/albadi/customers/` has to run here.

## com.albadi.inspection-photos

Daily at **10:00 local**, syncs the factory inspection photos from the Feishu
"ALBADI ORDER FOLLOW" sheet into each customer's folder. See
[../sync-inspection-photos.ts](../sync-inspection-photos.ts).

The plist here is a copy for review; the live one is at
`~/Library/LaunchAgents/com.albadi.inspection-photos.plist`.

```bash
# install / reinstall
cp scripts/launchd/com.albadi.inspection-photos.plist ~/Library/LaunchAgents/
launchctl bootout  gui/$(id -u)/com.albadi.inspection-photos 2>/dev/null
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.albadi.inspection-photos.plist

# run it now, without waiting for 10:00
launchctl kickstart -p gui/$(id -u)/com.albadi.inspection-photos

# did it run, and did it work
launchctl print gui/$(id -u)/com.albadi.inspection-photos | grep -E "runs|last exit"
tail -20 ~/Library/Logs/albadi-inspection-sync.log

# stop it permanently
launchctl bootout gui/$(id -u)/com.albadi.inspection-photos
rm ~/Library/LaunchAgents/com.albadi.inspection-photos.plist
```

**`RunAtLoad` is deliberately off** — reinstalling the agent shouldn't kick off
a sync. A run missed because the Mac was asleep fires shortly after it wakes.

**Credentials are never stored in the plist.** The wrapper sources `.env` for
the Feishu keys and mints the Neon connection string per run with `neonctl`.
If `neonctl` ever loses its login the wrapper aborts with a clear line in the
log rather than running against nothing.

Two logs: `albadi-inspection-sync.log` is the script's own output (trimmed to
2000 lines); `albadi-inspection-sync.err.log` catches anything that dies before
the script starts — if the sync seems dead and the first log is silent, read
the second one.
