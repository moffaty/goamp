package account

import (
	"crypto/hkdf"
	"crypto/sha256"
	"fmt"
)

// StateKeyV1 is the current HKDF `info` tag for state-blob encryption keys.
// Bumped by paranoid-mode revoke (spec §5.4).
const StateKeyV1 = "goamp-state-v1"

const stateKeySalt = "goamp-v1"

// DeriveStateKey returns the 32-byte ChaCha20-Poly1305 key used to encrypt
// the per-account state blob. state_key = HKDF-SHA256(ikm=BIP39_seed,
// salt="goamp-v1", info=version).
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
