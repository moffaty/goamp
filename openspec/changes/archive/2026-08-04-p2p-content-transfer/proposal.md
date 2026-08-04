## Why

The P2P core is real and running — libp2p host, Kademlia DHT (Provide/FindProviders),
GossipSub (taste profiles), mDNS, and a catalog stream protocol for remote *search*.
But no track audio ever moves between peers: `archive.Store` is never called, the
app's announce writes only to local SQLite, and there is no protocol to transfer
bytes. This change adds the missing **content layer** so a node can store a track,
announce it to the DHT, and serve/fetch the bytes peer-to-peer.

This is Phase 1 of P2P content seeding (task #8). Later phases wire the desktop app
(ingest downloads, resolve-on-play) and add opt-in/quota UX.

## What Changes

- New libp2p stream protocol `/goamp/content/1.0`: a peer requests a track by id and
  the server streams the audio bytes from its `Archive`.
- Node gains `ProvideContent(trackID, data)` — stores the blob in the `Archive` and
  announces the node as a DHT provider for that id.
- Node gains `GetContent(trackID)` — returns local bytes if present, else looks up
  DHT providers, dials one, and fetches over the content protocol (caching the
  result). Falls back to an error when no seeder has it.
- `node.Config` gains an `Archive`; `main.go` constructs a `LocalArchive` and wires it.

## Capabilities

### New Capabilities
- `p2p-content-transfer`: store/announce a track's audio and fetch it from a peer by
  track id over a dedicated libp2p stream protocol.

### Modified Capabilities
<!-- none — extends the node; catalog search protocol untouched -->

## Impact

- `goamp-node/sdk/node/content_protocol.go` (new) — protocol handler + `FetchContent`
  client + `ProvideContent`/`GetContent`.
- `goamp-node/sdk/node/config.go` — `Archive` field; `p2p_node.go` Start registers the
  protocol when an Archive is present.
- `goamp-node/cmd/goamp-node/main.go` — build + wire `LocalArchive`.
- Tests: two in-process nodes — provide on A, fetch on B returns identical bytes.
- No new deps (libp2p already present). No Rust/TS in this phase.
