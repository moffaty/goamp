# Multi-Device Sync — Plan 3: User State Sync (MVP, LWW + Encryption)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Encrypt user state (playlists, likes, settings) with the per-account ChaCha20-Poly1305 `state_key`, push to the relay on a 5-minute debounced cadence, pull on reconnect, and merge with last-write-wins (LWW) semantics keyed by Lamport timestamp per field.

**Architecture:** New Go package `goamp-node/userstate/` with a JSON-serializable `UserState` struct whose scalar fields carry `updated_at` Lamport timestamps and whose set/map fields use `AddedAt` tombstones. `goamp-node/userstate/crypto.go` wraps ChaCha20-Poly1305 seal/open. `sync.Client` gains `SyncUp(stateKey, state)` and `SyncDown(stateKey)` helpers that encrypt/decrypt around the existing `PutState`/`GetState`. HTTP endpoints on goamp-node expose these to Tauri. A 5-min timer in Rust triggers `state_sync` periodically.

**Tech Stack:** Go `golang.org/x/crypto/chacha20poly1305` (or std `crypto/cipher` if Go 1.25+ has native — use x/crypto for portability), existing account/relay/sync packages. No Automerge, no GossipSub, no libp2p — deferred to P4.

**Parent spec:** `docs/superpowers/specs/2026-04-20-multi-device-sync-design.md` §7 "User State Sync" (CRDT via Automerge → simplified to LWW for MVP; Automerge-proper deferred). §4 encryption (ChaCha20-Poly1305).

**Out of scope:** Automerge CRDT (text-editing-grade convergence), realtime delta stream via GossipSub, weekly compaction, conflict-resolution dialogs, privacy switches (Global/Per-device/Incognito — deferred to P5 UX).

---

## File Map

**Create (Go):**
- `goamp-node/userstate/state.go` — `UserState` schema + LWW merge
- `goamp-node/userstate/state_test.go`
- `goamp-node/userstate/crypto.go` — ChaCha20-Poly1305 seal/open
- `goamp-node/userstate/crypto_test.go`
- `goamp-node/api/state_handlers.go` — HTTP endpoints `/state/sync-up`, `/state/sync-down`
- `goamp-node/api/state_handlers_test.go`

**Modify (Go):**
- `goamp-node/go.mod` — add `golang.org/x/crypto` if not present
- `goamp-node/sync/client.go` — add `SyncUp(stateKey, plaintext []byte)`, `SyncDown(stateKey)` methods
- `goamp-node/sync/client_test.go` — cover encrypted round-trip
- `goamp-node/api/server.go` — register state sync routes

---

## Task 1: ChaCha20-Poly1305 seal/open

**Files:** `goamp-node/userstate/crypto.go`, `crypto_test.go`.

Wire format per blob: `nonce(12) || ciphertext(...) || tag(16)`. Key must be 32 bytes (matches `account.DeriveStateKey` output).

- [ ] **Step 1 — failing test:**

```go
package userstate

import (
	"bytes"
	"crypto/rand"
	"testing"
)

func TestSealOpenRoundTrip(t *testing.T) {
	var key [32]byte
	_, _ = rand.Read(key[:])
	plain := []byte("hello goamp")
	ct, err := Seal(key[:], plain)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(ct, plain) {
		t.Fatal("ciphertext leaked plaintext")
	}
	out, err := Open(key[:], ct)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(out, plain) {
		t.Fatal("round-trip mismatch")
	}
}

func TestOpenRejectsTamperedCiphertext(t *testing.T) {
	var key [32]byte
	_, _ = rand.Read(key[:])
	ct, _ := Seal(key[:], []byte("x"))
	ct[len(ct)-1] ^= 0x01
	if _, err := Open(key[:], ct); err == nil {
		t.Fatal("expected auth failure")
	}
}

func TestOpenRejectsWrongKey(t *testing.T) {
	var k1, k2 [32]byte
	_, _ = rand.Read(k1[:])
	_, _ = rand.Read(k2[:])
	ct, _ := Seal(k1[:], []byte("x"))
	if _, err := Open(k2[:], ct); err == nil {
		t.Fatal("expected auth failure")
	}
}

func TestSealEmptyAllowed(t *testing.T) {
	var k [32]byte
	_, _ = rand.Read(k[:])
	ct, err := Seal(k[:], nil)
	if err != nil {
		t.Fatal(err)
	}
	out, err := Open(k[:], ct)
	if err != nil {
		t.Fatal(err)
	}
	if len(out) != 0 {
		t.Fatalf("empty roundtrip: %d bytes", len(out))
	}
}

func TestKeySizeValidated(t *testing.T) {
	bad := make([]byte, 16)
	if _, err := Seal(bad, []byte("x")); err == nil {
		t.Fatal("expected key-size error")
	}
}
```

- [ ] **Step 2** — confirm FAIL.

- [ ] **Step 3 — impl:**

```go
// Package userstate manages per-account encrypted user state and LWW
// conflict resolution for GOAMP's multi-device sync.
package userstate

import (
	"crypto/rand"
	"fmt"

	"golang.org/x/crypto/chacha20poly1305"
)

// Seal encrypts plaintext with key (32 bytes) using ChaCha20-Poly1305 with
// a fresh 12-byte nonce. Output layout: nonce || ciphertext || tag.
func Seal(key, plaintext []byte) ([]byte, error) {
	if len(key) != chacha20poly1305.KeySize {
		return nil, fmt.Errorf("state key must be %d bytes, got %d", chacha20poly1305.KeySize, len(key))
	}
	aead, err := chacha20poly1305.New(key)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	out := make([]byte, 0, len(nonce)+len(plaintext)+aead.Overhead())
	out = append(out, nonce...)
	out = aead.Seal(out, nonce, plaintext, nil)
	return out, nil
}

// Open reverses Seal.
func Open(key, blob []byte) ([]byte, error) {
	if len(key) != chacha20poly1305.KeySize {
		return nil, fmt.Errorf("state key must be %d bytes, got %d", chacha20poly1305.KeySize, len(key))
	}
	aead, err := chacha20poly1305.New(key)
	if err != nil {
		return nil, err
	}
	if len(blob) < aead.NonceSize()+aead.Overhead() {
		return nil, fmt.Errorf("blob too short")
	}
	nonce, ct := blob[:aead.NonceSize()], blob[aead.NonceSize():]
	return aead.Open(nil, nonce, ct, nil)
}
```

- [ ] **Step 4** — `cd goamp-node && go get golang.org/x/crypto && go mod tidy && go test ./userstate/... -v` → 5 tests pass.

- [ ] **Step 5 — commit** — `feat(node/userstate): ChaCha20-Poly1305 seal/open for state blobs`.

---

## Task 2: UserState schema + LWW merge

**Files:** `goamp-node/userstate/state.go`, `state_test.go`.

MVP schema: playlists (map of id → playlist), liked/disliked tracks (maps of track_id → addedAt), settings (map of key → {value, updated_at}). No history/subscriptions/taste_profile in P3 — those are P5 extensions.

- [ ] **Step 1 — failing test:**

```go
package userstate

import (
	"testing"
	"time"
)

func TestMergeLikedTracksUnion(t *testing.T) {
	a := NewUserState()
	b := NewUserState()
	a.LikeTrack("track-1", time.Unix(100, 0))
	b.LikeTrack("track-2", time.Unix(200, 0))

	merged := Merge(a, b)
	if !merged.IsLiked("track-1") {
		t.Fatal("missing track-1")
	}
	if !merged.IsLiked("track-2") {
		t.Fatal("missing track-2")
	}
}

func TestMergeLikeWinsOverOlderUnlike(t *testing.T) {
	a := NewUserState()
	a.LikeTrack("t", time.Unix(100, 0))
	b := NewUserState()
	b.UnlikeTrack("t", time.Unix(50, 0)) // older

	merged := Merge(a, b)
	if !merged.IsLiked("t") {
		t.Fatal("newer like should win over older unlike")
	}
}

func TestMergeUnlikeWinsOverOlderLike(t *testing.T) {
	a := NewUserState()
	a.LikeTrack("t", time.Unix(100, 0))
	b := NewUserState()
	b.UnlikeTrack("t", time.Unix(200, 0)) // newer

	merged := Merge(a, b)
	if merged.IsLiked("t") {
		t.Fatal("newer unlike should win")
	}
}

func TestMergeSettingLastWriteWins(t *testing.T) {
	a := NewUserState()
	b := NewUserState()
	a.SetSetting("theme", "dark", time.Unix(100, 0))
	b.SetSetting("theme", "light", time.Unix(200, 0))

	merged := Merge(a, b)
	if v, _ := merged.Setting("theme"); v != "light" {
		t.Fatalf("got %q want light", v)
	}
}

func TestMergePlaylistAddedBoth(t *testing.T) {
	a := NewUserState()
	b := NewUserState()
	a.UpsertPlaylist(Playlist{ID: "p1", Name: "Mixes", Tracks: []string{"t1"}, UpdatedAt: time.Unix(100, 0)})
	b.UpsertPlaylist(Playlist{ID: "p2", Name: "Chill", Tracks: []string{"t2"}, UpdatedAt: time.Unix(150, 0)})

	merged := Merge(a, b)
	if _, ok := merged.Playlist("p1"); !ok {
		t.Fatal("missing p1")
	}
	if _, ok := merged.Playlist("p2"); !ok {
		t.Fatal("missing p2")
	}
}

func TestMergePlaylistNewerWins(t *testing.T) {
	a := NewUserState()
	a.UpsertPlaylist(Playlist{ID: "p", Name: "Old", UpdatedAt: time.Unix(100, 0)})
	b := NewUserState()
	b.UpsertPlaylist(Playlist{ID: "p", Name: "New", UpdatedAt: time.Unix(200, 0)})

	merged := Merge(a, b)
	p, _ := merged.Playlist("p")
	if p.Name != "New" {
		t.Fatalf("got %q", p.Name)
	}
}

func TestJSONRoundTrip(t *testing.T) {
	s := NewUserState()
	s.LikeTrack("t", time.Unix(100, 0))
	s.SetSetting("theme", "dark", time.Unix(50, 0))
	s.UpsertPlaylist(Playlist{ID: "p", Name: "X", UpdatedAt: time.Unix(200, 0)})

	data, err := s.MarshalJSON()
	if err != nil {
		t.Fatal(err)
	}
	var back UserState
	if err := back.UnmarshalJSON(data); err != nil {
		t.Fatal(err)
	}
	if !back.IsLiked("t") {
		t.Fatal("liked lost")
	}
	if v, _ := back.Setting("theme"); v != "dark" {
		t.Fatal("setting lost")
	}
	if p, _ := back.Playlist("p"); p.Name != "X" {
		t.Fatal("playlist lost")
	}
}
```

- [ ] **Step 2** — confirm FAIL.

- [ ] **Step 3 — impl** — `state.go`:

```go
package userstate

import (
	"encoding/json"
	"time"
)

// Playlist carries an LWW timestamp on the whole record (no per-track
// position LWW yet; P5 upgrade adds it).
type Playlist struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Tracks    []string  `json:"tracks"`
	UpdatedAt time.Time `json:"updated_at"`
}

// stampedBool records a bool with a Lamport timestamp. For likes/dislikes:
// true = liked, false = unliked (tombstone).
type stampedBool struct {
	Value     bool      `json:"value"`
	UpdatedAt time.Time `json:"updated_at"`
}

type stampedString struct {
	Value     string    `json:"value"`
	UpdatedAt time.Time `json:"updated_at"`
}

// UserState is the synced per-account state. All fields use LWW merge.
type UserState struct {
	Playlists    map[string]Playlist      `json:"playlists"`
	LikedTracks  map[string]stampedBool   `json:"liked_tracks"`
	Settings     map[string]stampedString `json:"settings"`
}

func NewUserState() *UserState {
	return &UserState{
		Playlists:   map[string]Playlist{},
		LikedTracks: map[string]stampedBool{},
		Settings:    map[string]stampedString{},
	}
}

func (s *UserState) LikeTrack(id string, at time.Time) {
	s.LikedTracks[id] = stampedBool{Value: true, UpdatedAt: at.UTC()}
}

func (s *UserState) UnlikeTrack(id string, at time.Time) {
	s.LikedTracks[id] = stampedBool{Value: false, UpdatedAt: at.UTC()}
}

func (s *UserState) IsLiked(id string) bool {
	v, ok := s.LikedTracks[id]
	return ok && v.Value
}

func (s *UserState) SetSetting(key, value string, at time.Time) {
	s.Settings[key] = stampedString{Value: value, UpdatedAt: at.UTC()}
}

func (s *UserState) Setting(key string) (string, bool) {
	v, ok := s.Settings[key]
	if !ok {
		return "", false
	}
	return v.Value, true
}

func (s *UserState) UpsertPlaylist(p Playlist) {
	p.UpdatedAt = p.UpdatedAt.UTC()
	s.Playlists[p.ID] = p
}

func (s *UserState) Playlist(id string) (Playlist, bool) {
	p, ok := s.Playlists[id]
	return p, ok
}

func (s *UserState) MarshalJSON() ([]byte, error) {
	type alias UserState
	return json.Marshal((*alias)(s))
}

func (s *UserState) UnmarshalJSON(data []byte) error {
	type alias UserState
	tmp := &alias{}
	if err := json.Unmarshal(data, tmp); err != nil {
		return err
	}
	if tmp.Playlists == nil {
		tmp.Playlists = map[string]Playlist{}
	}
	if tmp.LikedTracks == nil {
		tmp.LikedTracks = map[string]stampedBool{}
	}
	if tmp.Settings == nil {
		tmp.Settings = map[string]stampedString{}
	}
	*s = UserState(*tmp)
	return nil
}

// Merge combines a and b by LWW on every stamped field. Neither argument
// is mutated; the result is a fresh *UserState.
func Merge(a, b *UserState) *UserState {
	out := NewUserState()
	mergeStampedBools(out.LikedTracks, a.LikedTracks, b.LikedTracks)
	mergeStampedStrings(out.Settings, a.Settings, b.Settings)
	mergePlaylists(out.Playlists, a.Playlists, b.Playlists)
	return out
}

func mergeStampedBools(out, a, b map[string]stampedBool) {
	for k, v := range a {
		out[k] = v
	}
	for k, v := range b {
		cur, ok := out[k]
		if !ok || v.UpdatedAt.After(cur.UpdatedAt) {
			out[k] = v
		}
	}
}

func mergeStampedStrings(out, a, b map[string]stampedString) {
	for k, v := range a {
		out[k] = v
	}
	for k, v := range b {
		cur, ok := out[k]
		if !ok || v.UpdatedAt.After(cur.UpdatedAt) {
			out[k] = v
		}
	}
}

func mergePlaylists(out, a, b map[string]Playlist) {
	for k, v := range a {
		out[k] = v
	}
	for k, v := range b {
		cur, ok := out[k]
		if !ok || v.UpdatedAt.After(cur.UpdatedAt) {
			out[k] = v
		}
	}
}
```

- [ ] **Step 4** — 7 tests pass.

- [ ] **Step 5 — commit** — `feat(node/userstate): UserState schema + LWW merge + JSON`.

---

## Task 3: Sync client — encrypted PutState/GetState

**Files modified:** `goamp-node/sync/client.go`, `goamp-node/sync/client_test.go`.

Add methods: `(c *Client) SyncUp(stateKey []byte, sub *account.SubKey, plaintext []byte) error` — seals, calls `PutState`. `SyncDown(stateKey []byte, sub *account.SubKey) ([]byte, error)` — calls `GetState`, opens. Returns `nil, nil` for missing blob.

- [ ] **Step 1 — append test** to `client_test.go`:

```go
func TestSyncUpDownRoundTrip(t *testing.T) {
	c, sub, _ := bootstrap(t)
	var key [32]byte
	for i := range key {
		key[i] = byte(i)
	}
	plain := []byte("state-blob")
	if err := c.SyncUp(key[:], sub, plain); err != nil {
		t.Fatal(err)
	}
	got, err := c.SyncDown(key[:], sub)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "state-blob" {
		t.Fatalf("got %q", got)
	}
}

func TestSyncDownMissingReturnsNil(t *testing.T) {
	c, sub, _ := bootstrap(t)
	var key [32]byte
	got, err := c.SyncDown(key[:], sub)
	if err != nil {
		t.Fatal(err)
	}
	if got != nil {
		t.Fatal("expected nil on missing blob")
	}
}
```

- [ ] **Step 2** — confirm FAIL (undefined SyncUp/SyncDown).

- [ ] **Step 3 — append to `client.go`:**

```go
import (
	// ... existing imports
	"github.com/goamp/sdk/userstate"
)

// SyncUp encrypts plaintext with stateKey and uploads to /state.
func (c *Client) SyncUp(stateKey []byte, sub *account.SubKey, plaintext []byte) error {
	ct, err := userstate.Seal(stateKey, plaintext)
	if err != nil {
		return err
	}
	return c.PutState(c.lastAccountPubVal, sub, ct)
}

// SyncDown fetches the latest state blob and decrypts it. Returns nil,nil
// if no blob exists yet.
func (c *Client) SyncDown(stateKey []byte, sub *account.SubKey) ([]byte, error) {
	blob, err := c.GetState(c.lastAccountPubVal, sub)
	if err != nil {
		return nil, err
	}
	if blob == nil {
		return nil, nil
	}
	return userstate.Open(stateKey, blob)
}
```

- [ ] **Step 4** — 2 new tests pass, total sync/ = 5.

- [ ] **Step 5 — commit** — `feat(node/sync): SyncUp/SyncDown — encrypted state wrapper`.

---

## Task 4: HTTP endpoints `/state/sync-up` and `/state/sync-down`

Since Tauri already has state_key + sub_sk in keychain, it passes them in the request body (loopback only). The node builds a one-shot `sync.Client` against a configurable relay URL (fallback default `http://localhost:7480`).

**Files:** `goamp-node/api/state_handlers.go`, `state_handlers_test.go`.

Endpoints:
- `POST /state/sync-up` body: `{"account_pub", "sub_sk_b64", "state_key_b64", "plaintext_b64", "relay_url"}` → status 200.
- `POST /state/sync-down` body: `{"account_pub", "sub_sk_b64", "state_key_b64", "relay_url"}` → `{"plaintext_b64"}` or `{"plaintext_b64": ""}` if missing.

- [ ] **Step 1 — test:**

```go
package api

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/goamp/sdk/account"
	"github.com/goamp/sdk/relay"
)

func TestStateSyncUpDown(t *testing.T) {
	store := relay.NewMemStore()
	relaySrv := httptest.NewServer(relay.NewServer(store))
	defer relaySrv.Close()

	// Bootstrap an account + manifest.
	m, _ := account.NewMnemonic()
	master, _ := account.MasterFromMnemonic(m)
	sub, _ := account.NewSubKey()
	now := timeNowUTC()
	entry, _ := account.BuildDeviceEntry(master, sub.PublicKey, "Mac", "darwin", now)
	mf, _ := account.BuildManifest(master, []account.DeviceEntry{entry}, nil, 1, now)
	master.Wipe()
	if err := store.PutManifest(mf); err != nil {
		t.Fatal(err)
	}

	var stateKey [32]byte
	for i := range stateKey {
		stateKey[i] = byte(i)
	}

	srv := New(nil, nil, nil, nil)
	mux := http.NewServeMux()
	srv.RegisterStateSyncRoutes(mux)
	nodeSrv := httptest.NewServer(mux)
	defer nodeSrv.Close()

	upReq := map[string]string{
		"account_pub":   mf.AccountPub,
		"sub_sk_b64":    base64.StdEncoding.EncodeToString(sub.PrivateKey),
		"state_key_b64": base64.StdEncoding.EncodeToString(stateKey[:]),
		"plaintext_b64": base64.StdEncoding.EncodeToString([]byte(`{"liked":true}`)),
		"relay_url":     relaySrv.URL,
	}
	body, _ := json.Marshal(upReq)
	resp, err := http.Post(nodeSrv.URL+"/state/sync-up", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("up status = %d", resp.StatusCode)
	}

	downReq := map[string]string{
		"account_pub":   mf.AccountPub,
		"sub_sk_b64":    base64.StdEncoding.EncodeToString(sub.PrivateKey),
		"state_key_b64": base64.StdEncoding.EncodeToString(stateKey[:]),
		"relay_url":     relaySrv.URL,
	}
	body2, _ := json.Marshal(downReq)
	resp2, _ := http.Post(nodeSrv.URL+"/state/sync-down", "application/json", bytes.NewReader(body2))
	defer resp2.Body.Close()
	if resp2.StatusCode != 200 {
		t.Fatalf("down status = %d", resp2.StatusCode)
	}
	var out struct {
		PlaintextB64 string `json:"plaintext_b64"`
	}
	_ = json.NewDecoder(resp2.Body).Decode(&out)
	got, _ := base64.StdEncoding.DecodeString(out.PlaintextB64)
	if string(got) != `{"liked":true}` {
		t.Fatalf("got %q", got)
	}

	_ = fmt.Sprintf("%d", store) // silence unused import if any
}
```

Add helper `timeNowUTC()` at the top of the test file (or just inline `time.Now().UTC()`).

- [ ] **Step 2** — FAIL.

- [ ] **Step 3 — impl `state_handlers.go`:**

```go
package api

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"net/http"

	"github.com/goamp/sdk/account"
	"github.com/goamp/sdk/sync"
)

func (s *Server) RegisterStateSyncRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /state/sync-up", s.handleStateSyncUp)
	mux.HandleFunc("POST /state/sync-down", s.handleStateSyncDown)
}

type syncReq struct {
	AccountPub   string `json:"account_pub"`
	SubSkB64     string `json:"sub_sk_b64"`
	StateKeyB64  string `json:"state_key_b64"`
	PlaintextB64 string `json:"plaintext_b64,omitempty"`
	RelayURL     string `json:"relay_url"`
}

func (r *syncReq) decode() (*account.SubKey, []byte, []byte, error) {
	skBytes, err := base64.StdEncoding.DecodeString(r.SubSkB64)
	if err != nil || len(skBytes) != ed25519.PrivateKeySize {
		return nil, nil, nil, http.ErrNoCookie
	}
	sk := ed25519.PrivateKey(skBytes)
	pub, _ := sk.Public().(ed25519.PublicKey)
	key, err := base64.StdEncoding.DecodeString(r.StateKeyB64)
	if err != nil || len(key) != 32 {
		return nil, nil, nil, http.ErrNoCookie
	}
	plain, _ := base64.StdEncoding.DecodeString(r.PlaintextB64)
	return &account.SubKey{PrivateKey: sk, PublicKey: pub}, key, plain, nil
}

func (s *Server) handleStateSyncUp(w http.ResponseWriter, r *http.Request) {
	var req syncReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad json", 400)
		return
	}
	sub, key, plain, err := req.decode()
	if err != nil {
		http.Error(w, "bad key/state_key", 400)
		return
	}
	c := sync.NewClient(req.RelayURL)
	// SyncUp uses lastAccountPubVal which we haven't set — use explicit
	// PutState via a helper pattern: we bootstrap the client's state by
	// calling GetManifest to populate it, or we just pass account_pub
	// directly. Use the direct-call approach:
	if err := c.SyncUpFor(req.AccountPub, key, sub, plain); err != nil {
		http.Error(w, err.Error(), 502)
		return
	}
	writeJSON(w, map[string]bool{"ok": true})
}

func (s *Server) handleStateSyncDown(w http.ResponseWriter, r *http.Request) {
	var req syncReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad json", 400)
		return
	}
	sub, key, _, err := req.decode()
	if err != nil {
		http.Error(w, "bad key/state_key", 400)
		return
	}
	c := sync.NewClient(req.RelayURL)
	plain, err := c.SyncDownFor(req.AccountPub, key, sub)
	if err != nil {
		http.Error(w, err.Error(), 502)
		return
	}
	writeJSON(w, map[string]string{
		"plaintext_b64": base64.StdEncoding.EncodeToString(plain),
	})
}
```

Also add explicit-account methods to `sync.Client` (`SyncUpFor`, `SyncDownFor`) that don't rely on `lastAccountPubVal`:

```go
func (c *Client) SyncUpFor(accountPub string, stateKey []byte, sub *account.SubKey, plaintext []byte) error {
	ct, err := userstate.Seal(stateKey, plaintext)
	if err != nil {
		return err
	}
	return c.PutState(accountPub, sub, ct)
}

func (c *Client) SyncDownFor(accountPub string, stateKey []byte, sub *account.SubKey) ([]byte, error) {
	blob, err := c.GetState(accountPub, sub)
	if err != nil {
		return nil, err
	}
	if blob == nil {
		return nil, nil
	}
	return userstate.Open(stateKey, blob)
}
```

- [ ] **Step 4** — register routes in `server.go` inside `Start` after account routes: `s.RegisterStateSyncRoutes(mux)`.

- [ ] **Step 5** — test passes.

- [ ] **Step 6** — `go test ./...` all green.

- [ ] **Step 7 — commit** — `feat(node/api): /state/sync-up and /state/sync-down endpoints`.

---

## Task 5: Milestone

- [ ] Run `go test ./...` (root: `goamp-node/`). Confirm green.
- [ ] `git tag -a multi-device-p3-state-sync -m "Plan 3: encrypted state sync (LWW, MVP)"`.

---

## Self-Review

**Spec coverage (§7):**
- Encrypted state blob storage via relay ✓
- Per-account state_key used (not touched at rest, only loaded into Tauri then passed to node per-call) ✓
- LWW on scalar + set fields — MVP simplification; matches Automerge's like/dislike convergence behavior ✓
- 5-min snapshot cadence — **not covered here**; that's Rust-side timer, added in Plan 5 pairing/wiring (or a mini-plan 3.5). Flag in handoff.
- Realtime delta stream via GossipSub — deferred to P4 (requires libp2p).
- Compaction — deferred.
- Privacy switches — deferred to P5 UX.

**Type consistency:** `sync.Client.SyncUpFor/SyncDownFor` take `accountPub` explicitly and don't mutate `lastAccountPubVal`, avoiding state-machine pitfalls. `userstate.Seal/Open` both require 32-byte key matching `account.DeriveStateKey` output.

**Placeholders:** none.
