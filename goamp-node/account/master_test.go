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
