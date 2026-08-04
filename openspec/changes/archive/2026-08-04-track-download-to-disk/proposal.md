## Why

Playing a YouTube/SoundCloud track only fills the internal app cache with
hash-named files — there is no way to keep a track as a real, named audio file the
user owns. "Download" (Скачать) closes that: save the track to the OS Downloads
folder as `Artist - Title.ext`. This is also the first step toward P2P seeding
(a real owned file to share) — see the seeding task.

## What Changes

- New Rust command `download_track(url, title, artist)` saves a track to the OS
  Downloads dir as a human-named audio file and returns the saved path. Works for
  both sources (YouTube id or SoundCloud/any page URL). Tries a tagged mp3
  (`-x --embed-metadata --embed-thumbnail`, needs ffmpeg) and falls back to raw
  bestaudio when ffmpeg is absent.
- Filename is sanitized (`Artist - Title`, illegal chars stripped, length-capped).
- The search context menu gains a "⬇ Download" action; a service wrapper routes it
  (YouTube → id, SoundCloud → webpage_url).

## Capabilities

### New Capabilities
- `track-download`: save a searched/played track to the user's Downloads folder as a
  named audio file.

### Modified Capabilities
<!-- none -->

## Impact

- `src-tauri/src/commands/youtube.rs` — `download_track` command + pure
  `sanitize_filename` helper; reuses run_ytdlp/find_cached_file/cookies_args.
- `src-tauri/src/lib.rs` — register `download_track`.
- `src/youtube/youtube-service.ts` — `downloadTrack(item)`.
- `src/youtube/SearchOverlay.ts` — "⬇ Download" context-menu item.
- Tests: Rust sanitize unit tests; TS service wrapper.
- Reuses yt-dlp. No new deps, no Go.
