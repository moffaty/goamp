## Why

Two archive gaps surfaced while wiring seeding: (1) the track id is used directly as
a filename, but content ids contain `:` and `/` (e.g. `soundcloud:https://…`), which
breaks writes and risks path traversal (`..`); (2) the storage quota is never
enforced or measured across restarts, so seeding could fill the disk. Both must be
fixed before seeding is safe to enable.

## What Changes

- **Safe filenames**: the archive keys files by `sha256(track_id)` hex, so any id is a
  fixed, flat, traversal-proof filename. Fixes SoundCloud content ids and closes the
  traversal risk. **BREAKING** for any files stored under the old raw-id scheme (none
  shipped in practice — seeding was opt-in and SC ids never stored successfully).
- **Quota enforcement**: `New` scans the archive dir to seed `UsedBytes`/count from
  disk; `Store` rejects a write that would exceed a non-zero quota.
- **Stats**: `Stats()` reports current file count and bytes used (for a future UI
  readout).
- **ToS consent**: enabling seeding in the UI first asks for confirmation.

## Capabilities

### New Capabilities
- `p2p-archive-quota`: safe content-addressed archive filenames, quota enforcement,
  usage stats, and an informed-consent gate before seeding is enabled.

### Modified Capabilities
<!-- none -->

## Impact

- `goamp-node/sdk/archive/archive.go` — hashed keys, scan-on-new, quota check, Stats.
- `goamp-node/sdk/archive/archive_test.go` (new).
- `src/webamp/goamp-menu.ts` — confirm() before enabling seeding.
- Tests: Go archive; TS menu consent.
- No new deps (stdlib crypto/sha256).
