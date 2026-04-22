# Multi-Device Sync — Plan 4: Session & Remote Control (HTTP MVP)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Cross-device session state (active device, current track, position, queue) and remote commands (play/pause/seek/takeover), shipped end-to-end via the existing HTTP relay using poll-based command delivery. No libp2p streams; no GossipSub.

**Architecture:** Relay grows a session-state slot (ephemeral, last-write-wins by Lamport `session_version`) and a per-account commands queue. Active device PUTs session every 2s (heartbeat) and pulls commands every 1s. Controllers POST commands. Takeover is just a special command + session bump. Stale-detection by client comparing `last_heartbeat` to wall clock with 60s tolerance.

**Tech Stack:** Existing Go stdlib stack. No new deps. Reuse `relay.SignRequest`/`VerifyRequest` for auth, `MemStore` for storage.

**Parent spec:** `docs/superpowers/specs/2026-04-20-multi-device-sync-design.md` §8 "Session & Remote Control".

**Out of scope (deferred):**
- libp2p `/goamp/remote/1.0` stream protocol (HTTP longpoll is the MVP transport)
- GossipSub session topic (HTTP polling instead)
- Mobile-specific battery optimization
- Multi-active "party mode" (explicitly non-goal in spec §2)
- Real audio playback wiring on the active device — Plan 4 ships the *protocol* end-to-end; UI hookup to the Webamp player happens in a separate UI plan

---

## File Map

**Create (Go):**
- `goamp-node/session/session.go` — `Session`, `Command` types + JSON
- `goamp-node/session/session_test.go`
- `goamp-node/relay/session_handlers.go` — `/session/{account_pub}` PUT/GET, `/commands/{account_pub}` POST/PULL
- `goamp-node/relay/session_handlers_test.go`
- `goamp-node/api/session_handlers.go` — Tauri-facing endpoints
- `goamp-node/api/session_handlers_test.go`

**Modify (Go):**
- `goamp-node/relay/server.go` — register session routes
- `goamp-node/relay/store.go` — add `Session` and `Commands` storage to `MemStore`
- `goamp-node/sync/client.go` — add session/command methods

---

## Task 1: Session + Command types

**Files:** `goamp-node/session/session.go`, `session_test.go`.

- [ ] **Test** — `session_test.go`:

```go
package session

import (
	"encoding/json"
	"testing"
)

func TestSessionJSONRoundTrip(t *testing.T) {
	s := Session{
		ActiveDeviceID: "dev1",
		Track:          TrackRef{TrackID: "t1", Source: "yt", Title: "Song"},
		PositionMs:     12345,
		PositionUpdatedAtNs: 1000,
		PlaybackState:  Playing,
		Queue:          []TrackRef{{TrackID: "t2"}},
		QueuePosition:  0,
		Shuffle:        false,
		Repeat:         RepeatOff,
		LastHeartbeatNs: 2000,
		Version:        7,
	}
	data, err := json.Marshal(s)
	if err != nil {
		t.Fatal(err)
	}
	var back Session
	if err := json.Unmarshal(data, &back); err != nil {
		t.Fatal(err)
	}
	if back.ActiveDeviceID != s.ActiveDeviceID || back.PositionMs != s.PositionMs || back.Version != s.Version {
		t.Fatal("roundtrip mismatch")
	}
}

func TestCommandJSONRoundTrip(t *testing.T) {
	c := Command{
		Op:        OpSeek,
		ArgInt:    42,
		IssuedBy:  "subpubX",
		IssuedAtNs: 100,
		Nonce:     []byte{1, 2, 3},
	}
	data, _ := json.Marshal(c)
	var back Command
	if err := json.Unmarshal(data, &back); err != nil {
		t.Fatal(err)
	}
	if back.Op != OpSeek || back.ArgInt != 42 || back.IssuedBy != "subpubX" {
		t.Fatal("cmd roundtrip mismatch")
	}
}
```

- [ ] **Impl** — `session.go`:

```go
// Package session defines the cross-device playback session and remote
// command types for multi-device sync.
package session

type PlaybackState string

const (
	Playing   PlaybackState = "playing"
	Paused    PlaybackState = "paused"
	Buffering PlaybackState = "buffering"
	Stopped   PlaybackState = "stopped"
)

type RepeatMode string

const (
	RepeatOff RepeatMode = "off"
	RepeatOne RepeatMode = "one"
	RepeatAll RepeatMode = "all"
)

type TrackRef struct {
	TrackID string `json:"track_id"`
	Source  string `json:"source"`
	Title   string `json:"title,omitempty"`
	Artist  string `json:"artist,omitempty"`
	URL     string `json:"url,omitempty"`
}

type Session struct {
	ActiveDeviceID      string        `json:"active_device_id"`
	Track               TrackRef      `json:"track"`
	PositionMs          uint64        `json:"position_ms"`
	PositionUpdatedAtNs int64         `json:"position_updated_at_ns"`
	PlaybackState       PlaybackState `json:"playback_state"`
	Queue               []TrackRef    `json:"queue"`
	QueuePosition       uint32        `json:"queue_position"`
	Shuffle             bool          `json:"shuffle"`
	Repeat              RepeatMode    `json:"repeat"`
	LastHeartbeatNs     int64         `json:"last_heartbeat_ns"`
	Version             uint64        `json:"version"`
}

type Op string

const (
	OpPlay        Op = "play"
	OpPause       Op = "pause"
	OpSeek        Op = "seek"
	OpNext        Op = "next"
	OpPrev        Op = "prev"
	OpAddToQueue  Op = "add_to_queue"
	OpSetShuffle  Op = "set_shuffle"
	OpSetRepeat   Op = "set_repeat"
	OpPlayTrack   Op = "play_track"
	OpTakeover    Op = "takeover"
)

type Command struct {
	Op         Op       `json:"op"`
	ArgInt     int64    `json:"arg_int,omitempty"`
	ArgStr     string   `json:"arg_str,omitempty"`
	ArgTrack   *TrackRef `json:"arg_track,omitempty"`
	IssuedBy   string   `json:"issued_by"`
	IssuedAtNs int64    `json:"issued_at_ns"`
	Nonce      []byte   `json:"nonce"`
}
```

- [ ] **Verify** — 2 tests pass.

- [ ] **Commit** — `feat(node/session): Session + Command types`.

---

## Task 2: Relay storage extensions

**Modify** `goamp-node/relay/store.go` — append:

```go
type sessionEntry struct {
	Data    []byte
	Version uint64
}

// (add to MemStore struct)
//   sessions map[string]sessionEntry
//   commands map[string][][]byte  // queued raw command bytes per account
//   sessionMu separate? — use existing mu
```

Concrete patch — extend MemStore + helpers:

```go
// Add to MemStore struct definition:
//   sessions map[string]sessionEntry
//   commands map[string][][]byte
// And initialize in NewMemStore.

// PutSession accepts only newer Lamport versions.
func (s *MemStore) PutSession(accountPub string, version uint64, data []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if cur, ok := s.sessions[accountPub]; ok {
		if version <= cur.Version {
			return fmt.Errorf("stale session version %d (current %d)", version, cur.Version)
		}
	}
	s.sessions[accountPub] = sessionEntry{Data: append([]byte(nil), data...), Version: version}
	return nil
}

func (s *MemStore) GetSession(accountPub string) ([]byte, uint64, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	cur, ok := s.sessions[accountPub]
	if !ok {
		return nil, 0, false
	}
	return append([]byte(nil), cur.Data...), cur.Version, true
}

func (s *MemStore) EnqueueCommand(accountPub string, raw []byte) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.commands[accountPub] = append(s.commands[accountPub], append([]byte(nil), raw...))
}

// DrainCommands returns and clears the queue for accountPub.
func (s *MemStore) DrainCommands(accountPub string) [][]byte {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := s.commands[accountPub]
	delete(s.commands, accountPub)
	return out
}
```

Update `NewMemStore` to initialize the new maps.

**Tests** — extend `goamp-node/relay/store_test.go`:

```go
func TestSessionMonotonic(t *testing.T) {
	s := NewMemStore()
	if err := s.PutSession("a", 1, []byte("v1")); err != nil {
		t.Fatal(err)
	}
	if err := s.PutSession("a", 1, []byte("v1b")); err == nil {
		t.Fatal("expected stale rejection")
	}
	if err := s.PutSession("a", 2, []byte("v2")); err != nil {
		t.Fatal(err)
	}
	data, v, ok := s.GetSession("a")
	if !ok || v != 2 || string(data) != "v2" {
		t.Fatalf("got v=%d data=%q", v, data)
	}
}

func TestCommandQueueDrain(t *testing.T) {
	s := NewMemStore()
	s.EnqueueCommand("a", []byte("c1"))
	s.EnqueueCommand("a", []byte("c2"))
	got := s.DrainCommands("a")
	if len(got) != 2 || string(got[0]) != "c1" || string(got[1]) != "c2" {
		t.Fatalf("drain wrong: %q", got)
	}
	if len(s.DrainCommands("a")) != 0 {
		t.Fatal("queue not cleared after drain")
	}
}
```

- [ ] **Verify** — extended tests pass.

- [ ] **Commit** — `feat(node/relay): MemStore session + commands queue`.

---

## Task 3: Relay HTTP endpoints

`PUT /session/{account_pub}` — body = signed Session JSON. Auth: active sub-key. Body includes `version` field; relay enforces monotonic.

`GET /session/{account_pub}` — auth: active sub-key. Returns latest session JSON or 404.

`POST /commands/{account_pub}` — body = signed Command JSON. Auth: active sub-key. Enqueues.

`POST /commands/{account_pub}/pull` — auth: active sub-key. Drains and returns array of pending commands.

**Files:** `goamp-node/relay/session_handlers.go`, `session_handlers_test.go`. Modify `server.go` to register routes.

(Implementation pattern matches existing `state` handlers — auth via `authorizeActive`. See task 3 of Plan 2 for the pattern.)

- [ ] **Implement** — `session_handlers.go`:

```go
package relay

import (
	"encoding/json"
	"io"
	"net/http"
	"time"
)

func (h *handlers) putSession(w http.ResponseWriter, r *http.Request) {
	accountPub := r.PathValue("account_pub")
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "read body", http.StatusBadRequest)
		return
	}
	if _, err := h.authorizeActive(r, accountPub, body); err != nil {
		http.Error(w, err.Error(), http.StatusUnauthorized)
		return
	}
	var probe struct {
		Version uint64 `json:"version"`
	}
	if err := json.Unmarshal(body, &probe); err != nil {
		http.Error(w, "decode: "+err.Error(), 400)
		return
	}
	if err := h.store.PutSession(accountPub, probe.Version, body); err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	w.WriteHeader(200)
}

func (h *handlers) getSession(w http.ResponseWriter, r *http.Request) {
	accountPub := r.PathValue("account_pub")
	if _, err := h.authorizeActive(r, accountPub, nil); err != nil {
		http.Error(w, err.Error(), http.StatusUnauthorized)
		return
	}
	data, _, ok := h.store.GetSession(accountPub)
	if !ok {
		http.Error(w, "not found", 404)
		return
	}
	w.Header().Set("content-type", "application/json")
	_, _ = w.Write(data)
}

func (h *handlers) postCommand(w http.ResponseWriter, r *http.Request) {
	accountPub := r.PathValue("account_pub")
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "read body", 400)
		return
	}
	if _, err := h.authorizeActive(r, accountPub, body); err != nil {
		http.Error(w, err.Error(), http.StatusUnauthorized)
		return
	}
	h.store.EnqueueCommand(accountPub, body)
	w.WriteHeader(200)
}

func (h *handlers) pullCommands(w http.ResponseWriter, r *http.Request) {
	accountPub := r.PathValue("account_pub")
	if _, err := h.authorizeActive(r, accountPub, nil); err != nil {
		http.Error(w, err.Error(), http.StatusUnauthorized)
		return
	}
	cmds := h.store.DrainCommands(accountPub)
	out := make([]json.RawMessage, 0, len(cmds))
	for _, raw := range cmds {
		out = append(out, raw)
	}
	w.Header().Set("content-type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"commands":   out,
		"server_ts":  time.Now().UnixNano(),
	})
}
```

In `goamp-node/relay/server.go` `NewServer`, append:

```go
	mux.HandleFunc("PUT /session/{account_pub}", h.putSession)
	mux.HandleFunc("GET /session/{account_pub}", h.getSession)
	mux.HandleFunc("POST /commands/{account_pub}", h.postCommand)
	mux.HandleFunc("POST /commands/{account_pub}/pull", h.pullCommands)
```

**Tests** — `session_handlers_test.go`:

```go
package relay

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"testing"
	"time"
)

func TestSessionPutAndGet(t *testing.T) {
	srv, store := newTestServer()
	defer srv.Close()
	fx := newAccountFixture(t)
	_ = store.PutManifest(fx.manifest)

	body := []byte(`{"version":1,"active_device_id":"dev"}`)
	hdr, _ := SignRequest(fx.sub, "PUT", "/session/"+fx.pub, body, time.Now().UnixNano())
	resp, _ := putJSON(srv.URL+"/session/"+fx.pub, body, hdr)
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		msg, _ := io.ReadAll(resp.Body)
		t.Fatalf("put status %d: %s", resp.StatusCode, msg)
	}

	hdr2, _ := SignRequest(fx.sub, "GET", "/session/"+fx.pub, nil, time.Now().UnixNano())
	req, _ := http.NewRequest("GET", srv.URL+"/session/"+fx.pub, nil)
	req.Header.Set("X-GOAMP-Sig", hdr2)
	resp2, _ := http.DefaultClient.Do(req)
	defer resp2.Body.Close()
	if resp2.StatusCode != 200 {
		t.Fatalf("get status %d", resp2.StatusCode)
	}
	got, _ := io.ReadAll(resp2.Body)
	if !bytes.Contains(got, []byte(`"active_device_id":"dev"`)) {
		t.Fatalf("body wrong: %s", got)
	}
}

func TestSessionPutRejectsStaleVersion(t *testing.T) {
	srv, store := newTestServer()
	defer srv.Close()
	fx := newAccountFixture(t)
	_ = store.PutManifest(fx.manifest)
	body1 := []byte(`{"version":2}`)
	hdr1, _ := SignRequest(fx.sub, "PUT", "/session/"+fx.pub, body1, time.Now().UnixNano())
	_, _ = putJSON(srv.URL+"/session/"+fx.pub, body1, hdr1)

	body2 := []byte(`{"version":1}`)
	hdr2, _ := SignRequest(fx.sub, "PUT", "/session/"+fx.pub, body2, time.Now().UnixNano())
	resp, _ := putJSON(srv.URL+"/session/"+fx.pub, body2, hdr2)
	defer resp.Body.Close()
	if resp.StatusCode != 409 {
		t.Fatalf("status %d want 409", resp.StatusCode)
	}
}

func TestCommandPostAndPull(t *testing.T) {
	srv, store := newTestServer()
	defer srv.Close()
	fx := newAccountFixture(t)
	_ = store.PutManifest(fx.manifest)

	cmd := []byte(`{"op":"pause","issued_by":"x","issued_at_ns":1,"nonce":"AAAA"}`)
	hdr, _ := SignRequest(fx.sub, "POST", "/commands/"+fx.pub, cmd, time.Now().UnixNano())
	resp, _ := http.NewRequest("POST", srv.URL+"/commands/"+fx.pub, bytes.NewReader(cmd))
	resp.Header.Set("X-GOAMP-Sig", hdr)
	r1, _ := http.DefaultClient.Do(resp)
	r1.Body.Close()
	if r1.StatusCode != 200 {
		t.Fatalf("post status %d", r1.StatusCode)
	}

	hdr2, _ := SignRequest(fx.sub, "POST", "/commands/"+fx.pub+"/pull", nil, time.Now().UnixNano())
	pullReq, _ := http.NewRequest("POST", srv.URL+"/commands/"+fx.pub+"/pull", nil)
	pullReq.Header.Set("X-GOAMP-Sig", hdr2)
	r2, _ := http.DefaultClient.Do(pullReq)
	defer r2.Body.Close()
	if r2.StatusCode != 200 {
		t.Fatalf("pull status %d", r2.StatusCode)
	}
	var out struct {
		Commands []json.RawMessage `json:"commands"`
	}
	_ = json.NewDecoder(r2.Body).Decode(&out)
	if len(out.Commands) != 1 {
		t.Fatalf("pulled %d cmds", len(out.Commands))
	}
}
```

- [ ] **Verify** — full test suite green.

- [ ] **Commit** — `feat(node/relay): /session and /commands HTTP endpoints`.

---

## Task 4: sync.Client extensions

Add to `goamp-node/sync/client.go`:

```go
// PutSession uploads JSON-encoded session bytes to the relay.
func (c *Client) PutSession(accountPub string, sub *account.SubKey, sessionJSON []byte) error {
	path := "/session/" + accountPub
	req, _ := http.NewRequest(http.MethodPut, c.baseURL+path, bytes.NewReader(sessionJSON))
	hdr, err := relay.SignRequest(sub, req.Method, path, sessionJSON, time.Now().UnixNano())
	if err != nil {
		return err
	}
	req.Header.Set("X-GOAMP-Sig", hdr)
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		msg, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("put session: %d %s", resp.StatusCode, msg)
	}
	return nil
}

func (c *Client) GetSession(accountPub string, sub *account.SubKey) ([]byte, error) {
	path := "/session/" + accountPub
	req, _ := http.NewRequest(http.MethodGet, c.baseURL+path, nil)
	hdr, err := relay.SignRequest(sub, req.Method, path, nil, time.Now().UnixNano())
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-GOAMP-Sig", hdr)
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == 404 {
		return nil, nil
	}
	if resp.StatusCode/100 != 2 {
		msg, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("get session: %d %s", resp.StatusCode, msg)
	}
	return io.ReadAll(resp.Body)
}

func (c *Client) PostCommand(accountPub string, sub *account.SubKey, cmdJSON []byte) error {
	path := "/commands/" + accountPub
	req, _ := http.NewRequest(http.MethodPost, c.baseURL+path, bytes.NewReader(cmdJSON))
	hdr, err := relay.SignRequest(sub, req.Method, path, cmdJSON, time.Now().UnixNano())
	if err != nil {
		return err
	}
	req.Header.Set("X-GOAMP-Sig", hdr)
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		msg, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("post command: %d %s", resp.StatusCode, msg)
	}
	return nil
}

// PullCommands drains and returns pending commands.
func (c *Client) PullCommands(accountPub string, sub *account.SubKey) ([][]byte, error) {
	path := "/commands/" + accountPub + "/pull"
	req, _ := http.NewRequest(http.MethodPost, c.baseURL+path, nil)
	hdr, err := relay.SignRequest(sub, req.Method, path, nil, time.Now().UnixNano())
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-GOAMP-Sig", hdr)
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		msg, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("pull commands: %d %s", resp.StatusCode, msg)
	}
	var out struct {
		Commands []json.RawMessage `json:"commands"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	res := make([][]byte, len(out.Commands))
	for i, c := range out.Commands {
		res[i] = []byte(c)
	}
	return res, nil
}
```

(Add `"encoding/json"` import if not present.)

**Test** — extend `client_test.go`:

```go
func TestSessionAndCommandsRoundTrip(t *testing.T) {
	c, sub, _ := bootstrap(t)
	if err := c.PutSession(c.lastAccountPub(), sub, []byte(`{"version":1,"active_device_id":"d"}`)); err != nil {
		t.Fatal(err)
	}
	got, err := c.GetSession(c.lastAccountPub(), sub)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(got, []byte("active_device_id")) {
		t.Fatal("session body wrong")
	}
	if err := c.PostCommand(c.lastAccountPub(), sub, []byte(`{"op":"pause"}`)); err != nil {
		t.Fatal(err)
	}
	cmds, err := c.PullCommands(c.lastAccountPub(), sub)
	if err != nil {
		t.Fatal(err)
	}
	if len(cmds) != 1 || !bytes.Contains(cmds[0], []byte("pause")) {
		t.Fatalf("got %d cmds: %v", len(cmds), cmds)
	}
}
```

(Add `bytes` import if needed.)

- [ ] **Commit** — `feat(node/sync): PutSession/GetSession/PostCommand/PullCommands`.

---

## Task 5: goamp-node API endpoints (Tauri-facing)

Endpoints (mirror state handler pattern — body carries `account_pub`, `sub_sk_b64`, `relay_url`, plus payload as needed):

- `POST /session/put` — body adds `session_json`
- `POST /session/get` — returns `{session_json}`
- `POST /commands/post` — body adds `command_json`
- `POST /commands/pull` — returns `{commands: [...]}`

**Files:** `goamp-node/api/session_handlers.go`, `session_handlers_test.go`.

```go
package api

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/goamp/sdk/account"
	"github.com/goamp/sdk/sync"
)

func (s *Server) RegisterSessionRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /session/put", s.handleSessionPut)
	mux.HandleFunc("POST /session/get", s.handleSessionGet)
	mux.HandleFunc("POST /commands/post", s.handleCommandPost)
	mux.HandleFunc("POST /commands/pull", s.handleCommandPull)
}

type sessionReq struct {
	AccountPub  string `json:"account_pub"`
	SubSkB64    string `json:"sub_sk_b64"`
	RelayURL    string `json:"relay_url"`
	SessionJSON string `json:"session_json,omitempty"`
	CommandJSON string `json:"command_json,omitempty"`
}

func (r *sessionReq) sub() (*account.SubKey, error) {
	b, err := base64.StdEncoding.DecodeString(r.SubSkB64)
	if err != nil || len(b) != ed25519.PrivateKeySize {
		return nil, fmt.Errorf("sub_sk_b64 invalid")
	}
	sk := ed25519.PrivateKey(b)
	pub, _ := sk.Public().(ed25519.PublicKey)
	return &account.SubKey{PrivateKey: sk, PublicKey: pub}, nil
}

func (s *Server) handleSessionPut(w http.ResponseWriter, r *http.Request) {
	var req sessionReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad json", 400)
		return
	}
	sub, err := req.sub()
	if err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	c := sync.NewClient(req.RelayURL)
	if err := c.PutSession(req.AccountPub, sub, []byte(req.SessionJSON)); err != nil {
		http.Error(w, err.Error(), 502)
		return
	}
	writeJSON(w, map[string]bool{"ok": true})
}

func (s *Server) handleSessionGet(w http.ResponseWriter, r *http.Request) {
	var req sessionReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad json", 400)
		return
	}
	sub, err := req.sub()
	if err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	c := sync.NewClient(req.RelayURL)
	data, err := c.GetSession(req.AccountPub, sub)
	if err != nil {
		http.Error(w, err.Error(), 502)
		return
	}
	writeJSON(w, map[string]string{"session_json": string(data)})
}

func (s *Server) handleCommandPost(w http.ResponseWriter, r *http.Request) {
	var req sessionReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad json", 400)
		return
	}
	sub, err := req.sub()
	if err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	c := sync.NewClient(req.RelayURL)
	if err := c.PostCommand(req.AccountPub, sub, []byte(req.CommandJSON)); err != nil {
		http.Error(w, err.Error(), 502)
		return
	}
	writeJSON(w, map[string]bool{"ok": true})
}

func (s *Server) handleCommandPull(w http.ResponseWriter, r *http.Request) {
	var req sessionReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad json", 400)
		return
	}
	sub, err := req.sub()
	if err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	c := sync.NewClient(req.RelayURL)
	cmds, err := c.PullCommands(req.AccountPub, sub)
	if err != nil {
		http.Error(w, err.Error(), 502)
		return
	}
	out := make([]string, len(cmds))
	for i, b := range cmds {
		out[i] = string(b)
	}
	writeJSON(w, map[string]interface{}{"commands": out})
}
```

Register in `server.go` Start: `s.RegisterSessionRoutes(mux)`.

**Test** — `session_handlers_test.go`: end-to-end (spawn relay httptest, spawn node httptest with these routes, bootstrap account, run put/get/post/pull cycle). Pattern matches existing `state_handlers_test.go`.

- [ ] **Verify** — `go test ./...` green.

- [ ] **Commit** — `feat(node/api): /session and /commands Tauri-facing endpoints`.

---

## Task 6: Milestone

- [ ] `git tag -a multi-device-p4-session-remote -m "Plan 4: session + remote commands via HTTP relay"`.

---

## Self-Review

**Spec coverage (§8):**
- Session schema (active_device, track, position, queue, repeat, version) ✓
- Heartbeat (active device PUTs session every 2s) — protocol supports it; the *timer* lives on Tauri side, future plan.
- Remote commands ✓
- TTL/replay protection — partial (signed-request 30s clock skew exists from P2; per-nonce dedup not implemented in MVP)
- Takeover flow — `OpTakeover` defined; client logic (compare versions, decide) is Tauri-side
- libp2p transport — replaced with HTTP polling for MVP
- Stale-detection 60s — client compares `last_heartbeat_ns` to wall-clock; client logic future plan

**Deferred work for a later "Plan 4.5 — client wiring":** Rust `RemoteService` that calls these endpoints on a 1s/2s timer, integrates with Webamp player to apply received commands, surfaces takeover dialogs in UI.

**Type consistency:** `Session.Version` matches the `version` field relay reads to enforce monotonic. `Command.Op` typed string consistent across packages.
