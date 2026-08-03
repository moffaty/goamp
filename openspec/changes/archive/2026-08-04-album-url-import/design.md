## Approach

Reuse the existing yt-dlp plumbing. The only new backend surface is one command +
pure parse helpers; the frontend adds a URL branch to the search overlay.

## Backend (commands/youtube.rs)

- Extract the per-line closure in `search_youtube` into pure fns:
  - `parse_entry(line, src) -> Option<YoutubeResult>` (drops SoundCloud ≤31s previews)
  - `parse_entries(stdout, src) -> Vec<YoutubeResult>`
  - `infer_source(url) -> "soundcloud" | "youtube"` (host match)
- `import_playlist(app, url)`: `yt-dlp <url> --dump-json --no-warnings --ignore-errors`
  (NOT `--flat-playlist` — SoundCloud sets return no metadata when flat). Parse stdout
  regardless of exit code; error only when zero tracks. // ponytail: non-flat resolves
  each track, ~seconds for an album; a flat+lazy-duration path is a future optimization.

## Frontend

- `youtube-service.ts`: `importPlaylist(url)` (invoke) + `isPlaylistUrl(s)` (http(s) and
  one of `/sets/`, `list=`, `/playlist`).
- `SearchOverlay.doSearch`: if `isPlaylistUrl(query)` → `doImport`, else existing search.
- `doImport`: call `importPlaylist`, render rows via the existing pager, then
  `renderImportSummary` → status "`N tracks • <total> • [Queue all]`".
- `queueAll`: per track, YouTube → `convertFileSrc(id, 'goampaudio')` appended instantly
  (lazy stream); SoundCloud → `extractForItem` (eager cache file) then append.
  // ponytail: SC eager because goampaudio:// is YouTube-only (extract_audio builds a
  youtube URL, caches by id); a source-aware scheme would make SC albums instant too.
- Placeholder hints "or paste an album URL".

## Testing

- Rust: `infer_source`, `parse_entry` (metadata + preview drop, YouTube keeps 30s),
  `parse_entries` (sums a set, skips blank/garbage lines). Pure — no yt-dlp needed.
- TS: `isPlaylistUrl` cases; `importPlaylist` invoke wrapper; SearchOverlay — pasting a
  set URL imports (not searches) and shows total duration + Queue all.
- Live: verified `soundcloud.com/sofiya-chernyak-646218391/sets/koroli-abstrakta-vi`
  resolves to 33 tracks / 3h 28m via yt-dlp 2026.03.17.
