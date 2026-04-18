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

func TestGetPeerProfiles(t *testing.T) {
	a := newAgg(t)
	ctx := context.Background()

	p1 := &proto.TasteProfile{Version: 1, LikedHashes: []string{"h1"}, TotalListens: 10}
	p2 := &proto.TasteProfile{Version: 1, LikedHashes: []string{"h2"}, TotalListens: 20}
	require.NoError(t, a.Submit(ctx, p1))
	require.NoError(t, a.Submit(ctx, p2))

	rows, err := a.GetPeerProfiles(ctx, 10)
	require.NoError(t, err)
	assert.Len(t, rows, 2)
	assert.NotEmpty(t, rows[0].Hash)
	assert.NotEmpty(t, rows[0].Data)
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
