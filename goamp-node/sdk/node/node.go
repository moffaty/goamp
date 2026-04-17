// Package node implements the Node interface.
// In Plan 1 it is a local-only stub (no libp2p).
// In Plan 2, Claude replaces this with the full libp2p-backed implementation.
package node

import (
	"context"
	"sync"

	"github.com/goamp/sdk/sdk"
	"github.com/libp2p/go-libp2p/core/peer"
)

// LocalNode is the Plan 1 stub — no real P2P, just the interface wiring.
// Replace with the full host.go implementation in Plan 2.
type LocalNode struct {
	mu        sync.Mutex
	protocols []sdk.Protocol
	emitFn    func(sdk.Event)
}

// NewStub creates a LocalNode stub (Plan 1 only).
// Use New(ctx, Config) for the real P2P node.
func NewStub(emitFn func(sdk.Event)) *LocalNode {
	return &LocalNode{emitFn: emitFn}
}

func (n *LocalNode) Start(ctx context.Context) error { return nil }
func (n *LocalNode) Stop() error                     { return nil }

func (n *LocalNode) ID() peer.ID {
	// No real peer ID in Plan 1 stub.
	return peer.ID("")
}

func (n *LocalNode) Peers() []peer.AddrInfo {
	return nil
}

func (n *LocalNode) RegisterProtocol(p sdk.Protocol) {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.protocols = append(n.protocols, p)
}

func (n *LocalNode) Emit(event sdk.Event) {
	if n.emitFn != nil {
		n.emitFn(event)
	}
}
