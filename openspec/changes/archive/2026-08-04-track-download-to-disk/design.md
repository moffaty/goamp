## Approach

One Rust command + a pure sanitize helper; reuse existing yt-dlp plumbing. Frontend
adds a context-menu item and a thin service wrapper.

## Backend (commands/youtube.rs)

- `sanitize_filename(artist, title) -> String` (pure):
  - stem = `"{artist} - {title}"` (or just title / just artist when one is empty).
  - remove `/ \ : * ? " < > |` and control chars; collapse whitespace; trim.
  - cap to ~120 chars; if empty after all that, fall back to `"track"`.
- `download_track(app, url, title, artist) -> Result<String, String>`:
  - resolve the page URL: `url` as-is if it contains `://`, else a YouTube watch URL
    (mirrors extract_audio_stream_url).
  - dest dir: `app.path().download_dir()` (fallback to temp dir).
  - out template: `{dir}/{stem}.%(ext)s`.
  - primary: `-x --audio-format mp3 --audio-quality 5 --embed-metadata
    --embed-thumbnail --no-playlist --no-warnings` (tagged mp3 when ffmpeg present).
  - fallback on non-zero: `-f bestaudio --no-playlist --no-warnings` (raw). // ponytail:
    two-pass mirrors extract_audio; no probing ffmpeg up front.
  - locate the produced file by stem (reuse find_cached_file over the dest base);
    return its path, else error.

## Frontend

- `youtube-service.ts`: `downloadTrack(item)` → `invoke('download_track', { url, title, artist })`
  with `url = item.source === 'youtube' ? item.id : (item.webpage_url || item.id)`.
- `SearchOverlay` context menu: add "⬇ Download" between "Play now" and playlist add;
  status shows "Downloading…" then "Saved: <name>" or the error.

## Testing

- Rust: `sanitize_filename` — strips illegal chars, collapses spaces, caps length,
  empty→fallback, one-sided metadata. Pure, no yt-dlp.
- TS: `downloadTrack` invoke wrapper picks id vs webpage_url per source.
- The actual yt-dlp download needs the binary + network — not unit-tested (same as
  extract_audio).
