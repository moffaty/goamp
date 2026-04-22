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
