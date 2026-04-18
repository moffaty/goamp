package node_test

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/goamp/sdk/proto"
	"github.com/goamp/sdk/sdk"
	"github.com/goamp/sdk/sdk/node"
	"github.com/goamp/sdk/store"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// mockProfiles is a simple in-memory ProfileAggregator for tests.
type mockProfiles struct {
	stored chan sdk.PeerProfile
}

func (m *mockProfiles) Submit(_ context.Context, _ *proto.TasteProfile) error { return nil }
func (m *mockProfiles) GetRecommendations(_ context.Context, _ []string) ([]sdk.Recommendation, error) {
	return nil, nil
}
func (m *mockProfiles) GetPeerProfiles(_ context.Context, _ int) ([]store.PeerProfileRow, error) {
	return nil, nil
}
func (m *mockProfiles) StorePeer(_ context.Context, p sdk.PeerProfile) error {
	m.stored <- p
	return nil
}

// waitForGossipMesh waits until a and b are in each other's GossipSub mesh.
// Both directions must be ready before publishing is reliable.
func waitForGossipMesh(t *testing.T, a, b *node.P2PNode) {
	t.Helper()
	hasPeer := func(src, dst *node.P2PNode) bool {
		for _, id := range src.TopicPeers(node.TopicProfiles) {
			if id == dst.ID() {
				return true
			}
		}
		return false
	}
	require.Eventually(t, func() bool {
		return hasPeer(a, b) && hasPeer(b, a)
	}, 5*time.Second, 100*time.Millisecond, "GossipSub mesh must form in both directions")
}

func TestGossipSubProfileReceived(t *testing.T) {
	agg := &mockProfiles{stored: make(chan sdk.PeerProfile, 10)}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	a := newTestNode(t)
	b, err := node.New(ctx, node.Config{
		ListenAddr: "/ip4/127.0.0.1/tcp/0",
		Profiles:   agg,
	})
	require.NoError(t, err)
	require.NoError(t, b.Start(ctx))
	defer b.Stop()

	connectNodes(t, a, b)
	waitForGossipMesh(t, a, b)

	profile := &proto.TasteProfile{
		Version:      1,
		LikedHashes:  []string{"hash1", "hash2"},
		TotalListens: 10,
	}

	// Retry publish until B receives it — GossipSub may drop the first message
	// immediately after mesh formation.
	var got sdk.PeerProfile
	require.Eventually(t, func() bool {
		_ = a.PublishProfile(ctx, profile)
		select {
		case got = <-agg.stored:
			return true
		case <-time.After(300 * time.Millisecond):
			return false
		}
	}, 10*time.Second, 350*time.Millisecond, "node B did not receive published profile")

	assert.NotEmpty(t, got.Hash, "stored profile must have a hash")
	assert.Equal(t, profile.TotalListens, got.Profile.TotalListens)
}

func TestGossipSubMalformedMessageDropped(t *testing.T) {
	// Node receives garbage bytes on the profile topic — must not panic.
	events := make(chan sdk.Event, 10)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	n, err := node.New(ctx, node.Config{
		ListenAddr: "/ip4/127.0.0.1/tcp/0",
		EmitFn:     func(e sdk.Event) { events <- e },
	})
	require.NoError(t, err)
	require.NoError(t, n.Start(ctx))
	defer n.Stop()

	require.NoError(t, n.PublishRaw(ctx, node.TopicProfiles, []byte("not-protobuf!!!")))

	// No profile:synced event should arrive for a malformed message.
	time.Sleep(300 * time.Millisecond)
	for {
		select {
		case e := <-events:
			assert.NotEqual(t, sdk.EventProfileSynced, e.Type, "malformed message must not emit profile:synced")
		default:
			return
		}
	}
}

func TestGossipSubEmitsProfileSynced(t *testing.T) {
	agg := &mockProfiles{stored: make(chan sdk.PeerProfile, 1)}
	// Buffer large enough to absorb peer:connected and other lifecycle events.
	synced := make(chan sdk.Event, 16)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	a := newTestNode(t)
	b, err := node.New(ctx, node.Config{
		ListenAddr: "/ip4/127.0.0.1/tcp/0",
		Profiles:   agg,
		EmitFn:     func(e sdk.Event) { synced <- e },
	})
	require.NoError(t, err)
	require.NoError(t, b.Start(ctx))
	defer b.Stop()

	connectNodes(t, a, b)
	waitForGossipMesh(t, a, b)

	profile := &proto.TasteProfile{Version: 1, TotalListens: 5}
	require.NoError(t, a.PublishProfile(ctx, profile))

	// Drain the channel looking for profile:synced — ignore lifecycle events.
	var gotEvent sdk.Event
	require.Eventually(t, func() bool {
		select {
		case e := <-synced:
			if e.Type == sdk.EventProfileSynced {
				gotEvent = e
				return true
			}
		default:
		}
		return false
	}, 5*time.Second, 50*time.Millisecond, "profile:synced event not emitted")

	var payload struct {
		Hash      string `json:"hash"`
		PeerCount int    `json:"peer_count"`
	}
	require.NoError(t, json.Unmarshal(gotEvent.Payload, &payload))
	assert.NotEmpty(t, payload.Hash)
	assert.GreaterOrEqual(t, payload.PeerCount, 0, "peer_count must be present")
}
