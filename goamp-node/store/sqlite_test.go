package store_test

import (
	"context"
	"testing"

	"github.com/goamp/sdk/proto"
	"github.com/goamp/sdk/store"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func openMemory(t *testing.T) *store.SQLiteStore {
	t.Helper()
	s, err := store.Open(":memory:")
	require.NoError(t, err)
	t.Cleanup(func() { s.Close() })
	return s
}

func TestIndexAndSearch(t *testing.T) {
	s := openMemory(t)
	ctx := context.Background()

	err := s.IndexTrack(ctx, &proto.Track{
		Id: "abc", Artist: "Boards of Canada", Title: "Dayvan Cowboy",
		DurationSecs: 420, Genre: "electronic", PeerCount: 1,
	})
	require.NoError(t, err)

	tracks, err := s.SearchTracks(ctx, "boards", nil, 10)
	require.NoError(t, err)
	assert.Len(t, tracks, 1)
	assert.Equal(t, "abc", tracks[0].Id)
}

func TestSearchGenreFilter(t *testing.T) {
	s := openMemory(t)
	ctx := context.Background()
	require.NoError(t, s.IndexTrack(ctx, &proto.Track{Id: "1", Artist: "A", Title: "T", Genre: "rock", PeerCount: 1}))
	require.NoError(t, s.IndexTrack(ctx, &proto.Track{Id: "2", Artist: "A", Title: "T2", Genre: "electronic", PeerCount: 1}))

	tracks, err := s.SearchTracks(ctx, "a", []string{"rock"}, 10)
	require.NoError(t, err)
	assert.Len(t, tracks, 1)
	assert.Equal(t, "1", tracks[0].Id)
}

func TestProviders(t *testing.T) {
	s := openMemory(t)
	ctx := context.Background()
	require.NoError(t, s.AnnounceProvider(ctx, "track1", "peer-a"))
	require.NoError(t, s.AnnounceProvider(ctx, "track1", "peer-b"))

	providers, err := s.FindProviders(ctx, "track1")
	require.NoError(t, err)
	assert.ElementsMatch(t, []string{"peer-a", "peer-b"}, providers)
}

func TestUpsertPeer(t *testing.T) {
	s := openMemory(t)
	ctx := context.Background()
	p := store.Peer{
		PeerID:      "peer-x",
		Addrs:       []string{"/ip4/127.0.0.1/tcp/4001"},
		NodeVersion: "0.1.0",
		Protocols:   []string{"/goamp/catalog/1.0"},
		LastSeen:    1000,
		Reputation:  5,
	}
	require.NoError(t, s.UpsertPeer(ctx, p))

	peers, err := s.ListPeers(ctx)
	require.NoError(t, err)
	require.Len(t, peers, 1)
	assert.Equal(t, "peer-x", peers[0].PeerID)
	assert.Equal(t, []string{"/ip4/127.0.0.1/tcp/4001"}, peers[0].Addrs)
}

func TestRecommendations(t *testing.T) {
	s := openMemory(t)
	ctx := context.Background()
	require.NoError(t, s.CacheRecommendation(ctx, "track-a", 0.9, "hybrid"))
	require.NoError(t, s.CacheRecommendation(ctx, "track-b", 0.5, "hybrid"))

	recs, err := s.GetRecommendations(ctx, 10)
	require.NoError(t, err)
	require.Len(t, recs, 2)
	assert.Equal(t, "track-a", recs[0].TrackID) // highest score first
}
