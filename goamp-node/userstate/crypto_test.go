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
