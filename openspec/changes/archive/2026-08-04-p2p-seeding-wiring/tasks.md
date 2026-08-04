## 1. Go node HTTP

- [x] 1.1 `sdk.Node` += ProvideContent/GetContent; `LocalNode` stub no-ops
- [x] 1.2 `api/content_handlers.go`: POST /content/provide {track_id,path}, GET /content/{id}
- [x] 1.3 Register both routes in server.go
- [x] 1.4 `content_handlers_test.go` (httptest): provide temp file, get hit + 404

## 2. Rust

- [x] 2.1 `content_id(source, native)` pure helper + test
- [x] 2.2 `node_provide(track_id, path)` + `node_fetch(app, id, dest) -> Option<String>` (best-effort, short timeout)
- [x] 2.3 `download_track` gains `track_id`; provide after save
- [x] 2.4 Resolve-on-play hooks in `extract_audio` + `extract_audio_url` (fetch first, fall through)

## 3. Frontend

- [x] 3.1 `downloadTrack` passes content id; `content_id(item)` helper + test

## 4. Verify

- [x] 4.1 `go build/test/vet`, `cargo test`, `pnpm test --run`, `tsc --noEmit` green
- [x] 4.2 `openspec validate p2p-seeding-wiring --strict` passes
