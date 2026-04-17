package node

import (
	"context"
	"sync"

	"github.com/goamp/sdk/sdk"
	dht "github.com/libp2p/go-libp2p-kad-dht"
	pubsub "github.com/libp2p/go-libp2p-pubsub"
	"github.com/libp2p/go-libp2p"
	"github.com/libp2p/go-libp2p/core/host"
	"github.com/libp2p/go-libp2p/core/network"
	"github.com/libp2p/go-libp2p/core/peer"
	libp2pprotocol "github.com/libp2p/go-libp2p/core/protocol"
	"github.com/libp2p/go-libp2p/p2p/discovery/mdns"
)

// P2PNode is the Plan 2 libp2p-backed node implementation.
type P2PNode struct {
	cfg      Config
	host     host.Host
	kadDHT   *dht.IpfsDHT
	ps       *pubsub.PubSub
	topic    *pubsub.Topic
	sub      *pubsub.Subscription
	cancel   context.CancelFunc
	stopOnce sync.Once
}

// New creates a P2PNode. Call Start to connect to the network.
func New(ctx context.Context, cfg Config) (*P2PNode, error) {
	if cfg.ListenAddr == "" {
		cfg.ListenAddr = "/ip4/0.0.0.0/tcp/0"
	}
	opts := []libp2p.Option{libp2p.ListenAddrStrings(cfg.ListenAddr)}
	if cfg.PrivKey != nil {
		opts = append(opts, libp2p.Identity(cfg.PrivKey))
	}
	h, err := libp2p.New(opts...)
	if err != nil {
		return nil, err
	}
	return &P2PNode{cfg: cfg, host: h}, nil
}

// Start initialises mDNS discovery, DHT, GossipSub, and the catalog protocol.
func (n *P2PNode) Start(ctx context.Context) error {
	ctx, cancel := context.WithCancel(ctx)
	n.cancel = cancel

	// mDNS for local peer discovery.
	svc := mdns.NewMdnsService(n.host, "goamp._tcp", &mdnsNotifee{h: n.host})
	if err := svc.Start(); err != nil {
		cancel()
		return err
	}

	// Kademlia DHT.
	if err := n.initDHT(ctx); err != nil {
		cancel()
		return err
	}

	// GossipSub.
	if err := n.initPubSub(ctx); err != nil {
		cancel()
		return err
	}

	// Catalog stream protocol (only if a catalog is provided).
	if n.cfg.Catalog != nil {
		n.registerCatalogProtocol()
	}

	// Emit peer lifecycle events.
	n.host.Network().Notify(&network.NotifyBundle{
		ConnectedF: func(_ network.Network, _ network.Conn) {
			n.Emit(sdk.Event{Type: sdk.EventPeerConnected})
		},
		DisconnectedF: func(_ network.Network, _ network.Conn) {
			n.Emit(sdk.Event{Type: sdk.EventPeerDisconnected})
		},
	})

	return nil
}

// Stop shuts down the node. Safe to call multiple times.
func (n *P2PNode) Stop() (err error) {
	n.stopOnce.Do(func() {
		if n.cancel != nil {
			n.cancel()
		}
		if n.sub != nil {
			n.sub.Cancel()
		}
		if n.topic != nil {
			_ = n.topic.Close()
		}
		if n.kadDHT != nil {
			if e := n.kadDHT.Close(); e != nil {
				err = e
			}
		}
		if e := n.host.Close(); e != nil && err == nil {
			err = e
		}
	})
	return
}

func (n *P2PNode) ID() peer.ID { return n.host.ID() }

func (n *P2PNode) Peers() []peer.AddrInfo {
	conns := n.host.Network().Conns()
	out := make([]peer.AddrInfo, 0, len(conns))
	seen := make(map[peer.ID]struct{}, len(conns))
	for _, c := range conns {
		id := c.RemotePeer()
		if _, dup := seen[id]; dup {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, peer.AddrInfo{ID: id})
	}
	return out
}

// AddrInfo returns the node's peer ID and listen addresses.
func (n *P2PNode) AddrInfo() peer.AddrInfo {
	return peer.AddrInfo{ID: n.host.ID(), Addrs: n.host.Addrs()}
}

// Connect dials a peer directly. Used in tests to bypass mDNS discovery.
func (n *P2PNode) Connect(ctx context.Context, p peer.AddrInfo) error {
	return n.host.Connect(ctx, p)
}

// TopicPeers returns the peer IDs currently in the GossipSub mesh for topicName.
// Used in tests to wait for mesh formation before publishing.
func (n *P2PNode) TopicPeers(topicName string) []peer.ID {
	if n.ps == nil {
		return nil
	}
	return n.ps.ListPeers(topicName)
}

func (n *P2PNode) RegisterProtocol(p sdk.Protocol) {
	n.host.SetStreamHandler(libp2pprotocol.ID(p.ID()), p.Handle)
}

func (n *P2PNode) Emit(event sdk.Event) {
	if n.cfg.EmitFn != nil {
		n.cfg.EmitFn(event)
	}
}

// mdnsNotifee connects to peers discovered via mDNS.
type mdnsNotifee struct{ h host.Host }

func (m *mdnsNotifee) HandlePeerFound(p peer.AddrInfo) {
	_ = m.h.Connect(context.Background(), p)
}
