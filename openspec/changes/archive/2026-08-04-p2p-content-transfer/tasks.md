## 1. Content protocol

- [x] 1.1 `content_protocol.go`: `ContentProtocolID = "/goamp/content/1.0"` + `registerContentProtocol()` handler (read id → Archive.Retrieve → stream bytes)
- [x] 1.2 `FetchContent(ctx, peerID, trackID) ([]byte, error)` client half
- [x] 1.3 `ProvideContent(ctx, trackID, data)` = Archive.Store + DHT Announce
- [x] 1.4 `GetContent(ctx, trackID)` = local Retrieve → else FindProviders → dial → FetchContent → cache

## 2. Wiring

- [x] 2.1 `Config.Archive sdk.Archive`; register content protocol in Start when present
- [x] 2.2 `main.go`: construct LocalArchive and pass into node.Config

## 3. Verify

- [x] 3.1 Two-node test: provide on A → fetch on B equals bytes; unknown id → empty; local GetContent no-dial
- [x] 3.2 `go build ./...` + `go test ./...` green; `go vet` clean
- [x] 3.3 `openspec validate p2p-content-transfer --strict` passes
