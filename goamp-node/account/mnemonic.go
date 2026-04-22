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

// Validate returns an error if m is not a syntactically valid BIP39 mnemonic.
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
