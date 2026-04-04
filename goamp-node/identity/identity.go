// Package identity manages the node's ed25519 keypair.
// The machine key is the libp2p peerID — generated once, persisted forever.
package identity

import (
	"crypto/rand"
	"os"
	"path/filepath"

	"github.com/libp2p/go-libp2p/core/crypto"
	"github.com/libp2p/go-libp2p/core/peer"
)

// LoadOrGenerate loads the ed25519 private key from path.
// If path does not exist, generates a new keypair and saves it to path
// with 0600 permissions.
// TODO(you): implement using crypto.GenerateEd25519Key, crypto.MarshalPrivateKey,
// crypto.UnmarshalPrivateKey. See plan for exact API calls.
func LoadOrGenerate(path string) (crypto.PrivKey, error) {
	if data, err := os.ReadFile(path); err == nil {
		return crypto.UnmarshalPrivateKey(data)
	}
	priv, _, err := crypto.GenerateEd25519Key(rand.Reader)
	if err != nil {
		return nil, err
	}
	b, err := crypto.MarshalPrivateKey(priv)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, err
	}
	// TODO(you): write with 0600 permissions
	if err := os.WriteFile(path, b, 0600); err != nil {
		return nil, err
	}
	return priv, nil
}

// PeerID derives the libp2p peer.ID from a private key.
func PeerID(priv crypto.PrivKey) (peer.ID, error) {
	return peer.IDFromPrivateKey(priv)
}
