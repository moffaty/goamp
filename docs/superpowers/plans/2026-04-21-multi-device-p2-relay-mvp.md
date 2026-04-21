# Multi-Device Sync — Plan 2: Relay MVP (Storage + Auth)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Stand up a minimal HTTP relay server for signed device manifests and opaque encrypted state blobs, plus the Go client in `goamp-node` that uses it. Auth via sub-key signatures checked against a cached manifest. Monotonic manifest-version enforcement. In-memory storage (prod will swap to S3+Redis).

**Architecture:** New Go binary `goamp-relay` in the existing module. HTTP endpoints `/manifest/{account_pub}` (GET/PUT) and `/state/{account_pub}` (GET/PUT) with `X-GOAMP-Sig` header (sub_pub + nonce + timestamp + ed25519 signature over canonicalized request body). Relay keeps manifest cache, verifies each signed request against the latest manifest, rejects stale (< current) manifest versions.

**Tech Stack:** Go stdlib `net/http`, existing `goamp-node/account/` primitives, `httptest` for tests. No libp2p, no PubSub, no DNS — those are P3/P4.

**Parent spec:** `docs/superpowers/specs/2026-04-20-multi-device-sync-design.md` §9 "Relay & Transport" (excluding libp2p circuit relay + pubsub + presence), §6.3 "Revoke" (relay-side 401).

**Out of scope (deferred):** Circuit relay via libp2p (P4), PubSub relay for state sync (P3), presence service (P4), DNS SRV discovery (P5 hardening), rate limiting per-account (stubbed TODO), geo-routing, multi-region HA, persistent storage backend. TLS termination left to deployment layer.

---

## File Map

**Create (Go):**
- `goamp-node/relay/signer.go` — canonical request format + sign/verify (reusable by client & server)
- `goamp-node/relay/signer_test.go`
- `goamp-node/relay/store.go` — in-memory manifest + blob storage
- `goamp-node/relay/store_test.go`
- `goamp-node/relay/server.go` — HTTP server + auth middleware
- `goamp-node/relay/server_test.go`
- `goamp-node/cmd/goamp-relay/main.go` — binary entry
- `goamp-node/sync/client.go` — client library used by goamp-node
- `goamp-node/sync/client_test.go`
- `goamp-node/sync/e2e_test.go` — spawn live relay + client round-trip

**Modify (Go):**
- `goamp-node/api/account_handlers.go` — optional push manifest to relay on `/account/create` (flagged off by default for tests; wire in Task 9)

---

## Task 1: Signed request format

Canonical message: `HTTP_METHOD || "\n" || PATH || "\n" || TIMESTAMP_UNIX_NS || "\n" || NONCE_HEX || "\n" || BODY_SHA256_HEX`. Header `X-GOAMP-Sig: sub_pub_hex.nonce_hex.timestamp_ns.sig_b64`.

**Files:** `goamp-node/relay/signer.go`, `signer_test.go`.

- [ ] **Step 1 — failing test** — `signer_test.go`:

```go
package relay

import (
	"bytes"
	"testing"
	"time"

	"github.com/goamp/sdk/account"
)

func TestSignAndVerifyRequest(t *testing.T) {
	sub, _ := account.NewSubKey()
	body := []byte(`{"hello":"world"}`)
	ts := time.Now().UnixNano()

	hdr, err := SignRequest(sub, "PUT", "/manifest/abc", body, ts)
	if err != nil {
		t.Fatal(err)
	}
	pub, err := VerifyRequest(hdr, "PUT", "/manifest/abc", body)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(pub, sub.PublicKey) {
		t.Fatal("verified sub_pub mismatch")
	}
}

func TestVerifyRejectsTamperedBody(t *testing.T) {
	sub, _ := account.NewSubKey()
	hdr, _ := SignRequest(sub, "PUT", "/x", []byte("a"), time.Now().UnixNano())
	if _, err := VerifyRequest(hdr, "PUT", "/x", []byte("b")); err == nil {
		t.Fatal("expected body tamper to fail")
	}
}

func TestVerifyRejectsWrongPath(t *testing.T) {
	sub, _ := account.NewSubKey()
	hdr, _ := SignRequest(sub, "PUT", "/a", []byte("x"), time.Now().UnixNano())
	if _, err := VerifyRequest(hdr, "PUT", "/b", []byte("x")); err == nil {
		t.Fatal("expected path tamper to fail")
	}
}

func TestVerifyRejectsMalformedHeader(t *testing.T) {
	if _, err := VerifyRequest("junk", "GET", "/x", nil); err == nil {
		t.Fatal("expected parse error")
	}
}
```

- [ ] **Step 2** — confirm FAIL.

- [ ] **Step 3 — implement** — `signer.go`:

```go
// Package relay provides signed-request primitives shared by the GOAMP
// relay server and the client in goamp-node.
package relay

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"strings"

	"github.com/goamp/sdk/account"
)

// canonicalMessage builds the byte sequence signed per request.
func canonicalMessage(method, path string, body []byte, nonce []byte, timestampNs int64) []byte {
	bodyHash := sha256.Sum256(body)
	return []byte(fmt.Sprintf("%s\n%s\n%d\n%s\n%s",
		method, path, timestampNs,
		hex.EncodeToString(nonce),
		hex.EncodeToString(bodyHash[:]),
	))
}

// SignRequest returns the X-GOAMP-Sig header value.
// Format: subPubHex.nonceHex.timestampNs.sigB64
func SignRequest(sub *account.SubKey, method, path string, body []byte, timestampNs int64) (string, error) {
	if sub == nil {
		return "", fmt.Errorf("nil sub")
	}
	var nonce [16]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		return "", err
	}
	msg := canonicalMessage(method, path, body, nonce[:], timestampNs)
	sig := ed25519.Sign(sub.PrivateKey, msg)
	return fmt.Sprintf("%s.%s.%d.%s",
		hex.EncodeToString(sub.PublicKey),
		hex.EncodeToString(nonce[:]),
		timestampNs,
		base64.StdEncoding.EncodeToString(sig),
	), nil
}

// ParsedSig is the decoded X-GOAMP-Sig.
type ParsedSig struct {
	SubPub      ed25519.PublicKey
	Nonce       []byte
	TimestampNs int64
	Sig         []byte
}

// ParseSigHeader splits and decodes the header.
func ParseSigHeader(hdr string) (*ParsedSig, error) {
	parts := strings.Split(hdr, ".")
	if len(parts) != 4 {
		return nil, fmt.Errorf("sig header: want 4 parts, got %d", len(parts))
	}
	pub, err := hex.DecodeString(parts[0])
	if err != nil || len(pub) != ed25519.PublicKeySize {
		return nil, fmt.Errorf("sig header: sub_pub: %v", err)
	}
	nonce, err := hex.DecodeString(parts[1])
	if err != nil {
		return nil, fmt.Errorf("sig header: nonce: %w", err)
	}
	var ts int64
	if _, err := fmt.Sscanf(parts[2], "%d", &ts); err != nil {
		return nil, fmt.Errorf("sig header: timestamp: %w", err)
	}
	sig, err := base64.StdEncoding.DecodeString(parts[3])
	if err != nil {
		return nil, fmt.Errorf("sig header: sig: %w", err)
	}
	return &ParsedSig{
		SubPub:      ed25519.PublicKey(pub),
		Nonce:       nonce,
		TimestampNs: ts,
		Sig:         sig,
	}, nil
}

// VerifyRequest returns the authenticated sub_pub on success.
func VerifyRequest(hdr, method, path string, body []byte) (ed25519.PublicKey, error) {
	p, err := ParseSigHeader(hdr)
	if err != nil {
		return nil, err
	}
	msg := canonicalMessage(method, path, body, p.Nonce, p.TimestampNs)
	if !ed25519.Verify(p.SubPub, msg, p.Sig) {
		return nil, fmt.Errorf("signature invalid")
	}
	return p.SubPub, nil
}
```

- [ ] **Step 4** — confirm PASS. 4 tests.

- [ ] **Step 5 — build** — `go build ./...`.

- [ ] **Step 6 — commit** — `feat(node/relay): signed-request canonical format + ed25519 sign/verify`.

---

## Task 2: In-memory storage

Manifest cache keyed by account_pub (hex). Monotonic version enforcement: `PutManifest` rejects versions not strictly greater than the stored one. Blob storage keyed by account_pub — stores last 3 snapshots.

**Files:** `goamp-node/relay/store.go`, `store_test.go`.

- [ ] **Step 1 — failing test** — `store_test.go`:

```go
package relay

import (
	"testing"
	"time"

	"github.com/goamp/sdk/account"
)

func freshManifest(t *testing.T, version uint64) *account.Manifest {
	t.Helper()
	m, _ := account.NewMnemonic()
	master, _ := account.MasterFromMnemonic(m)
	defer master.Wipe()
	sub, _ := account.NewSubKey()
	now := time.Now().UTC()
	entry, _ := account.BuildDeviceEntry(master, sub.PublicKey, "Mac", "darwin", now)
	mf, _ := account.BuildManifest(master, []account.DeviceEntry{entry}, nil, version, now)
	return mf
}

func TestPutAndGetManifest(t *testing.T) {
	s := NewMemStore()
	mf := freshManifest(t, 1)
	if err := s.PutManifest(mf); err != nil {
		t.Fatal(err)
	}
	got, ok := s.GetManifest(mf.AccountPub)
	if !ok || got.Version != 1 {
		t.Fatal("missing or wrong version")
	}
}

func TestPutManifestRejectsStale(t *testing.T) {
	s := NewMemStore()
	mf := freshManifest(t, 2)
	_ = s.PutManifest(mf)
	stale := *mf
	stale.Version = 2 // equal, not strictly greater
	if err := s.PutManifest(&stale); err == nil {
		t.Fatal("expected stale-version rejection")
	}
	older := *mf
	older.Version = 1
	if err := s.PutManifest(&older); err == nil {
		t.Fatal("expected older-version rejection")
	}
}

func TestPutManifestRejectsDifferentAccount(t *testing.T) {
	s := NewMemStore()
	mf := freshManifest(t, 1)
	_ = s.PutManifest(mf)
	// Forge manifest with same account_pub but wrong signature → should be caught
	// by signature verification, not by the store; store just checks account_pub
	// matches accountPub in the manifest (they always match by construction here).
	// This test asserts GetManifest returns none for an unknown account.
	if _, ok := s.GetManifest("nonexistent"); ok {
		t.Fatal("expected missing account")
	}
}

func TestBlobRoundTripAndRetention(t *testing.T) {
	s := NewMemStore()
	acct := "a1b2c3"
	for i := byte(1); i <= 5; i++ {
		s.PutBlob(acct, []byte{i}, time.Now())
	}
	// Keeps at most 3 snapshots.
	snaps := s.ListBlobs(acct)
	if len(snaps) != 3 {
		t.Fatalf("retention: got %d, want 3", len(snaps))
	}
	latest, ok := s.GetLatestBlob(acct)
	if !ok || len(latest) != 1 || latest[0] != 5 {
		t.Fatal("latest blob wrong")
	}
}

func TestGetBlobMissing(t *testing.T) {
	s := NewMemStore()
	if _, ok := s.GetLatestBlob("nope"); ok {
		t.Fatal("expected missing")
	}
}
```

- [ ] **Step 2** — confirm FAIL.

- [ ] **Step 3 — implement** — `store.go`:

```go
package relay

import (
	"fmt"
	"sync"
	"time"

	"github.com/goamp/sdk/account"
)

const blobRetention = 3

type blobSnapshot struct {
	Data      []byte
	StoredAt  time.Time
}

// MemStore is an in-memory MVP backend. Prod swaps this for S3 + Redis.
type MemStore struct {
	mu        sync.RWMutex
	manifests map[string]*account.Manifest // account_pub (hex) -> latest
	blobs     map[string][]blobSnapshot    // account_pub -> ring buffer
}

func NewMemStore() *MemStore {
	return &MemStore{
		manifests: map[string]*account.Manifest{},
		blobs:     map[string][]blobSnapshot{},
	}
}

// PutManifest stores the manifest if its version is strictly greater than
// the current cached version for this account. Caller is responsible for
// signature verification.
func (s *MemStore) PutManifest(m *account.Manifest) error {
	if m == nil || m.AccountPub == "" {
		return fmt.Errorf("nil or empty account_pub")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if prev, ok := s.manifests[m.AccountPub]; ok {
		if m.Version <= prev.Version {
			return fmt.Errorf("stale version %d (current %d)", m.Version, prev.Version)
		}
	}
	s.manifests[m.AccountPub] = m
	return nil
}

func (s *MemStore) GetManifest(accountPub string) (*account.Manifest, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	m, ok := s.manifests[accountPub]
	return m, ok
}

// IsRevoked returns true if subPubHex is in the account's revoked list.
func (s *MemStore) IsRevoked(accountPub, subPubHex string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	m, ok := s.manifests[accountPub]
	if !ok {
		return false
	}
	for _, r := range m.Revoked {
		if r.SubPub == subPubHex {
			return true
		}
	}
	return false
}

// IsActive returns true if subPubHex is listed as an active device.
func (s *MemStore) IsActive(accountPub, subPubHex string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	m, ok := s.manifests[accountPub]
	if !ok {
		return false
	}
	for _, d := range m.Devices {
		if d.SubPub == subPubHex {
			return true
		}
	}
	return false
}

// PutBlob appends a snapshot, trimming to blobRetention oldest-first.
func (s *MemStore) PutBlob(accountPub string, data []byte, at time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	buf := s.blobs[accountPub]
	buf = append(buf, blobSnapshot{Data: append([]byte(nil), data...), StoredAt: at})
	if len(buf) > blobRetention {
		buf = buf[len(buf)-blobRetention:]
	}
	s.blobs[accountPub] = buf
}

func (s *MemStore) GetLatestBlob(accountPub string) ([]byte, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	buf := s.blobs[accountPub]
	if len(buf) == 0 {
		return nil, false
	}
	return append([]byte(nil), buf[len(buf)-1].Data...), true
}

func (s *MemStore) ListBlobs(accountPub string) []blobSnapshot {
	s.mu.RLock()
	defer s.mu.RUnlock()
	buf := s.blobs[accountPub]
	out := make([]blobSnapshot, len(buf))
	copy(out, buf)
	return out
}
```

- [ ] **Step 4** — confirm PASS. 5 tests.

- [ ] **Step 5 — commit** — `feat(node/relay): in-memory manifest + blob store with monotonic version + retention`.

---

## Task 3: HTTP server + auth middleware

Endpoints:
- `PUT /manifest/{account_pub}` — body = full Manifest JSON. No sig header required for the first manifest of an account (bootstrap). After that, signed by an active sub-key of the previous manifest.
- `GET /manifest/{account_pub}` — public, no auth.
- `PUT /state/{account_pub}` — body = opaque bytes (ciphertext). Signed, active sub-key.
- `GET /state/{account_pub}` — signed, active sub-key.

Clock-skew tolerance: 30 s.

**Files:** `goamp-node/relay/server.go`, `server_test.go`.

- [ ] **Step 1 — failing test** — `server_test.go`:

```go
package relay

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/goamp/sdk/account"
)

type accountFixture struct {
	mnemonic account.Mnemonic
	pub      string // account_pub hex
	sub      *account.SubKey
	manifest *account.Manifest
}

func newAccountFixture(t *testing.T) accountFixture {
	t.Helper()
	m, _ := account.NewMnemonic()
	master, _ := account.MasterFromMnemonic(m)
	defer master.Wipe()
	sub, _ := account.NewSubKey()
	now := time.Now().UTC()
	entry, _ := account.BuildDeviceEntry(master, sub.PublicKey, "Mac", "darwin", now)
	mf, _ := account.BuildManifest(master, []account.DeviceEntry{entry}, nil, 1, now)
	return accountFixture{m, mf.AccountPub, sub, mf}
}

func newTestServer() (*httptest.Server, *MemStore) {
	store := NewMemStore()
	srv := httptest.NewServer(NewServer(store))
	return srv, store
}

func TestPutManifestBootstrap(t *testing.T) {
	srv, store := newTestServer()
	defer srv.Close()
	fx := newAccountFixture(t)
	body, _ := json.Marshal(fx.manifest)

	resp, _ := http.Post(srv.URL+"/manifest/"+fx.pub, "application/json", bytes.NewReader(body))
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	if _, ok := store.GetManifest(fx.pub); !ok {
		t.Fatal("manifest not stored")
	}
}

func TestPutManifestRejectsStaleVersion(t *testing.T) {
	srv, _ := newTestServer()
	defer srv.Close()
	fx := newAccountFixture(t)
	body1, _ := json.Marshal(fx.manifest)
	_, _ = http.Post(srv.URL+"/manifest/"+fx.pub, "application/json", bytes.NewReader(body1))

	stale := *fx.manifest
	stale.Version = 1
	body2, _ := json.Marshal(&stale)
	resp, _ := http.Post(srv.URL+"/manifest/"+fx.pub, "application/json", bytes.NewReader(body2))
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("status = %d want 409", resp.StatusCode)
	}
}

func TestPutManifestRejectsInvalidSignature(t *testing.T) {
	srv, _ := newTestServer()
	defer srv.Close()
	fx := newAccountFixture(t)
	broken := *fx.manifest
	broken.MasterSig = "aGVsbG8=" // base64 "hello" — definitely not a real sig
	body, _ := json.Marshal(&broken)
	resp, _ := http.Post(srv.URL+"/manifest/"+fx.pub, "application/json", bytes.NewReader(body))
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d want 400", resp.StatusCode)
	}
}

func TestGetManifestPublic(t *testing.T) {
	srv, store := newTestServer()
	defer srv.Close()
	fx := newAccountFixture(t)
	_ = store.PutManifest(fx.manifest)

	resp, _ := http.Get(srv.URL + "/manifest/" + fx.pub)
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	var got account.Manifest
	_ = json.NewDecoder(resp.Body).Decode(&got)
	if got.AccountPub != fx.pub {
		t.Fatal("mismatched account_pub")
	}
}

func TestPutStateRequiresActiveSig(t *testing.T) {
	srv, store := newTestServer()
	defer srv.Close()
	fx := newAccountFixture(t)
	_ = store.PutManifest(fx.manifest)

	body := []byte("ciphertext")
	req, _ := http.NewRequest("PUT", srv.URL+"/state/"+fx.pub, bytes.NewReader(body))
	hdr, _ := SignRequest(fx.sub, "PUT", "/state/"+fx.pub, body, time.Now().UnixNano())
	req.Header.Set("X-GOAMP-Sig", hdr)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	blob, ok := store.GetLatestBlob(fx.pub)
	if !ok || string(blob) != "ciphertext" {
		t.Fatal("blob not stored")
	}
}

func TestPutStateRejectsUnsignedRequest(t *testing.T) {
	srv, store := newTestServer()
	defer srv.Close()
	fx := newAccountFixture(t)
	_ = store.PutManifest(fx.manifest)
	req, _ := http.NewRequest("PUT", srv.URL+"/state/"+fx.pub, bytes.NewReader([]byte("x")))
	resp, _ := http.DefaultClient.Do(req)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d", resp.StatusCode)
	}
}

func TestPutStateRejectsRevokedDevice(t *testing.T) {
	srv, store := newTestServer()
	defer srv.Close()
	fx := newAccountFixture(t)
	// Manually move fx.sub into the revoked list, rebuild manifest v2.
	m, _ := account.MasterFromMnemonic(fx.mnemonic)
	defer m.Wipe()
	revoked := []account.RevokedEntry{{
		SubPub:    hex.EncodeToString(fx.sub.PublicKey),
		RevokedAt: time.Now().UTC(),
		Reason:    "test",
	}}
	// Build a replacement device so manifest is non-empty.
	newSub, _ := account.NewSubKey()
	entry2, _ := account.BuildDeviceEntry(m, newSub.PublicKey, "Phone", "ios", time.Now().UTC())
	mf2, _ := account.BuildManifest(m, []account.DeviceEntry{entry2}, revoked, 2, time.Now().UTC())
	_ = store.PutManifest(mf2)

	body := []byte("x")
	hdr, _ := SignRequest(fx.sub, "PUT", "/state/"+fx.pub, body, time.Now().UnixNano())
	req, _ := http.NewRequest("PUT", srv.URL+"/state/"+fx.pub, bytes.NewReader(body))
	req.Header.Set("X-GOAMP-Sig", hdr)
	resp, _ := http.DefaultClient.Do(req)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d want 401", resp.StatusCode)
	}
}

func TestGetStateRoundTrip(t *testing.T) {
	srv, store := newTestServer()
	defer srv.Close()
	fx := newAccountFixture(t)
	_ = store.PutManifest(fx.manifest)
	store.PutBlob(fx.pub, []byte("secret"), time.Now())

	hdr, _ := SignRequest(fx.sub, "GET", "/state/"+fx.pub, nil, time.Now().UnixNano())
	req, _ := http.NewRequest("GET", srv.URL+"/state/"+fx.pub, nil)
	req.Header.Set("X-GOAMP-Sig", hdr)
	resp, _ := http.DefaultClient.Do(req)
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	data, _ := io.ReadAll(resp.Body)
	if string(data) != "secret" {
		t.Fatalf("got %q", data)
	}
}
```

- [ ] **Step 2** — confirm FAIL.

- [ ] **Step 3 — implement** — `server.go`:

```go
package relay

import (
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/goamp/sdk/account"
)

// ClockSkewNs bounds accepted request timestamps relative to server wall time.
const ClockSkewNs = int64(30 * time.Second)

// NewServer returns an http.Handler mounted at the mux root.
func NewServer(store *MemStore) http.Handler {
	mux := http.NewServeMux()
	h := &handlers{store: store}
	mux.HandleFunc("PUT /manifest/{account_pub}", h.putManifest)
	mux.HandleFunc("GET /manifest/{account_pub}", h.getManifest)
	mux.HandleFunc("POST /manifest/{account_pub}", h.putManifest) // httptest.Post convenience
	mux.HandleFunc("PUT /state/{account_pub}", h.putState)
	mux.HandleFunc("GET /state/{account_pub}", h.getState)
	return mux
}

type handlers struct {
	store *MemStore
}

func (h *handlers) putManifest(w http.ResponseWriter, r *http.Request) {
	accountPub := r.PathValue("account_pub")
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "read body", http.StatusBadRequest)
		return
	}
	var mf account.Manifest
	if err := json.Unmarshal(body, &mf); err != nil {
		http.Error(w, "decode: "+err.Error(), http.StatusBadRequest)
		return
	}
	if mf.AccountPub != accountPub {
		http.Error(w, "account_pub path/body mismatch", http.StatusBadRequest)
		return
	}
	if err := account.VerifyManifest(&mf); err != nil {
		http.Error(w, "verify: "+err.Error(), http.StatusBadRequest)
		return
	}

	// Require active-subkey signature from the PREVIOUS manifest if one exists.
	if prev, ok := h.store.GetManifest(accountPub); ok {
		sig := r.Header.Get("X-GOAMP-Sig")
		if sig == "" {
			http.Error(w, "missing X-GOAMP-Sig (manifest update requires active sub-key)", http.StatusUnauthorized)
			return
		}
		subPub, err := verifySignedRequest(sig, r.Method, r.URL.Path, body)
		if err != nil {
			http.Error(w, err.Error(), http.StatusUnauthorized)
			return
		}
		subPubHex := hex.EncodeToString(subPub)
		if !isActiveInManifest(prev, subPubHex) {
			http.Error(w, "signing sub-key is not active in previous manifest", http.StatusUnauthorized)
			return
		}
	}

	if err := h.store.PutManifest(&mf); err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	w.WriteHeader(http.StatusOK)
}

func (h *handlers) getManifest(w http.ResponseWriter, r *http.Request) {
	mf, ok := h.store.GetManifest(r.PathValue("account_pub"))
	if !ok {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	w.Header().Set("content-type", "application/json")
	_ = json.NewEncoder(w).Encode(mf)
}

func (h *handlers) putState(w http.ResponseWriter, r *http.Request) {
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
	h.store.PutBlob(accountPub, body, time.Now())
	w.WriteHeader(http.StatusOK)
}

func (h *handlers) getState(w http.ResponseWriter, r *http.Request) {
	accountPub := r.PathValue("account_pub")
	if _, err := h.authorizeActive(r, accountPub, nil); err != nil {
		http.Error(w, err.Error(), http.StatusUnauthorized)
		return
	}
	blob, ok := h.store.GetLatestBlob(accountPub)
	if !ok {
		http.Error(w, "no blob", http.StatusNotFound)
		return
	}
	w.Header().Set("content-type", "application/octet-stream")
	_, _ = w.Write(blob)
}

// authorizeActive verifies signature, checks sub_pub is active and not
// revoked for accountPub, and enforces clock-skew.
func (h *handlers) authorizeActive(r *http.Request, accountPub string, body []byte) ([]byte, error) {
	sig := r.Header.Get("X-GOAMP-Sig")
	if sig == "" {
		return nil, &httpErr{http.StatusUnauthorized, "missing X-GOAMP-Sig"}
	}
	subPub, err := verifySignedRequest(sig, r.Method, r.URL.Path, body)
	if err != nil {
		return nil, err
	}
	subPubHex := hex.EncodeToString(subPub)
	if h.store.IsRevoked(accountPub, subPubHex) {
		return nil, &httpErr{http.StatusUnauthorized, "revoked"}
	}
	if !h.store.IsActive(accountPub, subPubHex) {
		return nil, &httpErr{http.StatusUnauthorized, "sub-key not active for account"}
	}
	return subPub, nil
}

func verifySignedRequest(hdr, method, path string, body []byte) ([]byte, error) {
	p, err := ParseSigHeader(hdr)
	if err != nil {
		return nil, err
	}
	now := time.Now().UnixNano()
	if abs(now-p.TimestampNs) > ClockSkewNs {
		return nil, &httpErr{http.StatusUnauthorized, "clock skew"}
	}
	return VerifyRequest(hdr, method, path, body)
}

func isActiveInManifest(m *account.Manifest, subPubHex string) bool {
	for _, d := range m.Devices {
		if strings.EqualFold(d.SubPub, subPubHex) {
			return true
		}
	}
	return false
}

func abs(x int64) int64 {
	if x < 0 {
		return -x
	}
	return x
}

type httpErr struct {
	code int
	msg  string
}

func (e *httpErr) Error() string { return e.msg }
```

- [ ] **Step 4** — confirm PASS. 7 tests.

- [ ] **Step 5 — build** — `go build ./...`.

- [ ] **Step 6 — commit** — `feat(node/relay): HTTP server — manifest + state endpoints with signed-request auth`.

---

## Task 4: Relay binary

**Files:** `goamp-node/cmd/goamp-relay/main.go`.

- [ ] **Step 1 — implement** (no tests — binary wiring):

```go
// goamp-relay — minimal HTTP relay for multi-device manifest + state blobs.
package main

import (
	"flag"
	"log"
	"net/http"
	"os"

	"github.com/goamp/sdk/relay"
)

func main() {
	addr := flag.String("addr", ":7480", "listen address")
	flag.Parse()
	store := relay.NewMemStore()
	log.Printf("goamp-relay listening on %s", *addr)
	if err := http.ListenAndServe(*addr, relay.NewServer(store)); err != nil {
		log.Printf("serve: %v", err)
		os.Exit(1)
	}
}
```

- [ ] **Step 2 — build** — `go build ./cmd/goamp-relay/` must produce an executable.

- [ ] **Step 3 — commit** — `feat(node): goamp-relay binary`.

---

## Task 5: Client library

**Files:** `goamp-node/sync/client.go`, `client_test.go`.

- [ ] **Step 1 — failing test** — `client_test.go`:

```go
package sync

import (
	"net/http/httptest"
	"testing"
	"time"

	"github.com/goamp/sdk/account"
	"github.com/goamp/sdk/relay"
)

func bootstrap(t *testing.T) (*Client, *account.SubKey, account.Mnemonic) {
	t.Helper()
	store := relay.NewMemStore()
	srv := httptest.NewServer(relay.NewServer(store))
	t.Cleanup(srv.Close)

	m, _ := account.NewMnemonic()
	master, _ := account.MasterFromMnemonic(m)
	defer master.Wipe()
	sub, _ := account.NewSubKey()
	now := time.Now().UTC()
	entry, _ := account.BuildDeviceEntry(master, sub.PublicKey, "Mac", "darwin", now)
	mf, _ := account.BuildManifest(master, []account.DeviceEntry{entry}, nil, 1, now)

	c := NewClient(srv.URL)
	if err := c.PutManifest(mf, nil); err != nil {
		t.Fatal(err)
	}
	return c, sub, m
}

func TestPutAndGetManifest(t *testing.T) {
	c, _, _ := bootstrap(t)
	mf, err := c.GetManifest(c.lastAccountPub())
	if err != nil {
		t.Fatal(err)
	}
	if mf.Version != 1 {
		t.Fatalf("version = %d", mf.Version)
	}
}

func TestPutAndGetState(t *testing.T) {
	c, sub, _ := bootstrap(t)
	if err := c.PutState(c.lastAccountPub(), sub, []byte("ciphertext")); err != nil {
		t.Fatal(err)
	}
	blob, err := c.GetState(c.lastAccountPub(), sub)
	if err != nil {
		t.Fatal(err)
	}
	if string(blob) != "ciphertext" {
		t.Fatalf("got %q", blob)
	}
}
```

- [ ] **Step 2** — confirm FAIL.

- [ ] **Step 3 — implement** — `client.go`:

```go
// Package sync is the client library goamp-node uses to talk to a GOAMP
// relay for manifest + state blob sync.
package sync

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/goamp/sdk/account"
	"github.com/goamp/sdk/relay"
)

type Client struct {
	baseURL        string
	http           *http.Client
	lastAccountPubVal string // remembers most recent PUT target — convenience for callers
}

func NewClient(baseURL string) *Client {
	return &Client{
		baseURL: baseURL,
		http:    &http.Client{Timeout: 10 * time.Second},
	}
}

func (c *Client) lastAccountPub() string { return c.lastAccountPubVal }

// PutManifest uploads a signed manifest. subForUpdate is required for
// manifest v >= 2 (auth with active sub-key); v1 bootstraps unsigned.
func (c *Client) PutManifest(mf *account.Manifest, subForUpdate *account.SubKey) error {
	body, err := json.Marshal(mf)
	if err != nil {
		return err
	}
	path := "/manifest/" + mf.AccountPub
	req, err := http.NewRequest(http.MethodPut, c.baseURL+path, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("content-type", "application/json")
	if subForUpdate != nil {
		hdr, err := relay.SignRequest(subForUpdate, req.Method, path, body, time.Now().UnixNano())
		if err != nil {
			return err
		}
		req.Header.Set("X-GOAMP-Sig", hdr)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		msg, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("put manifest: %d %s", resp.StatusCode, msg)
	}
	c.lastAccountPubVal = mf.AccountPub
	return nil
}

func (c *Client) GetManifest(accountPub string) (*account.Manifest, error) {
	resp, err := c.http.Get(c.baseURL + "/manifest/" + accountPub)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		msg, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("get manifest: %d %s", resp.StatusCode, msg)
	}
	var mf account.Manifest
	if err := json.NewDecoder(resp.Body).Decode(&mf); err != nil {
		return nil, err
	}
	return &mf, nil
}

func (c *Client) PutState(accountPub string, sub *account.SubKey, ciphertext []byte) error {
	path := "/state/" + accountPub
	req, err := http.NewRequest(http.MethodPut, c.baseURL+path, bytes.NewReader(ciphertext))
	if err != nil {
		return err
	}
	hdr, err := relay.SignRequest(sub, req.Method, path, ciphertext, time.Now().UnixNano())
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
		return fmt.Errorf("put state: %d %s", resp.StatusCode, msg)
	}
	return nil
}

func (c *Client) GetState(accountPub string, sub *account.SubKey) ([]byte, error) {
	path := "/state/" + accountPub
	req, err := http.NewRequest(http.MethodGet, c.baseURL+path, nil)
	if err != nil {
		return nil, err
	}
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
	if resp.StatusCode == http.StatusNotFound {
		return nil, nil
	}
	if resp.StatusCode/100 != 2 {
		msg, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("get state: %d %s", resp.StatusCode, msg)
	}
	return io.ReadAll(resp.Body)
}
```

- [ ] **Step 2 — confirm PASS.** 2 tests.

- [ ] **Step 3 — commit** — `feat(node/sync): relay client — manifest + state round-trip`.

---

## Task 6: End-to-end happy path

**Files:** `goamp-node/sync/e2e_test.go`.

Exercises: bootstrap manifest v1 (unsigned) → push state blob (signed) → read it back → push manifest v2 with added device signed by v1 sub-key.

- [ ] **Step 1 — write test:**

```go
package sync

import (
	"net/http/httptest"
	"testing"
	"time"

	"github.com/goamp/sdk/account"
	"github.com/goamp/sdk/relay"
)

func TestE2EBootstrapThenAddDevice(t *testing.T) {
	store := relay.NewMemStore()
	srv := httptest.NewServer(relay.NewServer(store))
	defer srv.Close()
	c := NewClient(srv.URL)

	// v1 — bootstrap.
	m, _ := account.NewMnemonic()
	master, _ := account.MasterFromMnemonic(m)
	sub1, _ := account.NewSubKey()
	now := time.Now().UTC()
	entry1, _ := account.BuildDeviceEntry(master, sub1.PublicKey, "Mac", "darwin", now)
	mf1, _ := account.BuildManifest(master, []account.DeviceEntry{entry1}, nil, 1, now)
	master.Wipe()

	if err := c.PutManifest(mf1, nil); err != nil {
		t.Fatal(err)
	}

	// Push + pull state.
	if err := c.PutState(mf1.AccountPub, sub1, []byte("blob-v1")); err != nil {
		t.Fatal(err)
	}
	got, err := c.GetState(mf1.AccountPub, sub1)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "blob-v1" {
		t.Fatalf("got %q", got)
	}

	// v2 — add phone, signed by sub1.
	master2, _ := account.MasterFromMnemonic(m)
	sub2, _ := account.NewSubKey()
	entry2a, _ := account.BuildDeviceEntry(master2, sub1.PublicKey, "Mac", "darwin", now)
	entry2b, _ := account.BuildDeviceEntry(master2, sub2.PublicKey, "Phone", "ios", time.Now().UTC())
	mf2, _ := account.BuildManifest(master2, []account.DeviceEntry{entry2a, entry2b}, nil, 2, time.Now().UTC())
	master2.Wipe()

	if err := c.PutManifest(mf2, sub1); err != nil {
		t.Fatalf("v2 put: %v", err)
	}

	// sub2 can now authenticate state calls.
	if err := c.PutState(mf2.AccountPub, sub2, []byte("blob-v2")); err != nil {
		t.Fatalf("state as new device: %v", err)
	}
}
```

- [ ] **Step 2 — confirm PASS.**

- [ ] **Step 3 — full build + test** — `go test ./...`.

- [ ] **Step 4 — commit** — `test(node/sync): e2e — bootstrap, state round-trip, add device`.

---

## Task 7: Milestone

- [ ] `git tag -a multi-device-p2-relay-mvp -m "Multi-device Plan 2 complete: relay MVP (storage + auth) + goamp-node client"`

---

## Self-Review

**Spec coverage (§9):**
- Manifest storage (signed-by-master, publicly fetchable) — Task 3 ✓
- State Blob Storage (PUT/GET, last 3 snapshots) — Tasks 2, 3 ✓
- Relay authorization (sub_pub sig + manifest membership + revoked check) — Task 3 ✓
- Manifest cache invalidated on PUT — Task 2 (in-memory always-fresh) ✓
- Clock-skew tolerance — Task 3 (30 s) ✓

**Explicitly deferred (flagged in plan):** libp2p circuit relay (§9), PubSub relay (§9), presence service (§9), DNS SRV + community relay discovery (§9), multi-region geo-routing (§9), per-account rate limits (§9), S3/Redis backing store, paranoid-mode state-key rotation (§5.4).

**Type consistency:** `account.Manifest` consumed unchanged. `SignRequest`/`VerifyRequest` used identically by server & client. `relay.MemStore` methods `PutBlob/GetLatestBlob/IsActive/IsRevoked` match handler call sites.

**Placeholders:** none.
