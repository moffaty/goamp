# My Tasks — P2P Node Plan 2 (TDD)

Goal: replace `LocalNode` stub with real libp2p host, DHT, GossipSub.

**Phase A** — write all tests first (all red/failing).  
**Phase B** — implement to make them pass (all green).

---

## Phase A — Tests

### A1 — Host tests (`sdk/node/host_test.go`)

- [ ] Two in-process hosts discover each other via mDNS → `Peers()` returns each other
- [ ] `Stop()` closes host cleanly, second call is a no-op
- [ ] `ID()` returns non-empty peer.ID
- [ ] `Emit(event)` delivers event to registered handler

### A2 — DHT tests (`sdk/node/dht_test.go`)

- [ ] Node A announces trackID → node B calls `FindProviders(trackID)` → returns node A's peer.ID
- [ ] `FindProviders` on unknown trackID returns empty slice, no error
- [ ] Announce is idempotent (calling twice does not error)

### A3 — GossipSub tests (`sdk/node/pubsub_test.go`)

- [ ] Node A publishes `proto.TasteProfile` → node B receives it, `StorePeer` is called with correct hash
- [ ] Malformed message is silently dropped, no panic
- [ ] `profile:synced` event is emitted after successful receive

### A4 — Catalog protocol tests (`sdk/node/catalog_protocol_test.go`)

- [ ] Node A registers catalog protocol, node B opens stream and sends `proto.SearchRequest` → receives `proto.SearchResponse` with results
- [ ] Empty query returns empty results, no error
- [ ] Stream is closed cleanly after response

### A5 — Integration smoke test (`sdk/node/integration_test.go`)

- [ ] Full stack: two `P2PNode` instances start, connect, A announces track, B finds providers, A publishes profile, B stores it
- [ ] `curl localhost:7472/health` equivalent: `GET /health` returns `peer_count >= 1` when a peer is connected

---

## Phase B — Implementation

### B1 — libp2p Host (`sdk/node/host.go`)

- [ ] `P2PNode` struct implementing `sdk.Node`
- [ ] Build host: ed25519 key from `identity.LoadOrGenerate`, TCP + QUIC transports
- [ ] Attach mDNS discovery
- [ ] Wire `host.Network().Notify(...)` → emit `peer:connected` / `peer:disconnected`
- [ ] Implement `ID()`, `Peers()`, `RegisterProtocol()`, `Emit()`, `Start()`, `Stop()`

### B2 — Kademlia DHT (`sdk/node/dht.go`)

- [ ] Init `dht.New(ctx, host, dht.ModeServer)`
- [ ] `Announce(trackID)` → `dht.Provide(CID(trackID))`
- [ ] `FindProviders(trackID)` → `dht.FindProviders(CID(trackID))`
- [ ] Connect to bootstrap peers on `Start`

### B3 — GossipSub (`sdk/node/pubsub.go`)

- [ ] Init `pubsub.NewGossipSub(ctx, host)`
- [ ] Subscribe to `/goamp/profiles/1.0`, deserialize `proto.TasteProfile`, call `StorePeer`
- [ ] `PublishProfile(profile)` → marshal + publish
- [ ] Emit `profile:synced` event on receive

### B4 — Catalog Stream Protocol (`sdk/node/catalog_protocol.go`)

- [ ] Protocol ID: `/goamp/catalog/1.0`
- [ ] `Handle(stream)`: read `proto.SearchRequest` → `Catalog.Search` → write `proto.SearchResponse`
- [ ] Register on `P2PNode.Start`

### B5 — Wire `cmd/goamp-node/main.go`

- [ ] Replace stub `node.New(...)` with `P2PNode`
- [ ] Pass DHT catalog and GossipSub pubsub into `api.New`
- [ ] `go build ./...` clean

---

## Done check

```bash
cd goamp-node
go test ./...   # all green
go build ./...  # clean
```

Once all green → start **Plan 3** (plugin protocol, archive replication, recommendations over GossipSub).
