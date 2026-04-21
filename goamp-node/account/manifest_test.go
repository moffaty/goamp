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

	other, _ := NewSubKey()
	mf.Devices = append(mf.Devices, DeviceEntry{
		SubPub:    hex.EncodeToString(other.PublicKey),
		Name:      "Phone",
		OS:        "ios",
		AddedAt:   now,
		MasterSig: b64([]byte("not a real signature of the right length--------------------------------")),
	})
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
