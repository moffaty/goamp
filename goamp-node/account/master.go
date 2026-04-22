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

// MasterFromMnemonic derives the ed25519 master keypair deterministically
// from a BIP39 mnemonic. The first 32 bytes of the BIP39 seed (RFC 8032
// ed25519 seed size) become the ed25519 seed.
func MasterFromMnemonic(m Mnemonic) (*MasterKey, error) {
	seed, err := m.Seed()
	if err != nil {
		return nil, fmt.Errorf("mnemonic: %w", err)
	}
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

// Wipe zeroes the private key bytes. Safe on nil receiver. Callers must
// defer k.Wipe() immediately after obtaining a MasterKey.
func (k *MasterKey) Wipe() {
	if k == nil {
		return
	}
	for i := range k.PrivateKey {
		k.PrivateKey[i] = 0
	}
}
