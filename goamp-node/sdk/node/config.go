package node

import (
	"github.com/goamp/sdk/sdk"
	"github.com/libp2p/go-libp2p/core/crypto"
	"github.com/libp2p/go-libp2p/core/peer"
)

// Config holds all construction options for a P2PNode.
type Config struct {
	// PrivKey is the node's persistent identity key.
	// If nil, a fresh ephemeral key is generated (useful in tests).
	PrivKey crypto.PrivKey

	// ListenAddr is a multiaddr string, e.g. "/ip4/0.0.0.0/tcp/0".
	// Defaults to "/ip4/0.0.0.0/tcp/0" when empty.
	ListenAddr string

	// Bootstrap peers to connect to on Start (optional).
	Bootstrap []peer.AddrInfo

	// Catalog is used by the catalog stream protocol handler (optional).
	Catalog sdk.Catalog

	// Profiles receives incoming taste profiles published via GossipSub (optional).
	Profiles sdk.ProfileAggregator

	// EmitFn is called for every node event (optional).
	EmitFn func(sdk.Event)
}
