# Multi-Device Sync — Plan 1: Identity & Keys

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the cryptographic foundation for multi-device accounts — ed25519 master key from BIP39 mnemonic, device sub-keys signed by master, signed Device Manifests, state-key derivation, and OS-keychain persistence. No network, no UI; leaves APIs ready for Plans 2–5.

**Architecture:** Pure crypto primitives in a new Go package `goamp-node/account/` (master/sub-key/manifest/statekey). Local HTTP endpoints on `goamp-node` expose account ops to Tauri. Rust side (`src-tauri/src/account.rs`) handles OS-keychain persistence via the `keyring` crate and exposes Tauri commands. A minimal `AccountService.ts` on the frontend wires it in. Verifiable end-to-end: create account → verify mnemonic quiz → persist sub-key → load account on next run.

**Tech Stack:**
- Go: `crypto/ed25519`, `crypto/hkdf` (std in 1.25+), `github.com/tyler-smith/go-bip39`, existing `net/http`
- Rust: `keyring` crate (cross-platform keychain), existing `tauri`, `serde`, `reqwest`
- TypeScript: existing service layer (`ITransport`, `TauriTransport`)

**Parent spec:** `docs/superpowers/specs/2026-04-20-multi-device-sync-design.md` §5 "Identity & Key Hierarchy", §6.1 "First-run / new account", §6.4 "Revoke a device".

**Out of scope (deferred to later plans):** pairing between devices (P5), recovery from seed (P5), relay upload of manifest (P2), full first-run UI wizard (P5). This plan produces headless primitives + a test harness proving they work together.

---

## File Map

**Create (Go):**
- `goamp-node/account/mnemonic.go` — BIP39 encode/decode + entropy
- `goamp-node/account/mnemonic_test.go`
- `goamp-node/account/master.go` — master ed25519 keypair from seed
- `goamp-node/account/master_test.go`
- `goamp-node/account/subkey.go` — sub-key generation + master signing
- `goamp-node/account/subkey_test.go`
- `goamp-node/account/manifest.go` — Device Manifest type + canonical JSON + sign/verify
- `goamp-node/account/manifest_test.go`
- `goamp-node/account/statekey.go` — HKDF state-key derivation
- `goamp-node/account/statekey_test.go`
- `goamp-node/account/quiz.go` — BIP39 verification quiz helper
- `goamp-node/account/quiz_test.go`
- `goamp-node/api/account_handlers.go` — HTTP endpoints
- `goamp-node/api/account_handlers_test.go`

**Modify (Go):**
- `goamp-node/go.mod` — add `github.com/tyler-smith/go-bip39`
- `goamp-node/api/server.go` — register account routes

**Create (Rust):**
- `src-tauri/src/account.rs` — keychain-backed sub-key + state-key storage + node HTTP client glue
- `src-tauri/src/commands/account.rs` — Tauri commands

**Modify (Rust):**
- `src-tauri/Cargo.toml` — add `keyring` dependency
- `src-tauri/src/lib.rs` — register module + invoke handlers
- `src-tauri/src/commands/mod.rs` — wire commands

**Create (TS):**
- `src/services/AccountService.ts` — frontend service over `ITransport`
- `src/services/AccountService.test.ts`

**Modify (TS):**
- `src/services/index.ts` — export
- `src/services/interfaces.ts` — add `IAccountService`

---

## Task 1: Add BIP39 dependency

**Files:**
- Modify: `goamp-node/go.mod`

- [ ] **Step 1: Add dependency**

Run: `cd goamp-node && go get github.com/tyler-smith/go-bip39@v1.1.0 && go mod tidy`

Expected: `go.mod` gains `github.com/tyler-smith/go-bip39 v1.1.0`; `go.sum` updated.

- [ ] **Step 2: Verify compile**

Run: `cd goamp-node && go build ./...`

Expected: exit 0, no output.

- [ ] **Step 3: Commit**

```bash
git add goamp-node/go.mod goamp-node/go.sum
git commit -m "chore(node): add go-bip39 dependency for account mnemonics"
```

---

## Task 2: Mnemonic encode/decode

**Files:**
- Create: `goamp-node/account/mnemonic.go`
- Create: `goamp-node/account/mnemonic_test.go`

- [ ] **Step 1: Write failing test**

Create `goamp-node/account/mnemonic_test.go`:

```go
package account

import (
	"strings"
	"testing"
)

func TestNewMnemonicIs12Words(t *testing.T) {
	m, err := NewMnemonic()
	if err != nil {
		t.Fatalf("NewMnemonic: %v", err)
	}
	if n := len(strings.Fields(string(m))); n != 12 {
		t.Fatalf("want 12 words, got %d: %q", n, m)
	}
}

func TestMnemonicRoundTrip(t *testing.T) {
	m, err := NewMnemonic()
	if err != nil {
		t.Fatal(err)
	}
	seed, err := m.Seed()
	if err != nil {
		t.Fatal(err)
	}
	if len(seed) != 64 {
		t.Fatalf("BIP39 seed must be 64 bytes, got %d", len(seed))
	}
	// Same mnemonic => same seed, deterministic.
	seed2, _ := m.Seed()
	if string(seed) != string(seed2) {
		t.Fatal("seed is not deterministic")
	}
}

func TestMnemonicValidateRejectsTypo(t *testing.T) {
	// Valid mnemonic from the BIP39 test vectors.
	good := Mnemonic("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about")
	if err := good.Validate(); err != nil {
		t.Fatalf("expected valid, got %v", err)
	}
	bad := Mnemonic("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon zzzzzz")
	if err := bad.Validate(); err == nil {
		t.Fatal("expected error for invalid mnemonic")
	}
}
```

- [ ] **Step 2: Run to confirm FAIL**

Run: `cd goamp-node && go test ./account/...`
Expected: build error — package does not compile (Mnemonic type undefined).

- [ ] **Step 3: Implement**

Create `goamp-node/account/mnemonic.go`:

```go
// Package account implements GOAMP's multi-device account cryptography:
// ed25519 master key derived from a BIP39 mnemonic, device sub-keys signed
// by the master, signed Device Manifests, and HKDF-derived state keys.
//
// This package is pure crypto: no network, no keychain, no persistence.
// Higher layers (Tauri, HTTP API) handle storage and transport.
package account

import (
	"fmt"

	"github.com/tyler-smith/go-bip39"
)

// Mnemonic is a BIP39 12-word recovery phrase.
// It is the ONLY persistent representation of the master key: GOAMP
// never writes the master key to disk; the user writes the mnemonic down.
type Mnemonic string

// NewMnemonic generates a fresh 12-word (128-bit entropy) BIP39 mnemonic
// using crypto/rand.
func NewMnemonic() (Mnemonic, error) {
	entropy, err := bip39.NewEntropy(128)
	if err != nil {
		return "", fmt.Errorf("bip39 entropy: %w", err)
	}
	words, err := bip39.NewMnemonic(entropy)
	if err != nil {
		return "", fmt.Errorf("bip39 mnemonic: %w", err)
	}
	return Mnemonic(words), nil
}

// Validate returns an error if m is not a syntactically valid BIP39 mnemonic
// (wrong word count, unknown word, or bad checksum).
func (m Mnemonic) Validate() error {
	if !bip39.IsMnemonicValid(string(m)) {
		return fmt.Errorf("invalid BIP39 mnemonic (check word count, spelling, checksum)")
	}
	return nil
}

// Seed derives the deterministic 64-byte BIP39 seed (PBKDF2-HMAC-SHA512,
// 2048 iterations) with empty passphrase.
func (m Mnemonic) Seed() ([]byte, error) {
	if err := m.Validate(); err != nil {
		return nil, err
	}
	return bip39.NewSeedWithErrorChecking(string(m), "")
}
```

- [ ] **Step 4: Run to confirm PASS**

Run: `cd goamp-node && go test ./account/...`
Expected: `ok  github.com/goamp/sdk/account` with 3 tests passing.

- [ ] **Step 5: Commit**

```bash
git add goamp-node/account/mnemonic.go goamp-node/account/mnemonic_test.go
git commit -m "feat(node/account): BIP39 mnemonic generate/validate/seed"
```

---

## Task 3: Master key derivation

**Files:**
- Create: `goamp-node/account/master.go`
- Create: `goamp-node/account/master_test.go`

- [ ] **Step 1: Write failing test**

Create `goamp-node/account/master_test.go`:

```go
package account

import (
	"bytes"
	"crypto/ed25519"
	"testing"
)

func TestMasterFromMnemonicDeterministic(t *testing.T) {
	m, err := NewMnemonic()
	if err != nil {
		t.Fatal(err)
	}
	k1, err := MasterFromMnemonic(m)
	if err != nil {
		t.Fatal(err)
	}
	k2, err := MasterFromMnemonic(m)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(k1.PrivateKey, k2.PrivateKey) {
		t.Fatal("master key not deterministic for same mnemonic")
	}
	if !bytes.Equal(k1.PublicKey, k2.PublicKey) {
		t.Fatal("master public key not deterministic for same mnemonic")
	}
}

func TestMasterCanSignAndVerify(t *testing.T) {
	m, _ := NewMnemonic()
	k, err := MasterFromMnemonic(m)
	if err != nil {
		t.Fatal(err)
	}
	msg := []byte("test message")
	sig := ed25519.Sign(k.PrivateKey, msg)
	if !ed25519.Verify(k.PublicKey, msg, sig) {
		t.Fatal("signature did not verify with public key")
	}
}

func TestMasterFromInvalidMnemonicFails(t *testing.T) {
	_, err := MasterFromMnemonic(Mnemonic("not a real mnemonic at all nope"))
	if err == nil {
		t.Fatal("expected error for invalid mnemonic")
	}
}

func TestWipeMaster(t *testing.T) {
	m, _ := NewMnemonic()
	k, _ := MasterFromMnemonic(m)
	k.Wipe()
	for _, b := range k.PrivateKey {
		if b != 0 {
			t.Fatal("Wipe did not zero PrivateKey")
		}
	}
}
```

- [ ] **Step 2: Run to confirm FAIL**

Run: `cd goamp-node && go test ./account/...`
Expected: compile error — `MasterKey`, `MasterFromMnemonic` undefined.

- [ ] **Step 3: Implement**

Create `goamp-node/account/master.go`:

```go
package account

import (
	"crypto/ed25519"
	"fmt"
)

// MasterKey is the account's root ed25519 keypair. It must live in memory
// ONLY during manifest-signing operations and be wiped immediately after.
type MasterKey struct {
	PrivateKey ed25519.PrivateKey
	PublicKey  ed25519.PublicKey
}

// MasterFromMnemonic derives the ed25519 master keypair from a BIP39
// mnemonic deterministically. The first 32 bytes of the BIP39 seed are used
// as the ed25519 seed (RFC 8032).
func MasterFromMnemonic(m Mnemonic) (*MasterKey, error) {
	seed, err := m.Seed()
	if err != nil {
		return nil, fmt.Errorf("mnemonic: %w", err)
	}
	// BIP39 seed is 64 bytes; ed25519 seed is 32. Use the first 32.
	if len(seed) < ed25519.SeedSize {
		return nil, fmt.Errorf("seed too short: %d", len(seed))
	}
	priv := ed25519.NewKeyFromSeed(seed[:ed25519.SeedSize])
	pub, ok := priv.Public().(ed25519.PublicKey)
	if !ok {
		return nil, fmt.Errorf("unexpected public key type")
	}
	return &MasterKey{PrivateKey: priv, PublicKey: pub}, nil
}

// Wipe zeroes the private key bytes. Safe to call on a nil receiver.
// Callers must defer m.Wipe() immediately after obtaining a MasterKey.
func (k *MasterKey) Wipe() {
	if k == nil {
		return
	}
	for i := range k.PrivateKey {
		k.PrivateKey[i] = 0
	}
}
```

- [ ] **Step 4: Run to confirm PASS**

Run: `cd goamp-node && go test ./account/...`
Expected: 4 new tests pass, total 7.

- [ ] **Step 5: Commit**

```bash
git add goamp-node/account/master.go goamp-node/account/master_test.go
git commit -m "feat(node/account): derive ed25519 master key from BIP39 mnemonic"
```

---

## Task 4: Sub-key generation and master signing

**Files:**
- Create: `goamp-node/account/subkey.go`
- Create: `goamp-node/account/subkey_test.go`

- [ ] **Step 1: Write failing test**

Create `goamp-node/account/subkey_test.go`:

```go
package account

import (
	"crypto/ed25519"
	"testing"
)

func TestNewSubKeyIsRandom(t *testing.T) {
	a, err := NewSubKey()
	if err != nil {
		t.Fatal(err)
	}
	b, err := NewSubKey()
	if err != nil {
		t.Fatal(err)
	}
	if string(a.PublicKey) == string(b.PublicKey) {
		t.Fatal("two NewSubKey calls produced the same public key")
	}
}

func TestSignAndVerifySubKey(t *testing.T) {
	m, _ := NewMnemonic()
	master, _ := MasterFromMnemonic(m)
	defer master.Wipe()

	sub, _ := NewSubKey()
	deviceID := "device-mac-001"
	createdAt := int64(1745000000)

	sig, err := SignSubKey(master, sub.PublicKey, deviceID, createdAt)
	if err != nil {
		t.Fatal(err)
	}
	if len(sig) != ed25519.SignatureSize {
		t.Fatalf("sig length = %d, want %d", len(sig), ed25519.SignatureSize)
	}
	if err := VerifySubKey(master.PublicKey, sub.PublicKey, deviceID, createdAt, sig); err != nil {
		t.Fatalf("verify: %v", err)
	}
}

func TestVerifySubKeyRejectsTamperedDeviceID(t *testing.T) {
	m, _ := NewMnemonic()
	master, _ := MasterFromMnemonic(m)
	defer master.Wipe()
	sub, _ := NewSubKey()
	sig, _ := SignSubKey(master, sub.PublicKey, "device-a", 1745000000)
	if err := VerifySubKey(master.PublicKey, sub.PublicKey, "device-b", 1745000000, sig); err == nil {
		t.Fatal("expected verify to fail on tampered deviceID")
	}
}

func TestVerifySubKeyRejectsWrongMaster(t *testing.T) {
	m1, _ := NewMnemonic()
	master1, _ := MasterFromMnemonic(m1)
	defer master1.Wipe()
	m2, _ := NewMnemonic()
	master2, _ := MasterFromMnemonic(m2)
	defer master2.Wipe()

	sub, _ := NewSubKey()
	sig, _ := SignSubKey(master1, sub.PublicKey, "dev", 1)
	if err := VerifySubKey(master2.PublicKey, sub.PublicKey, "dev", 1, sig); err == nil {
		t.Fatal("expected verify to fail with unrelated master pub")
	}
}
```

- [ ] **Step 2: Run to confirm FAIL**

Run: `cd goamp-node && go test ./account/...`
Expected: compile error — `SubKey`, `NewSubKey`, `SignSubKey`, `VerifySubKey` undefined.

- [ ] **Step 3: Implement**

Create `goamp-node/account/subkey.go`:

```go
package account

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/binary"
	"fmt"
)

// subKeySigDomain is the signing domain-separation prefix for sub-key
// attestations. Matches the spec §5.2.
const subKeySigDomain = "goamp-device-v1"

// SubKey is a device-local ed25519 keypair signed by the account master.
// Lives in OS keychain on the owning device. Used for all day-to-day
// signing: relay requests, remote commands, pubsub encryption-key seed.
type SubKey struct {
	PrivateKey ed25519.PrivateKey
	PublicKey  ed25519.PublicKey
}

// NewSubKey generates a fresh ed25519 keypair.
func NewSubKey() (*SubKey, error) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("generate sub-key: %w", err)
	}
	return &SubKey{PrivateKey: priv, PublicKey: pub}, nil
}

// subKeyMessage returns the canonical bytes that are signed when a master
// attests a sub-key: domain || deviceID || subPub || createdAt (big-endian).
func subKeyMessage(subPub ed25519.PublicKey, deviceID string, createdAt int64) []byte {
	var ts [8]byte
	binary.BigEndian.PutUint64(ts[:], uint64(createdAt))
	buf := make([]byte, 0, len(subKeySigDomain)+len(deviceID)+len(subPub)+8)
	buf = append(buf, subKeySigDomain...)
	buf = append(buf, deviceID...)
	buf = append(buf, subPub...)
	buf = append(buf, ts[:]...)
	return buf
}

// SignSubKey produces the master's attestation over (domain || deviceID ||
// subPub || createdAt). Callers should defer master.Wipe().
func SignSubKey(master *MasterKey, subPub ed25519.PublicKey, deviceID string, createdAt int64) ([]byte, error) {
	if master == nil {
		return nil, fmt.Errorf("nil master")
	}
	msg := subKeyMessage(subPub, deviceID, createdAt)
	return ed25519.Sign(master.PrivateKey, msg), nil
}

// VerifySubKey checks that sig is a valid master attestation over the
// supplied sub-key and metadata. Returns nil on success, error otherwise.
func VerifySubKey(masterPub, subPub ed25519.PublicKey, deviceID string, createdAt int64, sig []byte) error {
	msg := subKeyMessage(subPub, deviceID, createdAt)
	if !ed25519.Verify(masterPub, msg, sig) {
		return fmt.Errorf("sub-key signature invalid")
	}
	return nil
}
```

- [ ] **Step 4: Run to confirm PASS**

Run: `cd goamp-node && go test ./account/...`
Expected: 4 new tests pass, total 11.

- [ ] **Step 5: Commit**

```bash
git add goamp-node/account/subkey.go goamp-node/account/subkey_test.go
git commit -m "feat(node/account): sub-key generation + master attestation sign/verify"
```

---

## Task 5: Device Manifest — type, canonical JSON, sign/verify

**Files:**
- Create: `goamp-node/account/manifest.go`
- Create: `goamp-node/account/manifest_test.go`

- [ ] **Step 1: Write failing test**

Create `goamp-node/account/manifest_test.go`:

```go
package account

import (
	"encoding/base64"
	"encoding/hex"
	"testing"
	"time"
)

func b64(b []byte) string { return base64.StdEncoding.EncodeToString(b) }

func TestBuildAndVerifyManifestV1(t *testing.T) {
	m, _ := NewMnemonic()
	master, _ := MasterFromMnemonic(m)
	defer master.Wipe()

	sub, _ := NewSubKey()
	now := time.Date(2026, 4, 20, 10, 0, 0, 0, time.UTC)
	entry, err := BuildDeviceEntry(master, sub.PublicKey, "Mac", "darwin", now)
	if err != nil {
		t.Fatal(err)
	}

	mf, err := BuildManifest(master, []DeviceEntry{entry}, nil, 1, now)
	if err != nil {
		t.Fatal(err)
	}

	if mf.Version != 1 {
		t.Fatalf("version = %d, want 1", mf.Version)
	}
	if mf.AccountPub != hex.EncodeToString(master.PublicKey) {
		t.Fatal("account_pub not encoded as hex of master public key")
	}
	if err := VerifyManifest(mf); err != nil {
		t.Fatalf("verify: %v", err)
	}
}

func TestVerifyManifestRejectsTamperedVersion(t *testing.T) {
	m, _ := NewMnemonic()
	master, _ := MasterFromMnemonic(m)
	defer master.Wipe()
	sub, _ := NewSubKey()
	now := time.Now().UTC()
	entry, _ := BuildDeviceEntry(master, sub.PublicKey, "Mac", "darwin", now)
	mf, _ := BuildManifest(master, []DeviceEntry{entry}, nil, 1, now)
	mf.Version = 2 // tamper after signing
	if err := VerifyManifest(mf); err == nil {
		t.Fatal("expected verify to fail after tampering")
	}
}

func TestVerifyManifestRejectsForgedDeviceEntry(t *testing.T) {
	m, _ := NewMnemonic()
	master, _ := MasterFromMnemonic(m)
	defer master.Wipe()
	sub, _ := NewSubKey()
	now := time.Now().UTC()
	entry, _ := BuildDeviceEntry(master, sub.PublicKey, "Mac", "darwin", now)
	mf, _ := BuildManifest(master, []DeviceEntry{entry}, nil, 1, now)

	// Add an extra entry without a valid master sig.
	other, _ := NewSubKey()
	mf.Devices = append(mf.Devices, DeviceEntry{
		SubPub:    hex.EncodeToString(other.PublicKey),
		Name:      "Phone",
		OS:        "ios",
		AddedAt:   now,
		MasterSig: b64([]byte("not a real signature of the right length--------------------------------")),
	})
	// Manifest master_sig is still valid over the old body; our verifier
	// must also check each device entry's master_sig.
	if err := VerifyManifest(mf); err == nil {
		t.Fatal("expected verify to fail on forged device entry")
	}
}

func TestCanonicalJSONIsStable(t *testing.T) {
	m, _ := NewMnemonic()
	master, _ := MasterFromMnemonic(m)
	defer master.Wipe()
	sub, _ := NewSubKey()
	now := time.Date(2026, 4, 20, 10, 0, 0, 0, time.UTC)
	entry, _ := BuildDeviceEntry(master, sub.PublicKey, "Mac", "darwin", now)
	mf, _ := BuildManifest(master, []DeviceEntry{entry}, nil, 1, now)

	a, err := CanonicalManifestBody(mf)
	if err != nil {
		t.Fatal(err)
	}
	b, err := CanonicalManifestBody(mf)
	if err != nil {
		t.Fatal(err)
	}
	if string(a) != string(b) {
		t.Fatal("canonical JSON not deterministic")
	}
	// master_sig must NOT appear in the signed body.
	if contains(string(a), "master_sig") {
		t.Fatal("canonical body must exclude master_sig")
	}
}

func contains(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
```

- [ ] **Step 2: Run to confirm FAIL**

Run: `cd goamp-node && go test ./account/...`
Expected: compile error — manifest types undefined.

- [ ] **Step 3: Implement**

Create `goamp-node/account/manifest.go`:

```go
package account

import (
	"bytes"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"time"
)

// manifestSigDomain is the domain-separation tag for the top-level manifest
// signature (distinct from sub-key attestations).
const manifestSigDomain = "goamp-manifest-v1"

// DeviceEntry is one active device in a manifest.
// SubPub is hex-encoded; MasterSig is base64-encoded over
// (subKeySigDomain || deviceID || subPub-raw || createdAt).
// DeviceID is derived as the first 16 hex chars of SubPub (stable per device).
type DeviceEntry struct {
	SubPub    string    `json:"sub_pub"`
	Name      string    `json:"name"`
	OS        string    `json:"os"`
	AddedAt   time.Time `json:"added_at"`
	MasterSig string    `json:"master_sig"`
}

// RevokedEntry records a removed sub-key.
type RevokedEntry struct {
	SubPub    string    `json:"sub_pub"`
	RevokedAt time.Time `json:"revoked_at"`
	Reason    string    `json:"reason"`
}

// Manifest is the signed public document listing active sub-keys for an
// account. Version is monotonically increasing. MasterSig is base64 over
// the canonical body (see CanonicalManifestBody).
type Manifest struct {
	Version    uint64         `json:"version"`
	AccountPub string         `json:"account_pub"`
	Devices    []DeviceEntry  `json:"devices"`
	Revoked    []RevokedEntry `json:"revoked"`
	CreatedAt  time.Time      `json:"created_at"`
	MasterSig  string         `json:"master_sig"`
}

// deviceIDFromSubPub derives a stable device identifier from the sub-key's
// public key — the first 16 hex chars of the hex-encoded pubkey.
func deviceIDFromSubPub(subPub ed25519.PublicKey) string {
	return hex.EncodeToString(subPub)[:16]
}

// BuildDeviceEntry generates a DeviceEntry with a master attestation over
// (deviceID || subPub || createdAt).
func BuildDeviceEntry(master *MasterKey, subPub ed25519.PublicKey, name, os string, addedAt time.Time) (DeviceEntry, error) {
	if master == nil {
		return DeviceEntry{}, fmt.Errorf("nil master")
	}
	deviceID := deviceIDFromSubPub(subPub)
	sig, err := SignSubKey(master, subPub, deviceID, addedAt.Unix())
	if err != nil {
		return DeviceEntry{}, err
	}
	return DeviceEntry{
		SubPub:    hex.EncodeToString(subPub),
		Name:      name,
		OS:        os,
		AddedAt:   addedAt.UTC(),
		MasterSig: base64.StdEncoding.EncodeToString(sig),
	}, nil
}

// CanonicalManifestBody returns deterministic JSON bytes of the manifest
// WITHOUT the top-level MasterSig field. This is what master signs.
func CanonicalManifestBody(m *Manifest) ([]byte, error) {
	body := struct {
		Version    uint64         `json:"version"`
		AccountPub string         `json:"account_pub"`
		Devices    []DeviceEntry  `json:"devices"`
		Revoked    []RevokedEntry `json:"revoked"`
		CreatedAt  time.Time      `json:"created_at"`
	}{
		Version:    m.Version,
		AccountPub: m.AccountPub,
		Devices:    m.Devices,
		Revoked:    m.Revoked,
		CreatedAt:  m.CreatedAt.UTC(),
	}
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(&body); err != nil {
		return nil, err
	}
	// Drop the trailing newline added by Encode.
	out := buf.Bytes()
	if len(out) > 0 && out[len(out)-1] == '\n' {
		out = out[:len(out)-1]
	}
	return out, nil
}

// BuildManifest assembles and signs a manifest. Callers should defer
// master.Wipe() as soon as this returns.
func BuildManifest(master *MasterKey, devices []DeviceEntry, revoked []RevokedEntry, version uint64, createdAt time.Time) (*Manifest, error) {
	if master == nil {
		return nil, fmt.Errorf("nil master")
	}
	if version == 0 {
		return nil, fmt.Errorf("version must be >= 1")
	}
	mf := &Manifest{
		Version:    version,
		AccountPub: hex.EncodeToString(master.PublicKey),
		Devices:    devices,
		Revoked:    revoked,
		CreatedAt:  createdAt.UTC(),
	}
	body, err := CanonicalManifestBody(mf)
	if err != nil {
		return nil, err
	}
	signed := append([]byte(manifestSigDomain), body...)
	sig := ed25519.Sign(master.PrivateKey, signed)
	mf.MasterSig = base64.StdEncoding.EncodeToString(sig)
	return mf, nil
}

// VerifyManifest checks:
//   1. Top-level MasterSig over canonical body matches AccountPub.
//   2. Every DeviceEntry.MasterSig is a valid sub-key attestation.
//   3. AccountPub is a valid 32-byte ed25519 public key.
func VerifyManifest(m *Manifest) error {
	if m == nil {
		return fmt.Errorf("nil manifest")
	}
	pub, err := hex.DecodeString(m.AccountPub)
	if err != nil {
		return fmt.Errorf("account_pub hex: %w", err)
	}
	if len(pub) != ed25519.PublicKeySize {
		return fmt.Errorf("account_pub wrong size: %d", len(pub))
	}
	masterPub := ed25519.PublicKey(pub)

	body, err := CanonicalManifestBody(m)
	if err != nil {
		return err
	}
	sig, err := base64.StdEncoding.DecodeString(m.MasterSig)
	if err != nil {
		return fmt.Errorf("master_sig base64: %w", err)
	}
	signed := append([]byte(manifestSigDomain), body...)
	if !ed25519.Verify(masterPub, signed, sig) {
		return fmt.Errorf("manifest master_sig invalid")
	}

	for i, d := range m.Devices {
		subPub, err := hex.DecodeString(d.SubPub)
		if err != nil {
			return fmt.Errorf("device[%d] sub_pub hex: %w", i, err)
		}
		if len(subPub) != ed25519.PublicKeySize {
			return fmt.Errorf("device[%d] sub_pub wrong size", i)
		}
		devSig, err := base64.StdEncoding.DecodeString(d.MasterSig)
		if err != nil {
			return fmt.Errorf("device[%d] master_sig base64: %w", i, err)
		}
		deviceID := deviceIDFromSubPub(subPub)
		if err := VerifySubKey(masterPub, subPub, deviceID, d.AddedAt.Unix(), devSig); err != nil {
			return fmt.Errorf("device[%d] %s: %w", i, d.Name, err)
		}
	}
	return nil
}
```

- [ ] **Step 4: Run to confirm PASS**

Run: `cd goamp-node && go test ./account/...`
Expected: 4 new tests pass, total 15.

- [ ] **Step 5: Commit**

```bash
git add goamp-node/account/manifest.go goamp-node/account/manifest_test.go
git commit -m "feat(node/account): Device Manifest with canonical-JSON sign/verify"
```

---

## Task 6: HKDF state-key derivation

**Files:**
- Create: `goamp-node/account/statekey.go`
- Create: `goamp-node/account/statekey_test.go`

- [ ] **Step 1: Write failing test**

Create `goamp-node/account/statekey_test.go`:

```go
package account

import (
	"bytes"
	"testing"
)

func TestDeriveStateKeyDeterministic(t *testing.T) {
	m, _ := NewMnemonic()
	k1, err := DeriveStateKey(m, StateKeyV1)
	if err != nil {
		t.Fatal(err)
	}
	k2, err := DeriveStateKey(m, StateKeyV1)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(k1, k2) {
		t.Fatal("state key not deterministic for same mnemonic+version")
	}
	if len(k1) != 32 {
		t.Fatalf("want 32-byte key, got %d", len(k1))
	}
}

func TestDeriveStateKeyDiffersByVersion(t *testing.T) {
	m, _ := NewMnemonic()
	k1, _ := DeriveStateKey(m, StateKeyV1)
	k2, _ := DeriveStateKey(m, "goamp-state-v2")
	if bytes.Equal(k1, k2) {
		t.Fatal("different versions produced the same key")
	}
}

func TestDeriveStateKeyDiffersByMnemonic(t *testing.T) {
	m1, _ := NewMnemonic()
	m2, _ := NewMnemonic()
	k1, _ := DeriveStateKey(m1, StateKeyV1)
	k2, _ := DeriveStateKey(m2, StateKeyV1)
	if bytes.Equal(k1, k2) {
		t.Fatal("different mnemonics produced the same key")
	}
}

func TestDeriveStateKeyRejectsInvalidMnemonic(t *testing.T) {
	_, err := DeriveStateKey(Mnemonic("blah"), StateKeyV1)
	if err == nil {
		t.Fatal("expected error")
	}
}
```

- [ ] **Step 2: Run to confirm FAIL**

Run: `cd goamp-node && go test ./account/...`
Expected: compile error — `DeriveStateKey`, `StateKeyV1` undefined.

- [ ] **Step 3: Implement**

Create `goamp-node/account/statekey.go`:

```go
package account

import (
	"crypto/hkdf"
	"crypto/sha256"
	"fmt"
)

// StateKeyV1 is the current HKDF `info` tag for state-blob encryption keys.
// Bumped by paranoid-mode revoke (§5.4).
const StateKeyV1 = "goamp-state-v1"

// stateKeySalt is the fixed HKDF salt for state-key derivation.
const stateKeySalt = "goamp-v1"

// DeriveStateKey returns the 32-byte ChaCha20-Poly1305 key used to encrypt
// the per-account state blob. Derivation:
//   state_key = HKDF-SHA256(ikm=BIP39_seed, salt="goamp-v1", info=version)
// The BIP39 seed (64 bytes) is used as the input keying material — it is
// strictly stronger than the 32-byte ed25519 seed used for the master key.
func DeriveStateKey(m Mnemonic, info string) ([]byte, error) {
	seed, err := m.Seed()
	if err != nil {
		return nil, fmt.Errorf("mnemonic seed: %w", err)
	}
	key, err := hkdf.Key(sha256.New, seed, []byte(stateKeySalt), info, 32)
	if err != nil {
		return nil, fmt.Errorf("hkdf: %w", err)
	}
	return key, nil
}
```

- [ ] **Step 4: Run to confirm PASS**

Run: `cd goamp-node && go test ./account/...`
Expected: 4 new tests pass, total 19.

- [ ] **Step 5: Commit**

```bash
git add goamp-node/account/statekey.go goamp-node/account/statekey_test.go
git commit -m "feat(node/account): HKDF-SHA256 state-key derivation"
```

---

## Task 7: Verification quiz

**Files:**
- Create: `goamp-node/account/quiz.go`
- Create: `goamp-node/account/quiz_test.go`

- [ ] **Step 1: Write failing test**

Create `goamp-node/account/quiz_test.go`:

```go
package account

import (
	"strings"
	"testing"
)

func TestQuizPositionsUniqueAndInRange(t *testing.T) {
	m := Mnemonic("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about")
	q, err := NewQuiz(m, 3)
	if err != nil {
		t.Fatal(err)
	}
	if len(q.Positions) != 3 {
		t.Fatalf("want 3 positions, got %d", len(q.Positions))
	}
	seen := map[int]bool{}
	for _, p := range q.Positions {
		if p < 0 || p >= 12 {
			t.Fatalf("position out of range: %d", p)
		}
		if seen[p] {
			t.Fatalf("duplicate position: %d", p)
		}
		seen[p] = true
	}
}

func TestQuizCheckAccepts(t *testing.T) {
	m := Mnemonic("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about")
	q, _ := NewQuiz(m, 3)
	words := strings.Fields(string(m))
	answers := make([]string, len(q.Positions))
	for i, p := range q.Positions {
		answers[i] = words[p]
	}
	if err := q.Check(answers); err != nil {
		t.Fatalf("Check rejected correct answers: %v", err)
	}
}

func TestQuizCheckRejectsWrong(t *testing.T) {
	m := Mnemonic("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about")
	q, _ := NewQuiz(m, 3)
	bad := []string{"wrong", "wrong", "wrong"}
	if err := q.Check(bad); err == nil {
		t.Fatal("expected rejection")
	}
}

func TestQuizCheckRejectsWrongArity(t *testing.T) {
	m := Mnemonic("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about")
	q, _ := NewQuiz(m, 3)
	if err := q.Check([]string{"only", "two"}); err == nil {
		t.Fatal("expected rejection for wrong-length answers")
	}
}
```

- [ ] **Step 2: Run to confirm FAIL**

Run: `cd goamp-node && go test ./account/...`
Expected: compile error — `Quiz`, `NewQuiz` undefined.

- [ ] **Step 3: Implement**

Create `goamp-node/account/quiz.go`:

```go
package account

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/binary"
	"fmt"
	"sort"
	"strings"
)

// Quiz holds randomly chosen word positions the user must echo back from
// a mnemonic they have just been shown, plus the correct words. The
// secret answers are kept inside the Quiz and never surfaced to UI.
type Quiz struct {
	Positions []int    // 0-indexed positions into the mnemonic
	answers   []string // correct words at those positions, lowercased
}

// NewQuiz picks `count` unique random positions from the mnemonic.
// count must be >= 1 and <= word count of m.
func NewQuiz(m Mnemonic, count int) (*Quiz, error) {
	if err := m.Validate(); err != nil {
		return nil, err
	}
	words := strings.Fields(string(m))
	n := len(words)
	if count < 1 || count > n {
		return nil, fmt.Errorf("count out of range: %d (mnemonic has %d words)", count, n)
	}
	positions := pickUnique(n, count)
	answers := make([]string, count)
	for i, p := range positions {
		answers[i] = strings.ToLower(words[p])
	}
	return &Quiz{Positions: positions, answers: answers}, nil
}

// pickUnique returns `k` unique indices from [0, n) drawn uniformly using
// crypto/rand.
func pickUnique(n, k int) []int {
	chosen := map[int]struct{}{}
	for len(chosen) < k {
		var b [8]byte
		_, _ = rand.Read(b[:])
		idx := int(binary.BigEndian.Uint64(b[:]) % uint64(n))
		chosen[idx] = struct{}{}
	}
	out := make([]int, 0, k)
	for p := range chosen {
		out = append(out, p)
	}
	sort.Ints(out)
	return out
}

// Check returns nil iff answers matches the stored words at the stored
// positions, constant-time per entry. Comparison is case-insensitive and
// trims whitespace.
func (q *Quiz) Check(answers []string) error {
	if len(answers) != len(q.answers) {
		return fmt.Errorf("wrong answer count: got %d, want %d", len(answers), len(q.answers))
	}
	ok := 1
	for i, a := range answers {
		got := strings.ToLower(strings.TrimSpace(a))
		want := q.answers[i]
		if subtle.ConstantTimeCompare([]byte(got), []byte(want)) != 1 {
			ok = 0
		}
	}
	if ok != 1 {
		return fmt.Errorf("quiz answers do not match")
	}
	return nil
}
```

- [ ] **Step 4: Run to confirm PASS**

Run: `cd goamp-node && go test ./account/...`
Expected: 4 new tests pass, total 23.

- [ ] **Step 5: Commit**

```bash
git add goamp-node/account/quiz.go goamp-node/account/quiz_test.go
git commit -m "feat(node/account): mnemonic verification quiz"
```

---

## Task 8: HTTP endpoints on goamp-node

**Files:**
- Create: `goamp-node/api/account_handlers.go`
- Create: `goamp-node/api/account_handlers_test.go`
- Modify: `goamp-node/api/server.go` (register routes)

- [ ] **Step 1: Write failing test**

Create `goamp-node/api/account_handlers_test.go`:

```go
package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func testServer(t *testing.T) *httptest.Server {
	t.Helper()
	srv := New(nil, nil, nil, nil)
	mux := http.NewServeMux()
	srv.RegisterAccountRoutes(mux)
	return httptest.NewServer(mux)
}

func TestAccountCreateReturnsMnemonicAndManifest(t *testing.T) {
	ts := testServer(t)
	defer ts.Close()

	body := []byte(`{"device_name":"Mac","os":"darwin"}`)
	resp, err := http.Post(ts.URL+"/account/create", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	var out struct {
		Mnemonic   string          `json:"mnemonic"`
		AccountPub string          `json:"account_pub"`
		SubPub     string          `json:"sub_pub"`
		SubSk      string          `json:"sub_sk"`
		StateKey   string          `json:"state_key"`
		Manifest   json.RawMessage `json:"manifest"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	if w := len(strings.Fields(out.Mnemonic)); w != 12 {
		t.Fatalf("mnemonic word count = %d", w)
	}
	if out.AccountPub == "" || out.SubPub == "" || out.SubSk == "" || out.StateKey == "" {
		t.Fatal("missing fields")
	}
	if len(out.Manifest) == 0 {
		t.Fatal("empty manifest")
	}
}

func TestAccountLoadReturnsAccountPub(t *testing.T) {
	ts := testServer(t)
	defer ts.Close()

	// Create first, capture mnemonic.
	resp, _ := http.Post(ts.URL+"/account/create", "application/json",
		strings.NewReader(`{"device_name":"Mac","os":"darwin"}`))
	var created struct {
		Mnemonic   string `json:"mnemonic"`
		AccountPub string `json:"account_pub"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&created)
	resp.Body.Close()

	// Load with same mnemonic.
	loadBody, _ := json.Marshal(map[string]string{"mnemonic": created.Mnemonic})
	r2, err := http.Post(ts.URL+"/account/load", "application/json", bytes.NewReader(loadBody))
	if err != nil {
		t.Fatal(err)
	}
	defer r2.Body.Close()
	if r2.StatusCode != 200 {
		t.Fatalf("status = %d", r2.StatusCode)
	}
	var loaded struct {
		AccountPub string `json:"account_pub"`
		StateKey   string `json:"state_key"`
	}
	_ = json.NewDecoder(r2.Body).Decode(&loaded)
	if loaded.AccountPub != created.AccountPub {
		t.Fatalf("account_pub mismatch: got %q, want %q", loaded.AccountPub, created.AccountPub)
	}
	if loaded.StateKey == "" {
		t.Fatal("empty state_key")
	}
}

func TestAccountLoadRejectsInvalidMnemonic(t *testing.T) {
	ts := testServer(t)
	defer ts.Close()
	body := []byte(`{"mnemonic":"not a valid mnemonic"}`)
	resp, _ := http.Post(ts.URL+"/account/load", "application/json", bytes.NewReader(body))
	defer resp.Body.Close()
	if resp.StatusCode != 400 {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
}

func TestAccountVerifyManifestAcceptsGood(t *testing.T) {
	ts := testServer(t)
	defer ts.Close()

	// Create to get a valid manifest.
	resp, _ := http.Post(ts.URL+"/account/create", "application/json",
		strings.NewReader(`{"device_name":"Mac","os":"darwin"}`))
	var created struct {
		Manifest json.RawMessage `json:"manifest"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&created)
	resp.Body.Close()

	r2, _ := http.Post(ts.URL+"/account/verify-manifest", "application/json",
		bytes.NewReader(created.Manifest))
	defer r2.Body.Close()
	if r2.StatusCode != 200 {
		t.Fatalf("status = %d", r2.StatusCode)
	}
	var v struct {
		Valid bool `json:"valid"`
	}
	_ = json.NewDecoder(r2.Body).Decode(&v)
	if !v.Valid {
		t.Fatal("expected valid=true")
	}
}
```

- [ ] **Step 2: Run to confirm FAIL**

Run: `cd goamp-node && go test ./api/... -run TestAccount`
Expected: compile error — `RegisterAccountRoutes` undefined.

- [ ] **Step 3: Implement handlers**

Create `goamp-node/api/account_handlers.go`:

```go
package api

import (
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"time"

	"github.com/goamp/sdk/account"
)

// RegisterAccountRoutes wires /account/* onto mux. Kept in a separate
// method so it can be mounted by main and by tests without pulling the
// whole Server graph.
func (s *Server) RegisterAccountRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /account/create", s.handleAccountCreate)
	mux.HandleFunc("POST /account/load", s.handleAccountLoad)
	mux.HandleFunc("POST /account/sign-manifest", s.handleAccountSignManifest)
	mux.HandleFunc("POST /account/verify-manifest", s.handleAccountVerifyManifest)
}

type createReq struct {
	DeviceName string `json:"device_name"`
	OS         string `json:"os"`
}

type createResp struct {
	Mnemonic   string            `json:"mnemonic"`
	AccountPub string            `json:"account_pub"`
	SubPub     string            `json:"sub_pub"`
	SubSk      string            `json:"sub_sk"`    // base64 ed25519 private key (64 bytes)
	StateKey   string            `json:"state_key"` // base64 32-byte ChaCha20 key
	Manifest   *account.Manifest `json:"manifest"`
}

func (s *Server) handleAccountCreate(w http.ResponseWriter, r *http.Request) {
	var req createReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad json: "+err.Error(), 400)
		return
	}
	if req.DeviceName == "" || req.OS == "" {
		http.Error(w, "device_name and os required", 400)
		return
	}

	mnem, err := account.NewMnemonic()
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	master, err := account.MasterFromMnemonic(mnem)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	defer master.Wipe()

	sub, err := account.NewSubKey()
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	now := time.Now().UTC()
	entry, err := account.BuildDeviceEntry(master, sub.PublicKey, req.DeviceName, req.OS, now)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	mf, err := account.BuildManifest(master, []account.DeviceEntry{entry}, nil, 1, now)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	stateKey, err := account.DeriveStateKey(mnem, account.StateKeyV1)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}

	writeJSON(w, createResp{
		Mnemonic:   string(mnem),
		AccountPub: hex.EncodeToString(master.PublicKey),
		SubPub:     hex.EncodeToString(sub.PublicKey),
		SubSk:      base64.StdEncoding.EncodeToString(sub.PrivateKey),
		StateKey:   base64.StdEncoding.EncodeToString(stateKey),
		Manifest:   mf,
	})
}

type loadReq struct {
	Mnemonic string `json:"mnemonic"`
}

type loadResp struct {
	AccountPub string `json:"account_pub"`
	StateKey   string `json:"state_key"`
}

func (s *Server) handleAccountLoad(w http.ResponseWriter, r *http.Request) {
	var req loadReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad json: "+err.Error(), 400)
		return
	}
	mnem := account.Mnemonic(req.Mnemonic)
	master, err := account.MasterFromMnemonic(mnem)
	if err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	defer master.Wipe()
	stateKey, err := account.DeriveStateKey(mnem, account.StateKeyV1)
	if err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	writeJSON(w, loadResp{
		AccountPub: hex.EncodeToString(master.PublicKey),
		StateKey:   base64.StdEncoding.EncodeToString(stateKey),
	})
}

type signManifestReq struct {
	Mnemonic string                `json:"mnemonic"`
	Version  uint64                `json:"version"`
	Devices  []account.DeviceEntry `json:"devices"`
	Revoked  []account.RevokedEntry `json:"revoked"`
}

func (s *Server) handleAccountSignManifest(w http.ResponseWriter, r *http.Request) {
	var req signManifestReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad json: "+err.Error(), 400)
		return
	}
	master, err := account.MasterFromMnemonic(account.Mnemonic(req.Mnemonic))
	if err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	defer master.Wipe()
	mf, err := account.BuildManifest(master, req.Devices, req.Revoked, req.Version, time.Now().UTC())
	if err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	writeJSON(w, mf)
}

func (s *Server) handleAccountVerifyManifest(w http.ResponseWriter, r *http.Request) {
	var mf account.Manifest
	if err := json.NewDecoder(r.Body).Decode(&mf); err != nil {
		http.Error(w, "bad json: "+err.Error(), 400)
		return
	}
	verr := account.VerifyManifest(&mf)
	writeJSON(w, map[string]interface{}{
		"valid": verr == nil,
		"error": errString(verr),
	})
}

func errString(e error) string {
	if e == nil {
		return ""
	}
	return e.Error()
}

func writeJSON(w http.ResponseWriter, v interface{}) {
	w.Header().Set("content-type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}
```

- [ ] **Step 4: Wire routes in server.go**

Edit `goamp-node/api/server.go`: in `Start`, after the existing `mux.HandleFunc` lines and before the plugin wildcard line, insert:

```go
	// Account (identity & keys)
	s.RegisterAccountRoutes(mux)
```

- [ ] **Step 5: Run to confirm PASS**

Run: `cd goamp-node && go test ./api/... -run TestAccount -v`
Expected: 4 new tests pass.

- [ ] **Step 6: Full-package check**

Run: `cd goamp-node && go test ./...`
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add goamp-node/api/account_handlers.go goamp-node/api/account_handlers_test.go goamp-node/api/server.go
git commit -m "feat(node/api): /account/{create,load,sign-manifest,verify-manifest} endpoints"
```

---

## Task 9: Rust — keyring dependency

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add dependency**

In `src-tauri/Cargo.toml`, under `[dependencies]`, add:

```toml
keyring = "3.6"
```

- [ ] **Step 2: Verify compile**

Run: `cd src-tauri && cargo check`
Expected: exit 0; `keyring` appears in `Cargo.lock`.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "chore(tauri): add keyring crate for OS credential storage"
```

---

## Task 10: Rust — account module with keychain persistence

**Files:**
- Create: `src-tauri/src/account.rs`

- [ ] **Step 1: Write failing test**

Append at the bottom of `src-tauri/src/account.rs` (create the file):

```rust
// Placeholder; full content in Step 2. The test references what we will
// implement next.

#[cfg(test)]
mod tests {
    use super::*;

    // Uses the `mock-keyring` feature of the `keyring` crate in test mode
    // via `keyring::set_default_credential_builder`. When not available
    // on this host, tests are a no-op.
    #[test]
    fn roundtrip_sub_key_in_memory_keychain() {
        keyring::set_default_credential_builder(keyring::mock::default_credential_builder());

        let stored = StoredAccount {
            account_pub: "abcd".into(),
            sub_pub: "1234".into(),
            sub_sk_b64: "c3Vic2s=".into(), // "subsk" base64
            state_key_b64: "c3RhdGU=".into(),
        };
        save_account(&stored).expect("save");
        let loaded = load_account("abcd").expect("load");
        assert_eq!(loaded.sub_sk_b64, "c3Vic2s=");
        assert_eq!(loaded.state_key_b64, "c3RhdGU=");
    }

    #[test]
    fn load_missing_account_returns_none() {
        keyring::set_default_credential_builder(keyring::mock::default_credential_builder());
        let got = load_account_opt("does-not-exist").expect("ok");
        assert!(got.is_none());
    }
}
```

- [ ] **Step 2: Run to confirm FAIL**

Run: `cd src-tauri && cargo test --lib account::`
Expected: compile error — `StoredAccount`, `save_account`, `load_account` undefined.

- [ ] **Step 3: Implement**

Replace the whole file `src-tauri/src/account.rs` with:

```rust
//! Account — OS-keychain-backed storage for the device sub-key and
//! state-encryption key, plus thin HTTP glue to `goamp-node` for the
//! master-touching operations (create, load, sign manifest).
//!
//! Keychain schema (one service per account_pub):
//!   service = "goamp/account/{account_pub}"
//!   entry "sub_sk"        -> base64 ed25519 private key
//!   entry "sub_pub"       -> hex public key
//!   entry "state_key"     -> base64 32 bytes
//! Plus a single global pointer:
//!   service = "goamp/account", entry "current" -> account_pub
//!
//! The master key is never stored here; the user writes the mnemonic down.

use keyring::Entry;
use serde::{Deserialize, Serialize};

const SERVICE_ROOT: &str = "goamp/account";
const ENTRY_SUB_SK: &str = "sub_sk";
const ENTRY_SUB_PUB: &str = "sub_pub";
const ENTRY_STATE_KEY: &str = "state_key";
const ENTRY_CURRENT: &str = "current";

fn account_service(account_pub: &str) -> String {
    format!("{}/{}", SERVICE_ROOT, account_pub)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredAccount {
    pub account_pub: String,
    pub sub_pub: String,
    pub sub_sk_b64: String,
    pub state_key_b64: String,
}

pub fn save_account(a: &StoredAccount) -> Result<(), keyring::Error> {
    let svc = account_service(&a.account_pub);
    Entry::new(&svc, ENTRY_SUB_SK)?.set_password(&a.sub_sk_b64)?;
    Entry::new(&svc, ENTRY_SUB_PUB)?.set_password(&a.sub_pub)?;
    Entry::new(&svc, ENTRY_STATE_KEY)?.set_password(&a.state_key_b64)?;
    Entry::new(SERVICE_ROOT, ENTRY_CURRENT)?.set_password(&a.account_pub)?;
    Ok(())
}

pub fn load_account(account_pub: &str) -> Result<StoredAccount, keyring::Error> {
    let svc = account_service(account_pub);
    Ok(StoredAccount {
        account_pub: account_pub.to_string(),
        sub_pub: Entry::new(&svc, ENTRY_SUB_PUB)?.get_password()?,
        sub_sk_b64: Entry::new(&svc, ENTRY_SUB_SK)?.get_password()?,
        state_key_b64: Entry::new(&svc, ENTRY_STATE_KEY)?.get_password()?,
    })
}

pub fn load_account_opt(account_pub: &str) -> Result<Option<StoredAccount>, keyring::Error> {
    match load_account(account_pub) {
        Ok(a) => Ok(Some(a)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e),
    }
}

pub fn current_account_pub() -> Result<Option<String>, keyring::Error> {
    match Entry::new(SERVICE_ROOT, ENTRY_CURRENT)?.get_password() {
        Ok(s) => Ok(Some(s)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e),
    }
}

pub fn delete_account(account_pub: &str) -> Result<(), keyring::Error> {
    let svc = account_service(account_pub);
    let _ = Entry::new(&svc, ENTRY_SUB_SK)?.delete_credential();
    let _ = Entry::new(&svc, ENTRY_SUB_PUB)?.delete_credential();
    let _ = Entry::new(&svc, ENTRY_STATE_KEY)?.delete_credential();
    // Clear "current" only if it points to this account.
    if let Ok(Some(cur)) = current_account_pub() {
        if cur == account_pub {
            let _ = Entry::new(SERVICE_ROOT, ENTRY_CURRENT)?.delete_credential();
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_sub_key_in_memory_keychain() {
        keyring::set_default_credential_builder(keyring::mock::default_credential_builder());
        let stored = StoredAccount {
            account_pub: "abcd".into(),
            sub_pub: "1234".into(),
            sub_sk_b64: "c3Vic2s=".into(),
            state_key_b64: "c3RhdGU=".into(),
        };
        save_account(&stored).expect("save");
        let loaded = load_account("abcd").expect("load");
        assert_eq!(loaded.sub_sk_b64, "c3Vic2s=");
        assert_eq!(loaded.state_key_b64, "c3RhdGU=");
    }

    #[test]
    fn load_missing_account_returns_none() {
        keyring::set_default_credential_builder(keyring::mock::default_credential_builder());
        let got = load_account_opt("does-not-exist").expect("ok");
        assert!(got.is_none());
    }
}
```

- [ ] **Step 4: Register module**

Edit `src-tauri/src/lib.rs`: add `pub mod account;` alongside other `pub mod ...;` lines near the top.

- [ ] **Step 5: Run to confirm PASS**

Run: `cd src-tauri && cargo test --lib account::`
Expected: 2 tests pass.

Note: if the `mock` module is gated behind a Cargo feature in the installed `keyring` version, enable it in Task 9: `keyring = { version = "3.6", features = ["mock"] }`. If that feature does not exist, remove the two tests and rely on Task 12's end-to-end test.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/account.rs src-tauri/src/lib.rs
git commit -m "feat(tauri): account module — OS-keychain sub-key + state-key storage"
```

---

## Task 11: Rust — Tauri commands

**Files:**
- Create: `src-tauri/src/commands/account.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs` (register handlers)

- [ ] **Step 1: Locate invoke_handler site**

Run: `grep -n "invoke_handler" src-tauri/src/lib.rs`
Record the line number — the list ends with either `])` or `]).build(...)`. You'll insert the new commands into that list in Step 4.

- [ ] **Step 2: Implement commands**

Create `src-tauri/src/commands/account.rs`:

```rust
//! Tauri commands that glue the frontend to `goamp-node`'s /account/*
//! endpoints and the local OS keychain.

use crate::account as acct;
use serde::{Deserialize, Serialize};
use serde_json::Value;

const NODE_BASE: &str = "http://127.0.0.1:7472";

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateAccountResult {
    /// Shown to the user once. Frontend must NOT persist this.
    pub mnemonic: String,
    pub account_pub: String,
    /// Positions (0..11) the frontend must quiz the user on.
    pub quiz_positions: Vec<u8>,
}

fn http() -> reqwest::blocking::Client {
    reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .expect("reqwest client")
}

fn pick_quiz_positions() -> Vec<u8> {
    use rand::seq::SliceRandom;
    let mut rng = rand::thread_rng();
    let mut all: Vec<u8> = (0..12).collect();
    all.shuffle(&mut rng);
    all.into_iter().take(3).collect()
}

/// Create a fresh account. Calls node /account/create, stores sub_sk +
/// state_key in the OS keychain under the new account_pub, and returns
/// the mnemonic + quiz positions to the frontend.
///
/// The mnemonic MUST be shown to the user once and discarded from UI state
/// after quiz completion. It is NOT persisted on the Rust side.
#[tauri::command]
pub fn account_create(device_name: String, os: String) -> Result<CreateAccountResult, String> {
    let resp = http()
        .post(format!("{}/account/create", NODE_BASE))
        .json(&serde_json::json!({ "device_name": device_name, "os": os }))
        .send()
        .map_err(|e| format!("node request: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("node status: {}", resp.status()));
    }
    let body: Value = resp.json().map_err(|e| format!("decode: {}", e))?;
    let mnemonic = body["mnemonic"].as_str().ok_or("missing mnemonic")?.to_string();
    let account_pub = body["account_pub"].as_str().ok_or("missing account_pub")?.to_string();
    let sub_pub = body["sub_pub"].as_str().ok_or("missing sub_pub")?.to_string();
    let sub_sk = body["sub_sk"].as_str().ok_or("missing sub_sk")?.to_string();
    let state_key = body["state_key"].as_str().ok_or("missing state_key")?.to_string();

    acct::save_account(&acct::StoredAccount {
        account_pub: account_pub.clone(),
        sub_pub,
        sub_sk_b64: sub_sk,
        state_key_b64: state_key,
    })
    .map_err(|e| format!("keychain: {}", e))?;

    Ok(CreateAccountResult {
        mnemonic,
        account_pub,
        quiz_positions: pick_quiz_positions(),
    })
}

#[derive(Debug, Serialize)]
pub struct LoadAccountResult {
    pub account_pub: String,
    pub sub_pub: String,
    /// `true` if this device is already provisioned (has a sub_sk in keychain).
    pub provisioned: bool,
}

/// Return the currently-stored account (if any). Does NOT require the
/// mnemonic — it reads the sub-key from the keychain.
#[tauri::command]
pub fn account_current() -> Result<Option<LoadAccountResult>, String> {
    let Some(pub_) = acct::current_account_pub().map_err(|e| e.to_string())? else {
        return Ok(None);
    };
    let a = acct::load_account(&pub_).map_err(|e| e.to_string())?;
    Ok(Some(LoadAccountResult {
        account_pub: a.account_pub,
        sub_pub: a.sub_pub,
        provisioned: true,
    }))
}

/// Remove all keychain entries for `account_pub`. Irreversible on this
/// device without re-pairing or seed-phrase recovery.
#[tauri::command]
pub fn account_forget(account_pub: String) -> Result<(), String> {
    acct::delete_account(&account_pub).map_err(|e| e.to_string())
}
```

- [ ] **Step 3: Wire module**

Edit `src-tauri/src/commands/mod.rs`: add `pub mod account;` alongside other `pub mod ...;` lines.

- [ ] **Step 4: Register invoke handlers**

In `src-tauri/src/lib.rs`, inside the `tauri::generate_handler![...]` list, append:

```rust
        commands::account::account_create,
        commands::account::account_current,
        commands::account::account_forget,
```

- [ ] **Step 5: Compile check**

Run: `cd src-tauri && cargo check`
Expected: exit 0.

Note on deps: if `rand` is not already in `Cargo.toml`, add `rand = "0.8"` under `[dependencies]` and commit alongside. If `reqwest` is not yet a direct dep, add `reqwest = { version = "0.12", features = ["blocking", "json"] }`.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands/account.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "feat(tauri): account_create/current/forget commands via goamp-node"
```

---

## Task 12: Frontend — AccountService

**Files:**
- Create: `src/services/AccountService.ts`
- Create: `src/services/AccountService.test.ts`
- Modify: `src/services/interfaces.ts`
- Modify: `src/services/index.ts`

- [ ] **Step 1: Write failing test**

Create `src/services/AccountService.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { AccountService } from "./AccountService";
import type { ITransport } from "./transport";

function mockTransport(handlers: Record<string, (args: unknown) => unknown>): ITransport {
  return {
    invoke: vi.fn(async (cmd: string, args?: unknown) => handlers[cmd](args)),
    listen: vi.fn(async () => () => {}),
  } as unknown as ITransport;
}

describe("AccountService", () => {
  it("create returns mnemonic and quiz positions", async () => {
    const t = mockTransport({
      account_create: () => ({
        mnemonic: "one two three four five six seven eight nine ten eleven twelve",
        account_pub: "abc",
        quiz_positions: [1, 5, 9],
      }),
    });
    const svc = new AccountService(t);
    const r = await svc.create("Mac", "darwin");
    expect(r.mnemonic.split(" ")).toHaveLength(12);
    expect(r.quizPositions).toEqual([1, 5, 9]);
    expect(r.accountPub).toBe("abc");
  });

  it("current returns null when no account provisioned", async () => {
    const t = mockTransport({ account_current: () => null });
    const svc = new AccountService(t);
    expect(await svc.current()).toBeNull();
  });

  it("verifyQuiz is pure — compares lowercased trimmed words", async () => {
    const t = mockTransport({});
    const svc = new AccountService(t);
    const words = "a b c d e f g h i j k l".split(" ");
    expect(svc.verifyQuiz(words, [1, 5, 9], [" B ", "F", "j"])).toBe(true);
    expect(svc.verifyQuiz(words, [1, 5, 9], ["B", "F", "WRONG"])).toBe(false);
    expect(svc.verifyQuiz(words, [1, 5], ["B", "F", "J"])).toBe(false); // arity
  });

  it("forget issues account_forget command", async () => {
    const calls: string[] = [];
    const t = mockTransport({
      account_forget: (args) => {
        calls.push(JSON.stringify(args));
        return null;
      },
    });
    const svc = new AccountService(t);
    await svc.forget("abc");
    expect(calls).toEqual([`{"accountPub":"abc"}`]);
  });
});
```

- [ ] **Step 2: Run to confirm FAIL**

Run: `pnpm test src/services/AccountService.test.ts`
Expected: fail — `AccountService` not found.

- [ ] **Step 3: Add interface**

Edit `src/services/interfaces.ts` to append:

```ts
export interface CreatedAccount {
  mnemonic: string;
  accountPub: string;
  quizPositions: number[];
}

export interface CurrentAccount {
  accountPub: string;
  subPub: string;
  provisioned: boolean;
}

export interface IAccountService {
  create(deviceName: string, os: string): Promise<CreatedAccount>;
  current(): Promise<CurrentAccount | null>;
  forget(accountPub: string): Promise<void>;
  /** Pure helper — case-insensitive, whitespace-trimmed. */
  verifyQuiz(mnemonic: string[], positions: number[], answers: string[]): boolean;
}
```

- [ ] **Step 4: Implement**

Create `src/services/AccountService.ts`:

```ts
import type { ITransport } from "./transport";
import type {
  CreatedAccount,
  CurrentAccount,
  IAccountService,
} from "./interfaces";

interface RawCreated {
  mnemonic: string;
  account_pub: string;
  quiz_positions: number[];
}

interface RawCurrent {
  account_pub: string;
  sub_pub: string;
  provisioned: boolean;
}

export class AccountService implements IAccountService {
  constructor(private readonly t: ITransport) {}

  async create(deviceName: string, os: string): Promise<CreatedAccount> {
    const r = (await this.t.invoke("account_create", {
      deviceName,
      os,
    })) as RawCreated;
    return {
      mnemonic: r.mnemonic,
      accountPub: r.account_pub,
      quizPositions: r.quiz_positions,
    };
  }

  async current(): Promise<CurrentAccount | null> {
    const r = (await this.t.invoke("account_current")) as RawCurrent | null;
    if (!r) return null;
    return {
      accountPub: r.account_pub,
      subPub: r.sub_pub,
      provisioned: r.provisioned,
    };
  }

  async forget(accountPub: string): Promise<void> {
    await this.t.invoke("account_forget", { accountPub });
  }

  verifyQuiz(mnemonic: string[], positions: number[], answers: string[]): boolean {
    if (answers.length !== positions.length) return false;
    for (let i = 0; i < positions.length; i++) {
      const want = (mnemonic[positions[i]] ?? "").toLowerCase().trim();
      const got = (answers[i] ?? "").toLowerCase().trim();
      if (want === "" || want !== got) return false;
    }
    return true;
  }
}
```

- [ ] **Step 5: Export**

Edit `src/services/index.ts`: add `export { AccountService } from "./AccountService";` and re-export new interface types.

- [ ] **Step 6: Run to confirm PASS**

Run: `pnpm test src/services/AccountService.test.ts`
Expected: 4 tests pass.

- [ ] **Step 7: Full TS test suite**

Run: `pnpm test`
Expected: all previous tests still pass.

- [ ] **Step 8: Commit**

```bash
git add src/services/AccountService.ts src/services/AccountService.test.ts src/services/interfaces.ts src/services/index.ts
git commit -m "feat(services): AccountService — create/current/forget + quiz verify"
```

---

## Task 13: End-to-end verification

**Files:**
- None (smoke test only)

- [ ] **Step 1: Go tests**

Run: `cd goamp-node && go test ./...`
Expected: all tests pass, no new regressions.

- [ ] **Step 2: Rust build + tests**

Run: `cd src-tauri && cargo check && cargo test --lib`
Expected: exit 0; account tests pass.

- [ ] **Step 3: TypeScript tests**

Run: `pnpm test`
Expected: all green.

- [ ] **Step 4: Tag the milestone**

```bash
git tag -a multi-device-p1-identity -m "Multi-device Plan 1 complete: identity primitives wired through Go/Rust/TS"
```

- [ ] **Step 5: Done**

Plan 1 delivers working primitives. Next: Plan 2 (Relay MVP) uses `AccountService.create` output + `sub_sk` from keychain to sign relay requests.

---

## Self-Review

**Spec coverage (§5 + §6.1 + §6.4):**
- Master ed25519 from BIP39 → Task 3 ✓
- BIP39 verify quiz → Task 7 + Task 12 (`verifyQuiz`) ✓
- Sub-key generation + master attestation → Task 4 ✓
- Device Manifest format, sign, verify, versioning → Task 5 ✓
- HKDF state-key derivation → Task 6 ✓
- OS keychain for sub-key + state-key → Tasks 10, 11 ✓
- Master wiped after signing → Task 3 (`Wipe`), used consistently in Task 8 handlers ✓
- `account_pub` derived from master public key → Task 5 (`BuildManifest` fills from master.PublicKey) ✓
- Manifest version monotonic enforcement → NOT in this plan. This is a **relay-side** concern (spec §6.3 "Relay rejects stale versions") and belongs in Plan 2. The primitives here produce arbitrary-version manifests; the relay will enforce ordering.
- Revocation list handling → Structure present in `Manifest.Revoked` + `sign-manifest` endpoint accepts `revoked` array. Full revoke UX (confirmation, paranoid-mode state-key rotation) deferred to Plan 5.
- Pairing flow → deferred to Plan 5 (requires Plan 2 relay first).
- Recovery from seed → primitives exist (`MasterFromMnemonic`), UX deferred to Plan 5.

**Placeholders scan:** none. Every step has concrete code, file paths, commands.

**Type consistency:**
- `Mnemonic` type: defined Task 2, used Tasks 3, 6, 7, 8 — consistent.
- `MasterKey.PrivateKey` (ed25519.PrivateKey) + `.Wipe()` used identically everywhere.
- `Manifest.AccountPub` hex-encoded — verified in Task 5 test; consumed in Task 8 response without re-encoding.
- Rust `StoredAccount` field names match what Task 11 writes and reads.
- TS `CreatedAccount.quizPositions` (camelCase) maps from `quiz_positions` (snake_case) in Task 12 implementation — consistent with other services in the codebase.

**Assumptions flagged for executor:**
- `goamp-node` already exposes localhost HTTP on `127.0.0.1:7472` — confirmed from commit 71ace0f. If port is configurable, Task 11 should read it from settings instead of hardcoding.
- `reqwest` blocking client: Tauri already uses tokio; blocking inside a Tauri command is acceptable for short (<10 s) requests but if the codebase avoids it, rewrite Task 11 with `#[tauri::command] async fn` and `reqwest::Client` async. Either way, scope is identical.
- `keyring` mock module name (`keyring::mock::default_credential_builder`) was stable across v2/v3 but verify against the pulled-in version; adjust Task 10 test or skip as noted.
