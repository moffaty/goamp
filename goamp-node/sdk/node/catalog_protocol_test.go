package node_test

import (
	"context"
	"testing"

	"github.com/goamp/sdk/proto"
	"github.com/goamp/sdk/sdk"
	"github.com/goamp/sdk/sdk/node"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// mockCatalog returns a fixed set of tracks for any query.
type mockCatalog struct {
	tracks []*proto.Track
}

func (m *mockCatalog) Index(_ context.Context, _ *proto.Track) error { return nil }
func (m *mockCatalog) Search(_ context.Context, _ sdk.Query) ([]*proto.Track, error) {
	return m.tracks, nil
}
func (m *mockCatalog) Announce(_ context.Context, _ string) error { return nil }
func (m *mockCatalog) FindProviders(_ context.Context, _ string) ([]peer.ID, error) {
	return nil, nil
}

func TestCatalogProtocolSearch(t *testing.T) {
	cat := &mockCatalog{tracks: []*proto.Track{
		{Id: "t1", Artist: "Aphex Twin", Title: "Xtal", Genre: "electronic"},
	}}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Node A serves the catalog protocol.
	server, err := node.New(ctx, node.Config{
		ListenAddr: "/ip4/127.0.0.1/tcp/0",
		Catalog:    cat,
	})
	require.NoError(t, err)
	require.NoError(t, server.Start(ctx))
	defer server.Stop()

	// Node B queries it.
	client := newTestNode(t)

	connectNodes(t, client, server)

	results, err := client.RemoteSearch(ctx, server.ID(), sdk.Query{Q: "aphex", Limit: 10})
	require.NoError(t, err)
	require.Len(t, results, 1)
	assert.Equal(t, "t1", results[0].Id)
	assert.Equal(t, "Aphex Twin", results[0].Artist)
}

func TestCatalogProtocolEmptyQuery(t *testing.T) {
	cat := &mockCatalog{tracks: nil}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	server, err := node.New(ctx, node.Config{
		ListenAddr: "/ip4/127.0.0.1/tcp/0",
		Catalog:    cat,
	})
	require.NoError(t, err)
	require.NoError(t, server.Start(ctx))
	defer server.Stop()

	client := newTestNode(t)

	connectNodes(t, client, server)

	results, err := client.RemoteSearch(ctx, server.ID(), sdk.Query{Q: "", Limit: 10})
	require.NoError(t, err)
	assert.Empty(t, results)
}
