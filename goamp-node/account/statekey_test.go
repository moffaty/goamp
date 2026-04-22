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
