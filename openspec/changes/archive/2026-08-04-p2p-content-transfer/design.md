## Approach

Mirror the existing `/goamp/catalog/1.0` stream protocol, but for raw bytes. No
protobuf message needed (avoids regenerating pb.go): the wire format is trivial.

## Wire protocol `/goamp/content/1.0`

- Client: open stream → write the track id (UTF-8) → `CloseWrite()` → `io.ReadAll` =
  the audio bytes.
- Server handler: `io.ReadAll` (client's CloseWrite delimits the id) → `id` →
  `Archive.Retrieve(id)` → write bytes → `Close`. On a miss/error, write nothing and
  close: the client then reads zero bytes = "not held".
  // ponytail: 0 bytes = miss; no status frame. Add a 1-byte status if we later need
  to distinguish empty file from error.

## Node methods

- `ProvideContent(ctx, trackID, data)`: `Archive.Store(id, data)` then announce to the
  DHT via the existing `Announce(ctx, id)` (`kadDHT.Provide`).
- `FetchContent(ctx, peerID, trackID) ([]byte, error)`: the client half above.
- `GetContent(ctx, trackID) ([]byte, error)`:
  1. `Archive.Retrieve(id)` — return it if present (no network).
  2. else `FindProviders(id)` (DHT); for each provider, `host.Connect` then
     `FetchContent`; first non-empty result wins; cache it via `Archive.Store` and
     return.
  3. no provider / all empty → error.

## Wiring

- `node.Config.Archive sdk.Archive` (optional, like `Catalog`).
- `p2p_node.go` Start: `if n.cfg.Archive != nil { n.registerContentProtocol() }`.
- `main.go`: `arch := archive.New(cfg.Archive.StoragePath, cfg.Archive.QuotaGB)` (or
  the existing constructor signature) and pass `Archive: arch` into `node.Config`.

## Testing (Go, in-process)

`content_protocol_test.go`: two `P2PNode`s with temp-dir `LocalArchive`s, connect B→A
via `host.Peerstore().AddAddrs` + `host.Connect`. Assert:
- A.ProvideContent(id, data); B.FetchContent(A.ID(), id) == data.
- B.FetchContent for an unknown id → empty.
- A.GetContent(id) after providing returns local bytes (no dial).
DHT FindProviders across a real network is covered by libp2p itself; the unit test
exercises the protocol + provide/local paths deterministically.
