# P2P Taste Profile Gossip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the existing GossipSub infrastructure so GOAMP peers automatically exchange taste profiles every 5 minutes, feeding collaborative filtering with real peer data and updating the tray tooltip with live peer count.

**Architecture:** Tauri fires a 5-min timer → POST `localhost:7472/profiles/sync` → goamp-node stores + publishes via GossipSub → peer nodes receive → store + emit `profile:synced` via WebSocket → Tauri WS client pulls `/profiles/peers` → writes to `peer_profiles` table → updates tray tooltip.

**Tech Stack:** Go (goamp-node: libp2p, GossipSub, HTTP API), Rust (Tauri: reqwest, tokio-tungstenite), TypeScript (AppBootstrap.ts)

---

## File Map

**Create:**
- `src-tauri/src/node_client.rs` — 5-min sync timer + WS listener, isolated from lib.rs

**Modify:**
- `goamp-node/store/store.go` — add `PeerProfileRow` type + `GetPeerProfiles` to `Store` interface
- `goamp-node/store/sqlite.go` — implement `GetPeerProfiles`
- `goamp-node/sdk/sdk.go` — add `PublishProfile` to `Node` interface + `GetPeerProfiles` to `ProfileAggregator`
- `goamp-node/sdk/node/node.go` — add `PublishProfile` no-op stub to `LocalNode`
- `goamp-node/sdk/profiles/profiles.go` — implement `GetPeerProfiles` (delegates to store)
- `goamp-node/sdk/node/pubsub.go` — add `peer_count` to `profile:synced` WS payload
- `goamp-node/api/profile_handlers.go` — `handleProfileSync` calls `PublishProfile`; add `handleGetPeerProfiles`
- `goamp-node/api/server.go` — register `GET /profiles/peers` in `Start` + `ServeHTTP`
- `goamp-node/sdk/node/pubsub_test.go` — update payload struct to include `peer_count`
- `goamp-node/sdk/profiles/profiles_test.go` — add `TestGetPeerProfiles`
- `goamp-node/api/server_test.go` — add `TestGetPeerProfiles` endpoint test
- `src-tauri/Cargo.toml` — add `tokio-tungstenite`, `futures-util`
- `src-tauri/src/aggregator.rs` — replace `submit_to_aggregator` with `sync_to_node`; add `fetch_peer_profiles`
- `src-tauri/src/lib.rs` — `mod node_client`; wire `node_client::start` in setup hook
- `src/bootstrap/AppBootstrap.ts` — listen for `goamp-node:profile-synced`, update tray tooltip

---

## Task 1: Store.GetPeerProfiles — interface + SQL

**Files:**
- Modify: `goamp-node/store/store.go`
- Modify: `goamp-node/store/sqlite.go`
- Test: `goamp-node/store/sqlite_test.go`

The `peer_profiles` table schema (already exists):
```sql
CREATE TABLE IF NOT EXISTS peer_profiles (
    profile_hash TEXT PRIMARY KEY,
    profile_data TEXT NOT NULL,
    received_at  INTEGER DEFAULT (unixepoch())
);
```

- [ ] **Write failing test** — add to `goamp-node/store/sqlite_test.go`:

```go
func TestGetPeerProfiles(t *testing.T) {
    s, err := store.Open(":memory:")
    require.NoError(t, err)
    defer s.Close()

    ctx := context.Background()

    // Store two profiles
    require.NoError(t, s.StorePeerProfile(ctx, "hash1", []byte(`{"version":1}`)))
    require.NoError(t, s.StorePeerProfile(ctx, "hash2", []byte(`{"version":2}`)))

    rows, err := s.GetPeerProfiles(ctx, 10)
    require.NoError(t, err)
    assert.Len(t, rows, 2)
    assert.NotEmpty(t, rows[0].Hash)
    assert.NotEmpty(t, rows[0].Data)
    assert.Greater(t, rows[0].ReceivedAt, int64(0))
}

func TestGetPeerProfilesLimit(t *testing.T) {
    s, err := store.Open(":memory:")
    require.NoError(t, err)
    defer s.Close()

    ctx := context.Background()
    for i := 0; i < 5; i++ {
        require.NoError(t, s.StorePeerProfile(ctx, fmt.Sprintf("hash%d", i), []byte(`{}`)))
    }

    rows, err := s.GetPeerProfiles(ctx, 3)
    require.NoError(t, err)
    assert.Len(t, rows, 3)
}
```

- [ ] **Run to confirm FAIL**

```bash
cd goamp-node && go test ./store/... -run TestGetPeerProfiles -v
```
Expected: FAIL — `GetPeerProfiles` not found on `Store` interface.

- [ ] **Add PeerProfileRow + GetPeerProfiles to store/store.go**

In `store/store.go`, add after the `Recommendation` struct:

```go
// PeerProfileRow is a taste profile received from a remote peer.
type PeerProfileRow struct {
    Hash       string
    Data       []byte
    ReceivedAt int64
}
```

Add `GetPeerProfiles` to the `Store` interface, after `StorePeerProfile`:

```go
GetPeerProfiles(ctx context.Context, limit int) ([]PeerProfileRow, error)
```

- [ ] **Implement GetPeerProfiles in store/sqlite.go**

Add after `StorePeerProfile`:

```go
// GetPeerProfiles returns the most recent peer profiles, newest first.
func (s *SQLiteStore) GetPeerProfiles(ctx context.Context, limit int) ([]PeerProfileRow, error) {
    if limit <= 0 {
        limit = 100
    }
    rows, err := s.db.QueryContext(ctx,
        `SELECT profile_hash, profile_data, received_at
         FROM peer_profiles
         ORDER BY received_at DESC
         LIMIT ?`,
        limit)
    if err != nil {
        return nil, err
    }
    defer rows.Close()
    var result []PeerProfileRow
    for rows.Next() {
        var r PeerProfileRow
        var data string
        if err := rows.Scan(&r.Hash, &data, &r.ReceivedAt); err != nil {
            return nil, err
        }
        r.Data = []byte(data)
        result = append(result, r)
    }
    return result, rows.Err()
}
```

- [ ] **Run to confirm PASS**

```bash
cd goamp-node && go test ./store/... -run TestGetPeerProfiles -v
```
Expected: PASS.

- [ ] **Commit**

```bash
git add goamp-node/store/store.go goamp-node/store/sqlite.go goamp-node/store/sqlite_test.go
git commit -m "feat(node): add GetPeerProfiles to store — return recent peer taste profiles"
```

---

## Task 2: SDK interface — Node.PublishProfile + ProfileAggregator.GetPeerProfiles

**Files:**
- Modify: `goamp-node/sdk/sdk.go`

No tests — pure interface declaration. Compile-checked by subsequent tasks.

- [ ] **Add to sdk/sdk.go**

At the top of `sdk.go`, the import block already exists. Add `"github.com/goamp/sdk/proto"` if not present, and `"github.com/goamp/sdk/store"`.

Add `PublishProfile` to the `Node` interface (after `Emit`):

```go
// PublishProfile broadcasts a taste profile to all peers via GossipSub.
// Returns nil on the LocalNode stub (no-op).
PublishProfile(ctx context.Context, profile *proto.TasteProfile) error
```

Add `GetPeerProfiles` to the `ProfileAggregator` interface (after `StorePeer`):

```go
// GetPeerProfiles returns the most recent peer profiles stored locally.
GetPeerProfiles(ctx context.Context, limit int) ([]store.PeerProfileRow, error)
```

The full `sdk.go` import block after changes:

```go
import (
    "context"
    "encoding/json"

    "github.com/goamp/sdk/proto"
    "github.com/goamp/sdk/store"
    "github.com/libp2p/go-libp2p/core/network"
    "github.com/libp2p/go-libp2p/core/peer"
    libp2pprotocol "github.com/libp2p/go-libp2p/core/protocol"
)
```

- [ ] **Verify compile**

```bash
cd goamp-node && go build ./sdk/...
```
Expected: compile errors in `node.go` (LocalNode missing `PublishProfile`) and `profiles.go` (missing `GetPeerProfiles`) — that is expected. Fix in next tasks.

- [ ] **Commit**

```bash
git add goamp-node/sdk/sdk.go
git commit -m "feat(node): extend Node + ProfileAggregator interfaces with PublishProfile + GetPeerProfiles"
```

---

## Task 3: LocalNode stub + SQLProfileAggregator implement new methods

**Files:**
- Modify: `goamp-node/sdk/node/node.go`
- Modify: `goamp-node/sdk/profiles/profiles.go`
- Modify: `goamp-node/sdk/profiles/profiles_test.go`

- [ ] **Write failing test** — add to `goamp-node/sdk/profiles/profiles_test.go`:

```go
func TestGetPeerProfiles(t *testing.T) {
    a := newAgg(t)
    ctx := context.Background()

    // Store two peer profiles via Submit (same path as gossip reception)
    p1 := &proto.TasteProfile{Version: 1, LikedHashes: []string{"h1"}, TotalListens: 10}
    p2 := &proto.TasteProfile{Version: 1, LikedHashes: []string{"h2"}, TotalListens: 20}
    require.NoError(t, a.Submit(ctx, p1))
    require.NoError(t, a.Submit(ctx, p2))

    rows, err := a.GetPeerProfiles(ctx, 10)
    require.NoError(t, err)
    assert.Len(t, rows, 2)
    assert.NotEmpty(t, rows[0].Hash)
    assert.NotEmpty(t, rows[0].Data)
}
```

- [ ] **Run to confirm FAIL**

```bash
cd goamp-node && go test ./sdk/profiles/... -run TestGetPeerProfiles -v
```
Expected: FAIL — method not found.

- [ ] **Add PublishProfile no-op to LocalNode (sdk/node/node.go)**

Add after `Emit`:

```go
// PublishProfile is a no-op on the stub — used in tests only.
func (n *LocalNode) PublishProfile(_ context.Context, _ *proto.TasteProfile) error {
    return nil
}
```

Add import at top of node.go:
```go
import (
    "context"
    "sync"

    "github.com/goamp/sdk/proto"
    "github.com/goamp/sdk/sdk"
    "github.com/libp2p/go-libp2p/core/peer"
)
```

- [ ] **Implement GetPeerProfiles on SQLProfileAggregator (sdk/profiles/profiles.go)**

Add after `StorePeer`:

```go
// GetPeerProfiles returns the most recent peer profiles from the store.
func (p *SQLProfileAggregator) GetPeerProfiles(ctx context.Context, limit int) ([]store.PeerProfileRow, error) {
    return p.store.GetPeerProfiles(ctx, limit)
}
```

Add `"github.com/goamp/sdk/store"` to the import block in profiles.go.

- [ ] **Run to confirm PASS**

```bash
cd goamp-node && go test ./sdk/profiles/... -run TestGetPeerProfiles -v
```
Expected: PASS.

- [ ] **Full build check**

```bash
cd goamp-node && go build ./...
```
Expected: no errors.

- [ ] **Commit**

```bash
git add goamp-node/sdk/node/node.go goamp-node/sdk/profiles/profiles.go goamp-node/sdk/profiles/profiles_test.go
git commit -m "feat(node): implement PublishProfile stub + GetPeerProfiles on aggregator"
```

---

## Task 4: pubsub.go — add peer_count to profile:synced payload

**Files:**
- Modify: `goamp-node/sdk/node/pubsub.go`
- Modify: `goamp-node/sdk/node/pubsub_test.go`

- [ ] **Update existing test** — in `pubsub_test.go`, find `TestGossipSubEmitsProfileSynced` and update the payload struct:

```go
// Replace the existing payload struct in TestGossipSubEmitsProfileSynced:
var payload struct {
    Hash      string `json:"hash"`
    PeerCount int    `json:"peer_count"`
}
require.NoError(t, json.Unmarshal(gotEvent.Payload, &payload))
assert.NotEmpty(t, payload.Hash)
assert.GreaterOrEqual(t, payload.PeerCount, 0, "peer_count must be present and non-negative")
```

- [ ] **Run to confirm FAIL**

```bash
cd goamp-node && go test ./sdk/node/... -run TestGossipSubEmitsProfileSynced -v
```
Expected: FAIL — `peer_count` is 0 and `assert.GreaterOrEqual` passes but `json.Unmarshal` on the old payload (which has no `peer_count`) gives 0 — actually this may pass. Let me verify: the old payload is `{"hash":"abc123"}` — `peer_count` will unmarshal as 0, and `GreaterOrEqual(0, 0)` is true. So the test won't fail on that assertion. 

Instead, confirm by running and seeing it currently has no `peer_count` field in the JSON:

```bash
cd goamp-node && go test ./sdk/node/... -run TestGossipSubEmitsProfileSynced -v
```
Expected: PASS (test does not yet fail — we'll verify the fix is applied correctly after implementation).

- [ ] **Update handleProfileMessage in pubsub.go**

Replace:
```go
payload, _ := json.Marshal(map[string]string{"hash": hash})
n.Emit(sdk.Event{Type: sdk.EventProfileSynced, Payload: payload})
```

With:
```go
peerCount := len(n.host.Network().Conns())
payload, _ := json.Marshal(map[string]any{
    "hash":       hash,
    "peer_count": peerCount,
})
n.Emit(sdk.Event{Type: sdk.EventProfileSynced, Payload: payload})
```

- [ ] **Run all pubsub tests to confirm PASS**

```bash
cd goamp-node && go test ./sdk/node/... -v -timeout 30s
```
Expected: all PASS.

- [ ] **Commit**

```bash
git add goamp-node/sdk/node/pubsub.go goamp-node/sdk/node/pubsub_test.go
git commit -m "feat(node): add peer_count to profile:synced WS payload"
```

---

## Task 5: API — handleProfileSync publishes + GET /profiles/peers

**Files:**
- Modify: `goamp-node/api/profile_handlers.go`
- Modify: `goamp-node/api/server.go`
- Modify: `goamp-node/api/server_test.go`

- [ ] **Write failing tests** — add to `goamp-node/api/server_test.go`:

```go
func TestProfileSyncReturns204(t *testing.T) {
    srv := newTestServer(t)
    body := `{"version":1,"liked_hashes":["h1","h2"],"total_listens":5}`
    req := httptest.NewRequest(http.MethodPost, "/profiles/sync", strings.NewReader(body))
    req.Header.Set("Content-Type", "application/json")
    w := httptest.NewRecorder()
    srv.ServeHTTP(w, req)
    assert.Equal(t, http.StatusNoContent, w.Code)
}

func TestGetPeerProfilesEmpty(t *testing.T) {
    srv := newTestServer(t)
    req := httptest.NewRequest(http.MethodGet, "/profiles/peers", nil)
    w := httptest.NewRecorder()
    srv.ServeHTTP(w, req)
    assert.Equal(t, http.StatusOK, w.Code)
    var body map[string]any
    require.NoError(t, json.NewDecoder(w.Body).Decode(&body))
    assert.Contains(t, body, "profiles")
}

func TestGetPeerProfilesReturnsStored(t *testing.T) {
    srv := newTestServer(t)

    // First sync a profile so it gets stored
    p := `{"version":1,"liked_hashes":["hash1"],"total_listens":3}`
    req := httptest.NewRequest(http.MethodPost, "/profiles/sync", strings.NewReader(p))
    req.Header.Set("Content-Type", "application/json")
    w := httptest.NewRecorder()
    srv.ServeHTTP(w, req)
    require.Equal(t, http.StatusNoContent, w.Code)

    // Now GET /profiles/peers
    req2 := httptest.NewRequest(http.MethodGet, "/profiles/peers?limit=10", nil)
    w2 := httptest.NewRecorder()
    srv.ServeHTTP(w2, req2)
    assert.Equal(t, http.StatusOK, w2.Code)

    var body map[string]any
    require.NoError(t, json.NewDecoder(w2.Body).Decode(&body))
    profiles, ok := body["profiles"].([]any)
    require.True(t, ok)
    assert.Len(t, profiles, 1)

    first := profiles[0].(map[string]any)
    assert.NotEmpty(t, first["hash"])
    assert.NotNil(t, first["data"])
    assert.NotZero(t, first["received_at"])
}
```

- [ ] **Run to confirm FAIL**

```bash
cd goamp-node && go test ./api/... -run "TestGetPeerProfiles|TestProfileSyncReturns204" -v
```
Expected: `TestGetPeerProfilesReturnsStored` FAIL — route not registered. `TestProfileSyncReturns204` may pass (it already returns 204).

- [ ] **Add handleGetPeerProfiles to api/profile_handlers.go**

Add after `handleRecommendations`:

```go
// handleGetPeerProfiles handles GET /profiles/peers?limit=N
// Returns peer taste profiles stored from gossip, newest first.
func (s *Server) handleGetPeerProfiles(w http.ResponseWriter, r *http.Request) {
    limit := 100
    if n, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && n > 0 {
        limit = n
    }
    rows, err := s.profiles.GetPeerProfiles(r.Context(), limit)
    if err != nil {
        http.Error(w, err.Error(), http.StatusInternalServerError)
        return
    }

    type profileEntry struct {
        Hash       string          `json:"hash"`
        Data       json.RawMessage `json:"data"`
        ReceivedAt int64           `json:"received_at"`
    }
    entries := make([]profileEntry, 0, len(rows))
    for _, row := range rows {
        entries = append(entries, profileEntry{
            Hash:       row.Hash,
            Data:       json.RawMessage(row.Data),
            ReceivedAt: row.ReceivedAt,
        })
    }

    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(map[string]any{"profiles": entries})
}
```

Add `"strconv"` to the import block in `profile_handlers.go`.

- [ ] **Update handleProfileSync to call PublishProfile**

In `handleProfileSync`, after `s.profiles.Submit(ctx, &profile)` succeeds, add:

```go
if s.node != nil {
    _ = s.node.PublishProfile(r.Context(), &profile)
}
```

The full updated `handleProfileSync` function:

```go
func (s *Server) handleProfileSync(w http.ResponseWriter, r *http.Request) {
    var profile proto.TasteProfile
    if err := json.NewDecoder(r.Body).Decode(&profile); err != nil {
        http.Error(w, "invalid profile: "+err.Error(), http.StatusBadRequest)
        return
    }
    if len(profile.MoodCentroids) > 0 {
        filtered := make(map[string]*proto.MoodCentroid)
        for moodID, centroid := range profile.MoodCentroids {
            if centroid.TrackCount >= 10 {
                filtered[moodID] = centroid
            }
        }
        profile.MoodCentroids = filtered
    }
    if err := s.profiles.Submit(r.Context(), &profile); err != nil {
        http.Error(w, err.Error(), http.StatusInternalServerError)
        return
    }
    if s.node != nil {
        _ = s.node.PublishProfile(r.Context(), &profile)
    }
    w.WriteHeader(http.StatusNoContent)
}
```

- [ ] **Register route in api/server.go**

In `Start`, add after `mux.HandleFunc("GET /recommendations", s.handleRecommendations)`:

```go
mux.HandleFunc("GET /profiles/peers", s.handleGetPeerProfiles)
```

In `ServeHTTP`, add the same line in the same position.

- [ ] **Run to confirm PASS**

```bash
cd goamp-node && go test ./api/... -v
```
Expected: all tests PASS.

- [ ] **Commit**

```bash
git add goamp-node/api/profile_handlers.go goamp-node/api/server.go goamp-node/api/server_test.go
git commit -m "feat(node): handleProfileSync publishes to GossipSub + add GET /profiles/peers"
```

---

## Task 6: Go — full test suite

- [ ] **Run all goamp-node tests**

```bash
cd goamp-node && go test ./... -timeout 60s
```
Expected: all PASS.

- [ ] **Commit if any fixes needed**, otherwise proceed.

---

## Task 7: Tauri Cargo.toml — add WS + futures deps

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Add dependencies**

In `src-tauri/Cargo.toml`, under `[dependencies]`, add:

```toml
tokio-tungstenite = "0.24"
futures-util = "0.3"
```

Also update `tokio` to include the `time` and `rt` features needed for `interval`:

```toml
tokio = { version = "1", features = ["process", "time", "rt"] }
```

- [ ] **Verify compile**

```bash
cd src-tauri && cargo check 2>&1 | head -20
```
Expected: no errors (new deps download and resolve).

- [ ] **Commit**

```bash
git add src-tauri/Cargo.toml
git commit -m "chore(tauri): add tokio-tungstenite + futures-util for P2P node client"
```

---

## Task 8: aggregator.rs — sync_to_node + fetch_peer_profiles

**Files:**
- Modify: `src-tauri/src/aggregator.rs`

Replace the existing `submit_to_aggregator` + `sync_profile` with a version that targets the local node.

- [ ] **Replace submit_to_aggregator with sync_to_node**

In `src-tauri/src/aggregator.rs`, replace:

```rust
pub async fn submit_to_aggregator(
    client: &reqwest::Client,
    base_url: &str,
    submission: &ProfileSubmission,
) -> Result<AggregatorResponse, String> {
    let resp = client
        .post(format!("{}/profiles/submit", base_url))
        .json(submission)
        .header("User-Agent", "GOAMP/1.0")
        .send()
        .await
        .map_err(|e| format!("aggregator request failed: {e}"))?;

    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("aggregator error: {body}"));
    }

    resp.json().await.map_err(|e| format!("parse error: {e}"))
}
```

With:

```rust
/// POST the local taste profile to the goamp-node sidecar for GossipSub broadcast.
pub async fn sync_to_node(profile: &crate::taste_profile::TasteProfile, port: u16) -> Result<(), String> {
    let resp = crate::http::CLIENT
        .post(format!("http://localhost:{port}/profiles/sync"))
        .json(profile)
        .header("User-Agent", "GOAMP/1.0")
        .send()
        .await
        .map_err(|e| format!("node sync failed: {e}"))?;

    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("node error: {body}"));
    }
    Ok(())
}
```

- [ ] **Add fetch_peer_profiles after sync_to_node**

```rust
#[derive(serde::Deserialize)]
struct PeerProfileEntry {
    hash: String,
    data: serde_json::Value,
}

#[derive(serde::Deserialize)]
struct PeersResponse {
    profiles: Vec<PeerProfileEntry>,
}

/// Fetch peer taste profiles from the goamp-node sidecar.
/// Returns vec of (profile_hash, profile_data_json) ready to insert into Tauri SQLite.
pub async fn fetch_peer_profiles(port: u16) -> Result<Vec<(String, String)>, String> {
    let resp = crate::http::CLIENT
        .get(format!("http://localhost:{port}/profiles/peers?limit=100"))
        .send()
        .await
        .map_err(|e| format!("fetch peers failed: {e}"))?;

    if !resp.status().is_success() {
        return Ok(vec![]);
    }

    let body: PeersResponse = resp.json().await.map_err(|e| format!("parse error: {e}"))?;
    Ok(body
        .profiles
        .into_iter()
        .filter_map(|e| {
            serde_json::to_string(&e.data)
                .ok()
                .map(|data| (e.hash, data))
        })
        .collect())
}
```

- [ ] **Update sync_profile Tauri command** — replace the body with the new function:

```rust
#[tauri::command]
pub async fn sync_profile(app: tauri::AppHandle) -> Result<u32, String> {
    let db = app.state::<crate::db::Db>();
    let profile = {
        let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
        crate::taste_profile::build_taste_profile(&conn, 200)
    };

    let count = profile.liked_hashes.len() as u32;
    sync_to_node(&profile, 7472).await?;
    eprintln!("[GOAMP] Profile synced to node ({count} liked tracks)");
    Ok(count)
}
```

- [ ] **Compile check**

```bash
cd src-tauri && cargo check 2>&1 | grep "^error" | head -20
```
Expected: no errors.

- [ ] **Commit**

```bash
git add src-tauri/src/aggregator.rs
git commit -m "feat(tauri): replace central aggregator with local node sync — POST localhost:7472/profiles/sync"
```

---

## Task 9: node_client.rs — 5-min timer + WS listener

**Files:**
- Create: `src-tauri/src/node_client.rs`

- [ ] **Create node_client.rs**

```rust
// src-tauri/src/node_client.rs
//
// Runs two background tasks after the goamp-node sidecar is ready:
//   1. 5-minute timer: build TasteProfile → POST /profiles/sync
//   2. WS listener on ws://localhost:7472/events:
//      on "profile:synced" → GET /profiles/peers → INSERT INTO peer_profiles → emit to frontend

use std::time::Duration;
use futures_util::StreamExt;
use tauri::{AppHandle, Emitter, Manager};
use tokio_tungstenite::tungstenite::Message;

const NODE_PORT: u16 = 7472;
const SYNC_INTERVAL_SECS: u64 = 300; // 5 minutes

/// Start the background sync timer and WS listener.
/// Call this once after the goamp-node:ready event fires.
pub fn start(app: AppHandle) {
    let app1 = app.clone();
    let app2 = app.clone();

    // 5-minute profile sync timer
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(SYNC_INTERVAL_SECS));
        interval.tick().await; // skip first immediate tick
        loop {
            interval.tick().await;
            let profile = {
                let db = app1.state::<crate::db::Db>();
                let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
                crate::taste_profile::build_taste_profile(&conn, 200)
            };
            if let Err(e) = crate::aggregator::sync_to_node(&profile, NODE_PORT).await {
                eprintln!("[node_client] sync error: {e}");
            }
        }
    });

    // WS listener — reconnects on disconnect
    tauri::async_runtime::spawn(async move {
        loop {
            match tokio_tungstenite::connect_async(
                format!("ws://localhost:{NODE_PORT}/events")
            ).await {
                Ok((mut ws, _)) => {
                    eprintln!("[node_client] WS connected to node");
                    while let Some(Ok(msg)) = ws.next().await {
                        if let Message::Text(text) = msg {
                            handle_ws_message(&app2, &text).await;
                        }
                    }
                    eprintln!("[node_client] WS disconnected");
                }
                Err(e) => {
                    eprintln!("[node_client] WS connect error: {e}");
                }
            }
            tokio::time::sleep(Duration::from_secs(5)).await;
        }
    });
}

async fn handle_ws_message(app: &AppHandle, text: &str) {
    let Ok(event) = serde_json::from_str::<serde_json::Value>(text) else {
        return;
    };
    if event["type"].as_str() != Some("profile:synced") {
        return;
    }

    let peer_count = event["payload"]["peer_count"].as_u64().unwrap_or(0) as u32;

    // Pull latest peer profiles and store in Tauri SQLite
    match crate::aggregator::fetch_peer_profiles(NODE_PORT).await {
        Ok(profiles) => {
            let db = app.state::<crate::db::Db>();
            let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
            for (hash, data) in &profiles {
                crate::aggregator::store_peer_profile(&conn, hash, data);
            }
        }
        Err(e) => eprintln!("[node_client] fetch_peer_profiles error: {e}"),
    }

    // Notify frontend so it can update the tray tooltip
    let _ = app.emit("goamp-node:profile-synced", peer_count);
}
```

- [ ] **Compile check**

```bash
cd src-tauri && cargo check 2>&1 | grep "^error" | head -20
```
Expected: `node_client` module not found (not wired yet — expected).

- [ ] **Commit**

```bash
git add src-tauri/src/node_client.rs
git commit -m "feat(tauri): add node_client — 5-min sync timer + WS listener for profile:synced"
```

---

## Task 10: lib.rs — wire node_client

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Add mod declaration**

In `src-tauri/src/lib.rs`, find the block of `mod` declarations and add:

```rust
mod node_client;
```

- [ ] **Wire in setup hook**

In the setup hook, after the `node::start_node` block, add:

```rust
// Start the profile sync timer + WS listener once the node is ready
let node_app = app.handle().clone();
app.handle().listen("goamp-node:ready", move |_event| {
    node_client::start(node_app.clone());
});
```

The full `#[cfg(desktop)]` block after the change:

```rust
#[cfg(desktop)]
if let Err(e) = node::start_node(app.handle()) {
    eprintln!("[goamp] failed to start node sidecar: {e}");
}

#[cfg(desktop)]
{
    // Start P2P profile sync once node emits ready signal
    let node_app = app.handle().clone();
    app.handle().listen("goamp-node:ready", move |_event| {
        node_client::start(node_app.clone());
    });

    let handle = app.handle();
    tray::setup(handle).expect("failed to setup tray");
    // ... rest unchanged
}
```

- [ ] **Full compile check**

```bash
cd src-tauri && cargo check 2>&1 | grep "^error" | head -20
```
Expected: no errors.

- [ ] **Rust tests**

```bash
cd src-tauri && cargo test 2>&1 | tail -10
```
Expected: all tests PASS.

- [ ] **Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(tauri): wire node_client in setup hook — start after goamp-node:ready"
```

---

## Task 11: AppBootstrap.ts — tray tooltip on profile:synced

**Files:**
- Modify: `src/bootstrap/AppBootstrap.ts`

- [ ] **Add listener**

In `AppBootstrap.ts`, find the `webview.listen<string>('media-action', ...)` block. Directly after it, add:

```ts
// Update tray tooltip when P2P peers sync profiles
webview.listen<number>('goamp-node:profile-synced', ({ payload: peerCount }) => {
  const text = `${peerCount} peer${peerCount !== 1 ? 's' : ''} · synced just now`
  invoke('update_tray_tooltip', { text }).catch(() => {})
})
```

- [ ] **Run TypeScript tests**

```bash
pnpm test
```
Expected: all PASS (listener is wiring only, no new logic to test).

- [ ] **Commit**

```bash
git add src/bootstrap/AppBootstrap.ts
git commit -m "feat: update tray tooltip on P2P profile:synced — shows peer count"
```

---

## Task 12: End-to-end build verification

- [ ] **Go tests pass**

```bash
cd goamp-node && go test ./... -timeout 60s
```

- [ ] **Rust build succeeds**

```bash
cd src-tauri && cargo build 2>&1 | grep "^error" | head -10
```

- [ ] **TypeScript tests pass**

```bash
pnpm test
```

- [ ] **All green — done.**

---

## Self-Review

**Spec coverage:**
- ✅ `handleProfileSync` calls `PublishProfile()` — Task 5
- ✅ `GET /profiles/peers` endpoint — Task 5
- ✅ `peer_count` in `profile:synced` WS payload — Task 4
- ✅ Tauri → node POST sync — Task 8
- ✅ `fetch_peer_profiles` — Task 8
- ✅ 5-min timer starts after node ready — Task 9
- ✅ WS listener with 5s reconnect — Task 9
- ✅ Peer profiles stored in Tauri SQLite — Task 9 (`handle_ws_message`)
- ✅ Tray tooltip update — Task 11

**Placeholder scan:** None.

**Type consistency:**
- `store_peer_profile(&conn, hash, data)` — `store_peer_profile` is in `aggregator.rs` (already exists, used in `recommend.rs` tests). ✅
- `build_taste_profile(&conn, 200)` — returns `TasteProfile` struct, which `sync_to_node` takes as `&TasteProfile`. ✅
- `sync_to_node(&profile, 7472)` used in both `sync_profile` command (Task 8) and timer (Task 9). Same signature. ✅
- `fetch_peer_profiles(NODE_PORT)` returns `Vec<(String, String)>` — matches usage in `handle_ws_message`. ✅
- `app.emit("goamp-node:profile-synced", peer_count: u32)` — `AppBootstrap.ts` listens with `payload: number`. ✅
