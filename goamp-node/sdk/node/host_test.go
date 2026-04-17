package node_test

import (
	"context"
	"testing"
	"time"

	"github.com/goamp/sdk/sdk"
	"github.com/goamp/sdk/sdk/node"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// connectNodes directly connects a→b so tests don't depend on mDNS multicast.
func connectNodes(t *testing.T, a, b *node.P2PNode) {
	t.Helper()
	require.NoError(t, a.Connect(context.Background(), b.AddrInfo()))
	require.Eventually(t, func() bool { return len(a.Peers()) > 0 },
		2*time.Second, 50*time.Millisecond, "nodes must be connected")
}

// newTestNode spins up a P2PNode on a random port with a fresh ephemeral identity.
// It is stopped automatically when the test ends.
func newTestNode(t *testing.T) *node.P2PNode {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)

	n, err := node.New(ctx, node.Config{
		ListenAddr: "/ip4/127.0.0.1/tcp/0",
	})
	require.NoError(t, err)
	require.NoError(t, n.Start(ctx))
	t.Cleanup(func() { _ = n.Stop() })
	return n
}

func TestHostID(t *testing.T) {
	n := newTestNode(t)
	assert.NotEmpty(t, n.ID(), "peer ID must not be empty after start")
}

func TestHostDirectConnect(t *testing.T) {
	a := newTestNode(t)
	b := newTestNode(t)

	connectNodes(t, a, b)

	hasA := func() bool {
		for _, p := range b.Peers() {
			if p.ID == a.ID() {
				return true
			}
		}
		return false
	}
	assert.True(t, hasA(), "node B should have node A as a peer after direct connect")
}

func TestHostStopIdempotent(t *testing.T) {
	n := newTestNode(t)
	assert.NoError(t, n.Stop())
	assert.NoError(t, n.Stop(), "second Stop must not error")
}

func TestHostEmit(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	received := make(chan sdk.Event, 1)
	n, err := node.New(ctx, node.Config{
		ListenAddr: "/ip4/127.0.0.1/tcp/0",
		EmitFn:     func(e sdk.Event) { received <- e },
	})
	require.NoError(t, err)
	require.NoError(t, n.Start(ctx))
	defer n.Stop()

	evt := sdk.Event{Type: sdk.EventTrackAnnounced}
	n.Emit(evt)

	select {
	case got := <-received:
		assert.Equal(t, sdk.EventTrackAnnounced, got.Type)
	case <-time.After(time.Second):
		t.Fatal("Emit did not deliver event")
	}
}
