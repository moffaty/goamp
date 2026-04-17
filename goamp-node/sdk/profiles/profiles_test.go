package profiles_test

import (
	"context"
	"testing"
	"time"

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

func TestMoodCentroidsInProfile(t *testing.T) {
	profile := &proto.TasteProfile{
		MoodCentroids: map[string]*proto.MoodCentroid{
			"calm": {
				Vec:        []float32{0.1, 0.2, 0.3},
				TrackCount: 55,
				UpdatedAt:  time.Now().Unix(),
			},
		},
	}
	require.NotNil(t, profile.MoodCentroids["calm"])
	require.Equal(t, int32(55), profile.MoodCentroids["calm"].TrackCount)
	require.Equal(t, 3, len(profile.MoodCentroids["calm"].Vec))
}
