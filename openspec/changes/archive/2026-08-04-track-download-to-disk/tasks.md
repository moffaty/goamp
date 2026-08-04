## 1. Backend

- [x] 1.1 `sanitize_filename(artist, title)` pure helper (strip illegal chars, collapse ws, cap len, empty→fallback)
- [x] 1.2 `download_track(app, url, title, artist)` command: resolve URL, Downloads dir, tagged-mp3 then bestaudio fallback, return saved path
- [x] 1.3 Register `download_track` in lib.rs
- [x] 1.4 Rust unit tests for `sanitize_filename`

## 2. Frontend

- [x] 2.1 `youtube-service.ts`: `downloadTrack(item)` (id vs webpage_url per source)
- [x] 2.2 `SearchOverlay`: "⬇ Download" context-menu item with status feedback
- [x] 2.3 TS test: `downloadTrack` picks the right url per source

## 3. Verify

- [x] 3.1 `cargo test` + `pnpm test --run` green; `tsc --noEmit` clean
- [x] 3.2 `openspec validate track-download-to-disk --strict` passes
