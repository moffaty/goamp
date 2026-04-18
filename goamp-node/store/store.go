// Package store defines the persistence interface for the GOAMP node database.
// The SQLite implementation lives in sqlite.go.
package store

import (
	"context"

	"github.com/goamp/sdk/proto"
)

// Peer is the in-memory representation of a known peer.
type Peer struct {
	PeerID      string
	Addrs       []string // multiaddrs as strings
	NodeVersion string
	Protocols   []string
	LastSeen    int64
	Reputation  int
}

// Recommendation is a cached recommendation from the aggregation engine.
type Recommendation struct {
	TrackID  string
	Score    float64
	Source   string
	CachedAt int64
}

// PeerProfileRow is a taste profile received from a remote peer.
type PeerProfileRow struct {
	Hash       string
	Data       []byte
	ReceivedAt int64
}

// Store is the persistence layer for the GOAMP node.
// Implemented by SQLiteStore in sqlite.go.
type Store interface {
	// Track catalog
	IndexTrack(ctx context.Context, t *proto.Track) error
	SearchTracks(ctx context.Context, q string, genres []string, limit int) ([]*proto.Track, error)

	// Provider registry
	AnnounceProvider(ctx context.Context, trackID, peerID string) error
	FindProviders(ctx context.Context, trackID string) ([]string, error)

	// Peer book
	UpsertPeer(ctx context.Context, p Peer) error
	ListPeers(ctx context.Context) ([]Peer, error)

	// Profiles
	StorePeerProfile(ctx context.Context, hash string, data []byte) error
	GetPeerProfiles(ctx context.Context, limit int) ([]PeerProfileRow, error)

	// Recommendations cache
	CacheRecommendation(ctx context.Context, trackID string, score float64, source string) error
	GetRecommendations(ctx context.Context, limit int) ([]Recommendation, error)

	Close() error
}
