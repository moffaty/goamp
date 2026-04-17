package node_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/goamp/sdk/api"
	"github.com/goamp/sdk/proto"
	"github.com/goamp/sdk/sdk"
	"github.com/goamp/sdk/sdk/catalog"
	"github.com/goamp/sdk/sdk/node"
	"github.com/goamp/sdk/sdk/profiles"
	"github.com/goamp/sdk/store"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// newFullNode wires a P2PNode with a real SQLite catalog and profile aggregator.
func newFullNode(t *testing.T) (*node.P2PNode, sdk.Catalog, sdk.ProfileAggregator) {
	t.Helper()

	s, err := store.Open(":memory:")
	require.NoError(t, err)
	t.Cleanup(func() { s.Close() })

	cat := catalog.New(s, "local")
	agg := profiles.New(s)

	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)

	n, err := node.New(ctx, node.Config{
		ListenAddr: "/ip4/127.0.0.1/tcp/0",
		Catalog:    cat,
		Profiles:   agg,
	})
	require.NoError(t, err)
	require.NoError(t, n.Start(ctx))
	t.Cleanup(func() { _ = n.Stop() })

	return n, cat, agg
}

// TestIntegrationAnnounceAndFind verifies the full announce → find flow across two real nodes.
func TestIntegrationAnnounceAndFind(t *testing.T) {
	a, catA, _ := newFullNode(t)
	b, _, _ := newFullNode(t)

	ctx := context.Background()
	const trackID = "massive-attack-teardrop"

	require.NoError(t, catA.Index(ctx, &proto.Track{
		Id: trackID, Artist: "Massive Attack", Title: "Teardrop", PeerCount: 1,
	}))
	require.NoError(t, a.Announce(ctx, trackID))

	connectNodes(t, a, b)

	require.Eventually(t, func() bool {
		providers, err := b.FindProviders(ctx, trackID)
		return err == nil && len(providers) > 0
	}, 5*time.Second, 200*time.Millisecond, "B must find A as provider for the track")
}

// TestIntegrationProfileSync verifies profile publish → receive → store flow.
func TestIntegrationProfileSync(t *testing.T) {
	stored := make(chan sdk.PeerProfile, 1)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	a := newTestNode(t)

	s, err := store.Open(":memory:")
	require.NoError(t, err)
	defer s.Close()

	agg := &mockProfiles{stored: stored}

	b, err := node.New(ctx, node.Config{
		ListenAddr: "/ip4/127.0.0.1/tcp/0",
		Profiles:   agg,
	})
	require.NoError(t, err)
	require.NoError(t, b.Start(ctx))
	defer b.Stop()

	connectNodes(t, a, b)
	waitForGossipMesh(t, a, b)

	profile := &proto.TasteProfile{Version: 1, LikedHashes: []string{"h1", "h2"}, TotalListens: 99}

	var got sdk.PeerProfile
	require.Eventually(t, func() bool {
		_ = a.PublishProfile(ctx, profile)
		select {
		case got = <-stored:
			return true
		case <-time.After(300 * time.Millisecond):
			return false
		}
	}, 10*time.Second, 350*time.Millisecond, "profile not received")

	assert.NotEmpty(t, got.Hash)
	assert.Equal(t, uint32(99), got.Profile.TotalListens)
}

// TestIntegrationHealthPeerCount checks that /health reflects a connected peer.
func TestIntegrationHealthPeerCount(t *testing.T) {
	n, cat, agg := newFullNode(t)

	// Wire a second node to create a real peer connection.
	_ = newTestNode(t)

	srv := api.New(n, cat, agg, nil)
	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()

	require.Eventually(t, func() bool {
		resp, err := http.Get(ts.URL + "/health")
		if err != nil {
			return false
		}
		defer resp.Body.Close()
		var body struct {
			PeerCount int `json:"peer_count"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
			return false
		}
		return body.PeerCount >= 1
	}, 5*time.Second, 200*time.Millisecond, "/health must report peer_count >= 1")
}
