package account

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/binary"
	"fmt"
)

// subKeySigDomain is the signing domain-separation prefix for sub-key
// attestations (spec §5.2).
const subKeySigDomain = "goamp-device-v1"

// SubKey is a device-local ed25519 keypair signed by the account master.
// Persisted in OS keychain on the owning device; used for day-to-day
// signing (relay requests, remote commands, pubsub encryption-key seed).
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

// subKeyMessage returns the canonical bytes that a master signs when
// attesting a sub-key: domain || deviceID || subPub || createdAt (big-endian).
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

// SignSubKey produces the master's attestation. Callers should defer master.Wipe().
func SignSubKey(master *MasterKey, subPub ed25519.PublicKey, deviceID string, createdAt int64) ([]byte, error) {
	if master == nil {
		return nil, fmt.Errorf("nil master")
	}
	msg := subKeyMessage(subPub, deviceID, createdAt)
	return ed25519.Sign(master.PrivateKey, msg), nil
}

// VerifySubKey checks sig validity. Returns nil on success.
func VerifySubKey(masterPub, subPub ed25519.PublicKey, deviceID string, createdAt int64, sig []byte) error {
	msg := subKeyMessage(subPub, deviceID, createdAt)
	if !ed25519.Verify(masterPub, msg, sig) {
		return fmt.Errorf("sub-key signature invalid")
	}
	return nil
}
