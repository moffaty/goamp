## Why

SoundCloud support was track-search only (`scsearch`), so you could not pull a
whole album/set as a playlist — the thing users actually want ("give me this
3.5-hour album"). Albums are also re-uploaded across many SoundCloud profiles, so
searching one artist page misses them. Importing by pasting the set URL solves both.

## What Changes

- New Rust command `import_playlist(url)` resolves any yt-dlp-supported playlist/set
  URL to a full tracklist WITH durations (non-flat `--dump-json`; SoundCloud sets
  return nothing usable under `--flat-playlist`). Source is inferred from the URL
  host, so cross-profile re-uploads import identically.
- The search overlay treats a pasted album/set/playlist URL as an import: it shows
  every track, the total duration (e.g. "33 tracks • 3h 28m"), and a "Queue all".
- "Queue all": YouTube tracks append instantly via the lazy `goampaudio://` scheme;
  SoundCloud tracks eager-extract (same path as a single-track add today).
- The yt-dlp entry parsing in `search_youtube` is extracted into a shared, pure
  helper reused by search and import.

## Capabilities

### New Capabilities
- `album-import`: import a playlist/album/set by URL into the search view as a
  playable, queue-able tracklist with total duration.

### Modified Capabilities
<!-- none — SoundCloud track search already existed; this adds set import beside it -->

## Impact

- `src-tauri/src/commands/youtube.rs` — `import_playlist` command + pure `infer_source`
  / `parse_entry` / `parse_entries` helpers (search refactored onto them).
- `src-tauri/src/lib.rs` — register `import_playlist`.
- `src/youtube/youtube-service.ts` — `importPlaylist`, `isPlaylistUrl`.
- `src/youtube/SearchOverlay.ts` — URL → import branch, total duration, Queue all,
  placeholder hint.
- Tests: Rust `youtube` unit tests; `youtube-service.test.ts`, `SearchOverlay.test.ts`.
- Reuses yt-dlp (already a dependency). No new deps, no Go.
