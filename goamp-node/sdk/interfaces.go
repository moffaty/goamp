// Package sdk defines the core interfaces of the GOAMP P2P node.
// Every module is expressed as an interface — this enables mocking in tests
// and swapping implementations (e.g. SQLite vs DHT-backed catalog).
package sdk

import (
	"context"
	"encoding/json"

	"github.com/goamp/sdk/proto"
	"github.com/libp2p/go-libp2p/core/network"
	"github.com/libp2p/go-libp2p/core/peer"
	libp2pprotocol "github.com/libp2p/go-libp2p/core/protocol"
)

// ─── Node ────────────────────────────────────────────────────────────────────

// Node is the top-level runtime: manages the libp2p host, registers protocols,
// and emits events to connected WebSocket clients.
type Node interface {
	Start(ctx context.Context) error
	Stop() error
	ID() peer.ID
	Peers() []peer.AddrInfo
	RegisterProtocol(p Protocol)
	Emit(event Event)
}

// Protocol is a libp2p stream handler with an ID.
// Implement this to add a new P2P protocol to the node.
type Protocol interface {
	ID() libp2pprotocol.ID // e.g. "/goamp/myplugin/1.0"
	Handle(stream network.Stream)
}

// ─── Catalog ─────────────────────────────────────────────────────────────────

// Query is the input to a catalog search.
type Query struct {
	Q      string
	Genres []string
	Limit  int
}

// Catalog indexes track metadata and exposes search + provider lookup.
type Catalog interface {
	Index(ctx context.Context, track *proto.Track) error
	Search(ctx context.Context, q Query) ([]*proto.Track, error)
	Announce(ctx context.Context, trackID string) error
	FindProviders(ctx context.Context, trackID string) ([]peer.ID, error)
}

// ─── Profiles ────────────────────────────────────────────────────────────────

// Recommendation is a single recommended track with a confidence score.
type Recommendation struct {
	TrackID string  `json:"track_id"`
	Score   float64 `json:"score"`
	Source  string  `json:"source"`
}

// PeerProfile is a taste profile received from a remote peer.
type PeerProfile struct {
	Hash    string
	Profile *proto.TasteProfile
}

// ProfileAggregator collects taste profiles from the network and produces
// personalised recommendations.
type ProfileAggregator interface {
	Submit(ctx context.Context, profile *proto.TasteProfile) error
	GetRecommendations(ctx context.Context, likes []string) ([]Recommendation, error)
	StorePeer(ctx context.Context, p PeerProfile) error
}

// ─── Archive ─────────────────────────────────────────────────────────────────

// StorageQuota describes how much archive space is allocated and used.
type StorageQuota struct {
	TotalBytes int64
	UsedBytes  int64
}

// Archive stores and retrieves raw track audio fragments.
type Archive interface {
	Store(ctx context.Context, trackID string, data []byte) error
	Retrieve(ctx context.Context, trackID string) ([]byte, error)
	Quota() StorageQuota
}

// ─── SearchProvider ──────────────────────────────────────────────────────────

// SearchProvider is implemented by plugins that contribute search results
// from external sources (e.g. YouTube, SoundCloud, a VK plugin).
type SearchProvider interface {
	ID() string
	Search(ctx context.Context, q string) ([]*proto.Track, error)
	StreamURL(ctx context.Context, trackID string) (string, error)
}

// ─── Events ──────────────────────────────────────────────────────────────────

const (
	EventPeerConnected    = "peer:connected"
	EventPeerDisconnected = "peer:disconnected"
	EventTrackFound       = "track:found"
	EventTrackAnnounced   = "track:announced"
	EventProfileSynced    = "profile:synced"
	EventRecommendations  = "recommendations:updated"
)

// Event is a JSON-serialisable push notification sent to WebSocket clients.
type Event struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
}
