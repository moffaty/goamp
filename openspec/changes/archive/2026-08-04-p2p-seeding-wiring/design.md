## content_id scheme

Stable, cross-peer, computed the same on both sides:
- YouTube: `youtube:<videoId>`
- SoundCloud: `soundcloud:<webpageUrl>`

## Go

- `sdk.Node` += `ProvideContent(ctx, id, data) error`, `GetContent(ctx, id) ([]byte, error)`.
  `P2PNode` already satisfies these; `LocalNode` stub: provide no-op nil, get returns error.
- `api/content_handlers.go`:
  - `POST /content/provide` body `{track_id, path}` → `os.ReadFile(path)` → `node.ProvideContent` → 204. (path, not bytes: node + desktop share the machine.)
  - `GET /content/{track_id}` → `node.GetContent` → 200 audio/octet-stream, or 404 on empty/error.
- Register both routes in `server.go`.
- Test: `content_handlers_test.go` — `fakeNode{ sdk.Node; store map }` overriding the two methods; provide reads a temp file; get returns bytes / 404.

## Rust (commands/youtube.rs)

- `fn content_id(source, native) -> String`. Pure, tested.
- `async fn node_provide(track_id, path)` → best-effort `POST http://localhost:7472/content/provide` (errors swallowed).
- `async fn node_fetch(app, content_id, dest_base) -> Option<String>`: `GET /content/{id}`; on 200 write bytes to `dest_base.opus`, return path; else None. Short timeout.
- `download_track` gains a `track_id` param; after saving, spawn `node_provide(track_id, path)`.
- Resolve-on-play, at the top of `extract_audio` (id → `youtube:{id}`, dest cache/{id}) and
  `extract_audio_url` (url → `soundcloud:{url}`, dest cache/{hash}): `if let Some(p) = node_fetch(...).await { return Ok(p) }` before yt-dlp. Fallthrough on None.

## Frontend

- `downloadTrack(item)` passes `track_id = content_id(item)` to `download_track`.
- `content_id(item)` in the service: `youtube:<id>` or `soundcloud:<webpage_url>`.

## Testing

- Go: httptest provide (temp file) + get (hit/404).
- Rust: `content_id` unit; the fetch/provide network paths are best-effort and fall
  through — the no-node path (returns None / swallows) is what unit/normal runs hit.
- Real peer transfer needs two app instances — out of unit scope (Phase 1 proved the
  node protocol).
