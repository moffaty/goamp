## Why

Phase 2 auto-seeds every downloaded track to the P2P network. Re-distributing
audio must be a deliberate, informed choice — seeding SHALL be opt-in and OFF by
default. This closes the "auto-seeding copyrighted audio" gap.

## What Changes

- New setting `p2p_seed_enabled` (default OFF). `download_track` only seeds
  (`node_provide`) when it is on.
- Commands `set_seed_enabled(bool)` / `get_seed_enabled() -> bool`.
- A "Seed downloads (P2P)" checkbox in the context menu reflects and toggles it.

## Capabilities

### New Capabilities
- `p2p-seed-optin`: user-controlled, default-off gate for seeding downloaded tracks.

### Modified Capabilities
<!-- none -->

## Impact

- `src-tauri/src/commands/youtube.rs` — setting gate in `download_track` +
  `set_seed_enabled`/`get_seed_enabled` + pure `parse_seed_enabled` helper.
- `src-tauri/src/lib.rs` — register the two commands.
- `src/youtube/seeding-service.ts` (new) — typed getters/setters.
- `src/webamp/goamp-menu.ts` — checkbox item (cached state, toggles + persists).
- Tests: Rust `parse_seed_enabled`; TS service wrappers + menu item.
- Quota enforcement + shared-count readout deferred (Phase 3b). No new deps.
