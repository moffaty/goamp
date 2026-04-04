# GOAMP P2P Node — Design Spec

## Goal

Build a Go P2P node that runs as a Tauri sidecar and forms the backbone of the GOAMP network. Every Tauri client is a node. The node is SDK-first: the binary is a thin wrapper around a reusable Go library, and community can extend it without touching core code.

## Architecture

### SDK-first principle

The node is a library (`github.com/goamp/sdk`) that any developer can import. The `goamp-node` binary is ~100 lines of wiring. The official Tauri app is just another consumer of the SDK — no special privileges.

```
github.com/goamp/sdk
  ├── node/       — libp2p host, identity, peer management
  ├── catalog/    — DHT track index, search, announce
  ├── profiles/   — taste profiles, anti-Sybil, recommendations
  ├── archive/    — tiered storage (HOT/WARM/COLD/HQ)
  ├── community/  — GossipSub pubsub, comments
  ├── plugin/     — external process plugin loader
  └── proto/      — protobuf definitions (generated for Go + TS)

cmd/goamp-node/main.go   — binary (~100 loc)
client-sdk/              — TypeScript SDK (@goamp/sdk)
plugins/vk-music/        — official plugin example
```

### Communication: Tauri ↔ Node

```
Tauri (Rust)  ──spawn──▶  goamp-node (Go sidecar)
                               │
Tauri (TS)   ◀──HTTP REST──────┤  :7472
Tauri (TS)   ◀──WebSocket──────┘  /events
```

- **HTTP REST** — synchronous requests (search, announce, get recommendations)
- **WebSocket `/events`** — push events from node to Tauri in real time
- No external broker (MQTT/RabbitMQ) — overkill for local IPC

### P2P Transport

- **QUIC** (primary) — better NAT traversal, built-in multiplexing
- **TCP** (fallback) — for environments that block UDP
- **Noise protocol** — encryption for all connections
- **mDNS** — automatic peer discovery on local network (free libp2p feature)
- **DNS bootstrap** — `_goamp._tcp.goamp.app` TXT records, no hardcoded IPs

### P2P Protocols (stream handlers)

Each handler works like a gRPC handler: receive stream, read protobuf request, write protobuf response.

```
/goamp/identify/1.0   — handshake: node version, supported protocols
/goamp/catalog/1.0    — track metadata exchange and search
/goamp/profile/1.0    — anonymous taste profile gossip
/goamp/sync/1.0       — incremental catalog sync between nodes
/goamp/archive/1.0    — archive fragment transfer
```

## Core Interfaces

Every module is defined by a Go interface. This enables mocking in tests and swapping implementations.

```go
type Node interface {
    Start(ctx context.Context) error
    Stop() error
    ID() peer.ID
    RegisterProtocol(p Protocol)
    Emit(event Event)
}

type Protocol interface {
    ID() protocol.ID       // e.g. "/goamp/myplugin/1.0"
    Handle(stream network.Stream)
}

type Catalog interface {
    Index(ctx context.Context, track Track) error
    Search(ctx context.Context, q Query) ([]Track, error)
    Announce(ctx context.Context, trackID string) error
    FindProviders(ctx context.Context, trackID string) ([]peer.ID, error)
}

type ProfileAggregator interface {
    Submit(ctx context.Context, profile TasteProfile) error
    GetRecommendations(ctx context.Context, likes []string) ([]Recommendation, error)
    StorePeer(ctx context.Context, p PeerProfile) error
}

type Archive interface {
    Store(ctx context.Context, trackID string, data []byte) error
    Retrieve(ctx context.Context, trackID string) ([]byte, error)
    Quota() StorageQuota
}

type SearchProvider interface {
    ID() string
    Search(ctx context.Context, q string) ([]Track, error)
    StreamURL(ctx context.Context, trackID string) (string, error)
}
```

## Data Models

### SQLite Schema (node database, separate from Tauri DB)

```sql
CREATE TABLE tracks (
    id TEXT PRIMARY KEY,          -- canonical SHA-256(normalize(artist)+normalize(title))
    musicbrainz_id TEXT,
    acoustid TEXT,
    artist TEXT NOT NULL,
    title TEXT NOT NULL,
    duration_secs INTEGER,
    genre TEXT,
    peer_count INTEGER DEFAULT 1,
    last_seen INTEGER,
    created_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE providers (
    track_id TEXT NOT NULL,
    peer_id TEXT NOT NULL,
    announced_at INTEGER,
    PRIMARY KEY (track_id, peer_id)
);

CREATE TABLE peers (
    peer_id TEXT PRIMARY KEY,
    addrs TEXT NOT NULL,          -- JSON array of multiaddrs
    node_version TEXT,
    protocols TEXT,               -- JSON array
    last_seen INTEGER,
    reputation INTEGER DEFAULT 0
);

CREATE TABLE peer_profiles (
    profile_hash TEXT PRIMARY KEY,
    profile_data TEXT NOT NULL,   -- JSON TasteProfile
    received_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE recommendation_cache (
    track_id TEXT PRIMARY KEY,
    score REAL NOT NULL,
    source TEXT NOT NULL,
    cached_at INTEGER DEFAULT (unixepoch())
);
```

### Protobuf Messages

```protobuf
// Catalog
message SearchRequest  { string query = 1; repeated string genres = 2; uint32 limit = 3; }
message Track          { string id = 1; string artist = 2; string title = 3;
                         string musicbrainz_id = 4; uint32 duration_secs = 5;
                         string genre = 6; uint32 peer_count = 7; }
message SearchResponse { repeated Track tracks = 1; }
message AnnounceRequest { string track_id = 1; uint64 timestamp = 2; }

// Profiles
message TasteProfile {
    uint32 version = 1;
    repeated string liked_hashes = 2;
    repeated ListenPair listen_pairs = 3;
    map<string, float> genre_weights = 4;
    uint32 total_listens = 5;
    repeated ListeningProof proofs = 6;
}
message ListeningProof {
    string track_hash = 1; int64 started_at = 2;
    int32 duration_secs = 3; int32 listened_secs = 4;
}

// Plugin
service GoampPlugin {
    rpc Register(RegisterRequest) returns (PluginManifest);
    rpc Search(SearchRequest) returns (SearchResponse);
    rpc StreamURL(StreamURLRequest) returns (StreamURLResponse);
    rpc HandleEvent(Event) returns (EventAck);
}
message PluginManifest {
    string id = 1; string version = 2;
    repeated string search_providers = 3;
    repeated string protocols = 4;
    repeated string http_routes = 5;
}
```

### DHT Key Space

```
/goamp/track/{canonical_id}   → provider list (peer multiaddrs)
/goamp/artist/{mbid}          → track list for artist
/goamp/meta/{canonical_id}    → Track protobuf (metadata)
```

### WebSocket Events

```go
const (
    EventPeerConnected    = "peer:connected"
    EventPeerDisconnected = "peer:disconnected"
    EventTrackFound       = "track:found"
    EventTrackAnnounced   = "track:announced"
    EventProfileSynced    = "profile:synced"
    EventRecommendations  = "recommendations:updated"
)
type Event struct {
    Type    string          `json:"type"`
    Payload json.RawMessage `json:"payload"`
}
```

## HTTP API

```
GET  /health                     → node status, peer count, uptime, mode
GET  /peers                      → connected peers list
GET  /catalog/search?q=&genre=   → search tracks across P2P network
POST /catalog/announce           → announce track availability
POST /profiles/sync              → submit taste profile to network
GET  /recommendations            → get cached recommendations
GET  /events                     → WebSocket upgrade
GET  /plugins                    → loaded plugins list
*    /plugins/{plugin-id}/*      → proxied to plugin's gRPC
```

## Plugin System

Community mods are separate binaries (any language) in `~/.goamp/plugins/`. No changes to `main.go` required.

### Plugin lifecycle

1. Node scans `~/.goamp/plugins/*/plugin.json` on startup
2. Spawns each plugin binary
3. Plugin writes `{"port": PORT}` to stdout
4. Node connects via gRPC, calls `Register()` to get manifest
5. Node routes search requests, HTTP endpoints, P2P protocols to plugin

### Plugin manifest

```json
{
  "id": "vk-music",
  "version": "1.0.0",
  "protocols": ["/goamp/vk/1.0"],
  "provides": ["search_provider"],
  "api_port": 0
}
```

### Minimal plugin implementation (Go)

```go
func main() {
    port := freePort()
    fmt.Printf(`{"port": %d}\n`, port)
    // implement GoampPlugin gRPC service
    grpc.NewServer().Serve(listener)
}
```

## Node Modes

Single binary, three modes via `--mode` flag:

| Capability | client | full | server |
|---|---|---|---|
| DHT lookup & search | ✓ | ✓ | ✓ |
| Announce tracks | ✓ | ✓ | ✓ |
| Profile sync | ✓ | ✓ | ✓ |
| Bootstrap peers | — | ✓ | ✓ |
| Archive storage | — | ✓ (quota) | ✓ |
| Serve recommendations | — | — | ✓ |
| Rate limits | strict | relaxed | none |

### Config (`~/.goamp/node.toml`)

```toml
[node]
mode = "client"
data_dir = "~/.goamp"
api_port = 7472

[identity]
key_path = "~/.goamp/identity.key"
user_key_path = "~/.goamp/user.key"   # optional

[network]
bootstrap_dns = "_goamp._tcp.goamp.app"
enable_mdns = true
max_peers = 50

[archive]
enabled = false
quota_gb = 0
storage_path = "~/.goamp/archive"

[plugins]
dir = "~/.goamp/plugins"
enabled = true
```

## Identity

**Machine key** (always): ed25519 keypair generated on first run, stored at `key_path`. Becomes the libp2p peerID.

**User key** (optional): ed25519 keypair created during account registration, stored at `user_key_path`. Used for signing content, reputation system, community features. A node without a user key is an anonymous relay.

## Tauri Integration

```rust
// src-tauri/src/lib.rs
fn start_node(app: &tauri::App) {
    let sidecar = app.shell()
        .sidecar("goamp-node")
        .args(["--mode=client", "--api-port=7472"])
        .spawn()
        .expect("failed to start goamp-node");
    app.manage(NodeProcess(sidecar));
}
```

```typescript
// client-sdk usage in Tauri frontend
const node = new GoampClient({ baseUrl: 'http://localhost:7472' })
node.on('peer:connected', handler)
node.on('recommendations:updated', handler)
const tracks = await node.catalog.search('boards of canada')
await node.profiles.sync(myTasteProfile)
```

**Lifecycle:**
1. Tauri starts → spawns `goamp-node --mode=client`
2. Node writes `ready:7472` to stdout
3. Tauri reads, GoampClient connects via HTTP + WebSocket
4. Events flow in real time
5. Tauri closes → SIGTERM → graceful shutdown (save peers, close streams, kill plugins)

## Testing

### Unit tests (per module)
Each SDK module tested in isolation using interface mocks. No real P2P network needed.

```go
func TestCatalogSearch(t *testing.T) {
    c := catalog.New(sqlite.NewMemoryStore())
    c.Index(ctx, Track{Artist: "Boards of Canada", Title: "Dayvan Cowboy"})
    results, _ := c.Search(ctx, Query{Q: "boards"})
    assert.Len(t, results, 1)
}
```

### Integration tests (mini network)
`sdk/testutil` provides an in-memory network of N nodes for protocol testing.

```go
func TestPeerDiscovery(t *testing.T) {
    net := testutil.NewNetwork(t, 3)
    net.Connect(0, 1)
    net.Node(0).Catalog().Announce(ctx, "track-hash-abc")
    providers := net.Node(2).Catalog().FindProviders(ctx, "track-hash-abc")
    assert.Contains(t, providers, net.Node(0).ID())
}
```

### E2E tests
Real binary, real HTTP API, CI-friendly.

```bash
goamp-node --mode=client --api-port=17472 &
curl localhost:17472/health | jq .status
```

### Division of labour

| Area | Owner |
|---|---|
| Go unit tests: catalog, profiles, archive handlers | **you** |
| `testutil.NewNetwork()`, interface mocks | **claude** |
| E2E tests, CI scripts | **claude** |
| TypeScript client-sdk tests | **claude** |
| Plugin gRPC contract tests | **claude** |

## Division of Labour (implementation)

| Area | Owner |
|---|---|
| libp2p host setup, DHT, mDNS, QUIC/TCP | **claude** |
| Catalog stream handlers (business logic) | **you** |
| Profile aggregation handlers | **you** |
| Archive storage handlers | **you** |
| HTTP API server wiring | **you** |
| Plugin loader (spawn + gRPC connect) | **claude** |
| Tauri sidecar integration (Rust) | **claude** |
| TypeScript client-sdk | **claude** |
| Protobuf definitions | **claude** |
| SQLite migrations | **you** |
| node.toml config parsing | **you** |
