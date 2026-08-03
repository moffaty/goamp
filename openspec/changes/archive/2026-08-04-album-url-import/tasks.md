## 1. Backend

- [x] 1.1 Extract `infer_source` / `parse_entry` / `parse_entries` pure helpers; refactor `search_youtube` onto them
- [x] 1.2 Add `import_playlist(app, url)` command (non-flat dump-json, source inferred, error on zero tracks)
- [x] 1.3 Register `import_playlist` in lib.rs
- [x] 1.4 Rust unit tests: source inference, entry parse + preview drop, set summing

## 2. Frontend

- [x] 2.1 `youtube-service.ts`: `importPlaylist` + `isPlaylistUrl`
- [x] 2.2 `SearchOverlay`: URL → import branch, total duration, Queue all, placeholder hint
- [x] 2.3 TS tests: service wrappers + overlay import path

## 3. Verify

- [x] 3.1 `cargo test` + `pnpm test --run` green; `tsc --noEmit` clean
- [x] 3.2 Live: real SoundCloud set resolves (33 tracks / 3h 28m)
- [x] 3.3 `openspec validate album-url-import --strict` passes
