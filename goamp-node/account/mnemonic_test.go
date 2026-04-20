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
	seed2, _ := m.Seed()
	if string(seed) != string(seed2) {
		t.Fatal("seed is not deterministic")
	}
}

func TestMnemonicValidateRejectsTypo(t *testing.T) {
	good := Mnemonic("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about")
	if err := good.Validate(); err != nil {
		t.Fatalf("expected valid, got %v", err)
	}
	bad := Mnemonic("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon zzzzzz")
	if err := bad.Validate(); err == nil {
		t.Fatal("expected error for invalid mnemonic")
	}
}
