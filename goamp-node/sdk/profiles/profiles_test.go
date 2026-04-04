package profiles_test

import (
	"context"
	"testing"

	"github.com/goamp/sdk/proto"
	"github.com/goamp/sdk/sdk/profiles"
	"github.com/goamp/sdk/store"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newAgg(t *testing.T) *profiles.SQLProfileAggregator {
	t.Helper()
	s, err := store.Open(":memory:")
	require.NoError(t, err)
	t.Cleanup(func() { s.Close() })
	return profiles.New(s)
}

func TestSubmitProfile(t *testing.T) {
	a := newAgg(t)
	ctx := context.Background()
	profile := &proto.TasteProfile{
		Version:     1,
		LikedHashes: []string{"hash1", "hash2"},
		TotalListens: 42,
	}
	err := a.Submit(ctx, profile)
	require.NoError(t, err)
}

func TestGetRecommendationsEmpty(t *testing.T) {
	a := newAgg(t)
	recs, err := a.GetRecommendations(context.Background(), nil)
	require.NoError(t, err)
	assert.Empty(t, recs) // no recommendations cached yet
}
