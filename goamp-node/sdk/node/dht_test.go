package node_test

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestDHTAnnounceAndFind(t *testing.T) {
	a := newTestNode(t)
	b := newTestNode(t)

	connectNodes(t, a, b)

	ctx := context.Background()
	const trackID = "boc-dayvan-cowboy"

	require.NoError(t, a.Announce(ctx, trackID))

	var found bool
	require.Eventually(t, func() bool {
		providers, err := b.FindProviders(ctx, trackID)
		if err != nil || len(providers) == 0 {
			return false
		}
		for _, p := range providers {
			if p == a.ID() {
				found = true
				return true
			}
		}
		return false
	}, 5*time.Second, 200*time.Millisecond, "node B must find node A as provider via DHT")

	assert.True(t, found)
}

func TestDHTFindUnknownTrack(t *testing.T) {
	n := newTestNode(t)
	ctx := context.Background()

	providers, err := n.FindProviders(ctx, "unknown-track-id")
	require.NoError(t, err)
	assert.Empty(t, providers, "unknown track must return empty providers, not an error")
}

func TestDHTAnnounceIdempotent(t *testing.T) {
	n := newTestNode(t)
	ctx := context.Background()

	require.NoError(t, n.Announce(ctx, "track-abc"))
	require.NoError(t, n.Announce(ctx, "track-abc"), "second Announce must not error")
}
