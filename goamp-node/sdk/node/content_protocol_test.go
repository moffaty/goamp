package node_test

import (
	"context"
	"testing"
	"time"

	"github.com/goamp/sdk/sdk"
	"github.com/goamp/sdk/sdk/archive"
	"github.com/goamp/sdk/sdk/node"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// newContentNode starts a node backed by a temp-dir LocalArchive.
func newContentNode(t *testing.T, arch sdk.Archive) *node.P2PNode {
	t.Helper()
	ctx := context.Background()
	n, err := node.New(ctx, node.Config{
		ListenAddr: "/ip4/127.0.0.1/tcp/0",
		Archive:    arch,
	})
	require.NoError(t, err)
	require.NoError(t, n.Start(ctx))
	t.Cleanup(func() { _ = n.Stop() })
	return n
}

// connectWithRetry dials b from a, tolerating the transient libp2p TLS
// simultaneous-open handshake race that can occur when mDNS auto-dials at the
// same time as an explicit Connect.
func connectWithRetry(t *testing.T, a, b *node.P2PNode) {
	t.Helper()
	var err error
	for i := 0; i < 5; i++ {
		if err = a.Connect(context.Background(), b.AddrInfo()); err == nil {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	require.NoError(t, err)
	require.Eventually(t, func() bool { return len(a.Peers()) > 0 },
		2*time.Second, 50*time.Millisecond, "nodes must be connected")
}

// Fetch (hit + miss) share one connected pair to keep the number of concurrent
// libp2p hosts low — the package's E2E tests are load-sensitive.
func TestContentProtocolFetch(t *testing.T) {
	ctx := context.Background()
	data := []byte("some-opus-audio-bytes")
	const id = "canonical-track-1"

	server := newContentNode(t, archive.New(t.TempDir(), 0))
	client := newContentNode(t, archive.New(t.TempDir(), 0))
	connectWithRetry(t, client, server)

	// Provider stores + announces the track.
	require.NoError(t, server.ProvideContent(ctx, id, data))

	// A held track: peer receives exactly the stored bytes.
	got, err := client.FetchContent(ctx, server.ID(), id)
	require.NoError(t, err)
	assert.Equal(t, data, got)

	// An unheld track: no bytes, no error, no corrupt payload.
	miss, err := client.FetchContent(ctx, server.ID(), "not-held")
	require.NoError(t, err)
	assert.Empty(t, miss)
}

func TestGetContentLocalHitSkipsNetwork(t *testing.T) {
	ctx := context.Background()
	data := []byte("local-bytes")
	const id = "local-track"

	n := newContentNode(t, archive.New(t.TempDir(), 0))
	require.NoError(t, n.ProvideContent(ctx, id, data))

	// Held locally → returns immediately without any provider lookup/dial.
	got, err := n.GetContent(ctx, id)
	require.NoError(t, err)
	assert.Equal(t, data, got)
}
