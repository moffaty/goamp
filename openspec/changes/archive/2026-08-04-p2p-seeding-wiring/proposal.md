## Why

Phase 1 gave the node a content-transfer protocol, but nothing on the desktop uses
it: downloads don't enter the archive and playback never asks a peer. This phase
wires the loop end-to-end so a downloaded track is actually seeded, and playback
tries the P2P network before yt-dlp.

## What Changes

- goamp-node exposes HTTP: `POST /content/provide {track_id, path}` (node reads the
  local file and ProvideContent → archive + DHT) and `GET /content/{track_id}`
  (node.GetContent → audio bytes, or 404). `sdk.Node` gains `ProvideContent`/
  `GetContent` (P2PNode already implements them; the stub no-ops).
- Rust talks to the node: `provide_content(track_id, path)` and a best-effort
  peer-fetch used at resolve time.
- Provide-on-download: after a track saves to disk (#6), it is provided to the node
  (a stable `content_id` = `youtube:<id>` / `soundcloud:<url>`).
- Resolve-on-play: `extract_audio` (YouTube) and `extract_audio_url` (SoundCloud) try
  a peer fetch first; on any miss/error they fall through to yt-dlp unchanged.

## Capabilities

### New Capabilities
- `p2p-seeding-wiring`: desktop⇄node HTTP for providing and fetching track content,
  so downloads seed and playback resolves from peers first.

### Modified Capabilities
<!-- none -->

## Impact

- `goamp-node/sdk/interfaces.go` — Node interface += ProvideContent/GetContent;
  `sdk/node/node.go` stub no-ops.
- `goamp-node/api/content_handlers.go` (new) + routes in `server.go`.
- `src-tauri/src/commands/youtube.rs` — provide-on-download + resolve-on-play hooks +
  a best-effort node-fetch helper.
- `src/youtube/youtube-service.ts` + `SearchOverlay.ts` — pass a stable content id to
  `download_track`.
- Tests: Go content-handler httptest; Rust content-id helper; existing suites green.
- No new deps. // ponytail: auto-seeds every download; an opt-in toggle + ToS gate is
  Phase 3/4.
