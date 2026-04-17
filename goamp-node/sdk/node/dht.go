package node

import (
	"context"
	"time"

	"github.com/ipfs/go-cid"
	dht "github.com/libp2p/go-libp2p-kad-dht"
	"github.com/libp2p/go-libp2p/core/peer"
	mh "github.com/multiformats/go-multihash"
)

func (n *P2PNode) initDHT(ctx context.Context) error {
	var err error
	n.kadDHT, err = dht.New(ctx, n.host, dht.Mode(dht.ModeServer))
	if err != nil {
		return err
	}
	// Bootstrap starts the background routing table refresh.
	// Errors here are non-fatal when no bootstrap peers are configured.
	_ = n.kadDHT.Bootstrap(ctx)

	for _, p := range n.cfg.Bootstrap {
		_ = n.host.Connect(ctx, p)
	}
	return nil
}

// trackCID converts a trackID string to a CID using SHA-256.
func trackCID(trackID string) (cid.Cid, error) {
	h, err := mh.Sum([]byte(trackID), mh.SHA2_256, -1)
	if err != nil {
		return cid.Undef, err
	}
	return cid.NewCidV1(cid.Raw, h), nil
}

// Announce publishes the node as a provider for trackID in the DHT.
func (n *P2PNode) Announce(ctx context.Context, trackID string) error {
	c, err := trackCID(trackID)
	if err != nil {
		return err
	}
	// broadcast=false stores the record locally; peers query it via GET_PROVIDERS.
	// This avoids "no peers in table" errors on single-node or freshly-started nodes.
	return n.kadDHT.Provide(ctx, c, false)
}

// FindProviders looks up providers for trackID in the DHT.
// Returns an empty slice (not an error) when no providers are found.
func (n *P2PNode) FindProviders(ctx context.Context, trackID string) ([]peer.ID, error) {
	c, err := trackCID(trackID)
	if err != nil {
		return nil, err
	}
	tctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	ch := n.kadDHT.FindProvidersAsync(tctx, c, 20)
	var providers []peer.ID
	for info := range ch {
		providers = append(providers, info.ID)
	}
	return providers, nil
}
