# P2P Taste Profile Gossip — Design Spec

**Date:** 2026-04-18  
**Goal:** Wire the existing GossipSub infrastructure so taste profiles are automatically exchanged between GOAMP peers, feeding collaborative filtering with real peer data.

---

## Context

The infrastructure is already in place:
- `goamp-node/sdk/node/pubsub.go` — GossipSub topic `/goamp/profiles/1.0`, `PublishProfile()`, `runSubscription()`, `handleProfileMessage()` → `StorePeer()`
- `goamp-node/sdk/profiles/profiles.go` — `SQLProfileAggregator`: `Submit()`, `StorePeer()`, `GetRecommendations()`
- `goamp-node/api/profile_handlers.go` — `POST /profiles/sync` receives a profile, calls `Submit()` but does NOT publish to GossipSub yet
- `src-tauri/src/taste_profile.rs` — `build_taste_profile()` builds `TasteProfile` from local SQLite
- `src-tauri/src/aggregator.rs` — `submit_to_aggregator()` currently targets `https://api.goamp.app/v1` (non-existent)
- `src-tauri/src/node.rs` — spawns goamp-node sidecar, listens for `ready:PORT` signal

**Missing links:**
1. `handleProfileSync` doesn't call `PublishProfile()` after storing
2. Tauri submits to a non-existent central server instead of local node
3. Peer profiles stored in node SQLite never reach Tauri SQLite for collaborative filtering
4. No WS listener in Tauri to react to `profile:synced` events
5. No periodic sync timer in Tauri

---

## Architecture

```
Tauri (5-min timer)
  → build_taste_profile()
  → POST localhost:7472/profiles/sync  (JSON TasteProfile)
  → [goamp-node] handleProfileSync → Submit() → PublishProfile() → GossipSub mesh
  → peers receive → handleProfileMessage() → StorePeer() → WS emit "profile:synced" {hash, peer_count}

[Tauri WS client]
  ← "profile:synced" event
  → GET localhost:7472/profiles/peers?limit=100
  → INSERT INTO peer_profiles (Tauri SQLite)
  → invoke update_tray_tooltip("N пиров · sync только что")
```

---

## Changes

### goamp-node (Go)

#### 1. `api/profile_handlers.go` — publish after submit
```go
func (s *Server) handleProfileSync(w http.ResponseWriter, r *http.Request) {
    // ... existing decode + filter mood centroids ...
    if err := s.profiles.Submit(ctx, &profile); err != nil { ... }
    // NEW: broadcast to peers
    if s.node != nil {
        _ = s.node.(*node.P2PNode).PublishProfile(ctx, &profile)
    }
    w.WriteHeader(http.StatusNoContent)
}
```

#### 2. `api/profile_handlers.go` — new GET /profiles/peers endpoint
Returns up to `limit` most recent peer profiles from node SQLite.
```
GET /profiles/peers?limit=100
→ 200 {"profiles": [{"hash": "...", "data": {...TasteProfile}}]}
```
Calls `store.GetPeerProfiles(ctx, limit)` — new Store method.

#### 3. `store/store.go` — new `GetPeerProfiles` method
```go
GetPeerProfiles(ctx context.Context, limit int) ([]PeerProfileRow, error)
```
Reads from `peer_profiles` table ordered by `received_at DESC`.

#### 4. `api/websocket.go` — add `peer_count` to `profile:synced` payload
```json
{"type": "profile:synced", "payload": {"hash": "abc123", "peer_count": 5}}
```

#### 5. `api/server.go` — register new route
```go
mux.HandleFunc("/profiles/peers", s.handleGetPeerProfiles)
```

---

### Tauri / Rust

#### 6. `src-tauri/src/aggregator.rs` — redirect sync to local node
Replace `submit_to_aggregator` HTTP target from `api.goamp.app/v1` to `localhost:7472/profiles/sync`.

New function signature (keeps existing interface):
```rust
pub async fn sync_to_node(profile: &TasteProfile, port: u16) -> Result<(), String>
```
Uses `reqwest::Client::post(format!("http://localhost:{port}/profiles/sync"))`.

#### 7. `src-tauri/src/aggregator.rs` — fetch peer profiles from node
```rust
pub async fn fetch_peer_profiles(port: u16) -> Result<Vec<String>, String>
```
GET `localhost:{port}/profiles/peers?limit=100` → returns vec of raw JSON profile strings → caller inserts into Tauri `peer_profiles` table.

#### 8. `src-tauri/src/lib.rs` — setup: 5-min sync timer + WS listener
In the Tauri setup hook, after node starts:

```rust
// Wait for goamp-node:ready event before starting timer + WS
// (node.rs emits this when stdout produces "ready:PORT")

// 5-minute sync timer (starts only after node is ready)
tauri::async_runtime::spawn(async move {
    let mut interval = tokio::time::interval(Duration::from_secs(300));
    loop {
        interval.tick().await;
        let profile = { let conn = db.lock(); build_taste_profile(&conn, 100) };
        let _ = sync_to_node(&profile, 7472).await;
    }
});

// WS listener for profile:synced (reconnects on disconnect with 5s backoff)
tauri::async_runtime::spawn(async move {
    loop {
        // connect to ws://localhost:7472/ws
        // on message type "profile:synced":
        //   fetch_peer_profiles(7472) → insert into peer_profiles
        //   emit goamp-node:profile-synced to frontend with peer_count
        // on disconnect: sleep 5s, retry
        tokio::time::sleep(Duration::from_secs(5)).await;
    }
});
```

#### 9. `src-tauri/src/commands/recommendations.rs` — `sync_profile` command
Existing `sync_profile` Tauri command triggers the sync immediately (on-demand) in addition to the timer. Port is the constant `7472` — not a frontend parameter.
```rust
#[tauri::command]
pub async fn sync_profile(db: State<Db>) -> Result<usize, String> {
    let profile = { let conn = db.lock(); build_taste_profile(&conn, 100) };
    sync_to_node(&profile, 7472).await?;
    Ok(profile.liked_hashes.len())
}
```

---

### Frontend (TypeScript)

#### 10. `src/bootstrap/AppBootstrap.ts` — listen for sync events
```ts
webview.listen<{peer_count: number}>('goamp-node:profile-synced', ({ payload }) => {
  const text = `${payload.peer_count} peers · synced just now`
  invoke('update_tray_tooltip', { text }).catch(() => {})
})
```

---

## Data Contract

**POST /profiles/sync body** — existing `TasteProfile` JSON (no change):
```json
{
  "version": 1,
  "liked_hashes": ["sha256:...", ...],
  "listen_pairs": [["hash_a", "hash_b"], ...],
  "genre_weights": {"rock": 0.8, "jazz": 0.3},
  "total_listens": 142,
  "generated_at": 1713456789
}
```

**GET /profiles/peers response:**
```json
{
  "profiles": [
    {"hash": "abc123", "data": {/* TasteProfile */}, "received_at": 1713456700}
  ]
}
```

**WS profile:synced payload:**
```json
{"type": "profile:synced", "payload": {"hash": "abc123", "peer_count": 5}}
```

---

## Out of Scope

- Peer scoring / quality filtering (planned for later)
- Anti-Sybil at gossip level (sybil.rs exists but not wired)
- Separate P2P status UI panel
- MoodCentroid gossip (requires minimum 10 tracks per mood — already filtered in handleProfileSync)

---

## Testing

- `profiles_test.go`: existing tests cover Submit/StorePeer — add test for GetPeerProfiles
- `pubsub_test.go`: existing integration test — add assertion that PublishProfile is called after handleProfileSync
- `aggregator.rs` tests: mock HTTP server to verify POST to localhost:7472
- Rust WS listener: test with mock WS server emitting `profile:synced`
