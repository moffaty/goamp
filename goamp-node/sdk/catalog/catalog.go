// Package catalog implements the Catalog interface backed by a local SQLite store.
package catalog

import (
	"context"

	"github.com/goamp/sdk/proto"
	"github.com/goamp/sdk/sdk"
	"github.com/goamp/sdk/store"
	"github.com/libp2p/go-libp2p/core/peer"
)

// SQLCatalog is the SQLite-backed Catalog implementation.
type SQLCatalog struct {
	store  store.Store
	peerID string // this node's peerID string, used for local Announce
}

// New creates a SQLCatalog backed by the provided store.
// peerID is this node's peer.ID string — used to record local provider announcements.
// TODO(you): this constructor is complete; implement the methods below.
func New(s store.Store, peerID string) *SQLCatalog {
	return &SQLCatalog{store: s, peerID: peerID}
}

// Index upserts a track into the local catalog.
// TODO(you): call s.store.IndexTrack(ctx, track)
func (c *SQLCatalog) Index(ctx context.Context, track *proto.Track) error {
	return c.store.IndexTrack(ctx, track)
}

// Search returns tracks matching the query from the local catalog.
// TODO(you): call s.store.SearchTracks(ctx, q.Q, q.Genres, q.Limit)
func (c *SQLCatalog) Search(ctx context.Context, q sdk.Query) ([]*proto.Track, error) {
	return c.store.SearchTracks(ctx, q.Q, q.Genres, q.Limit)
}

// Announce records that this node has the track available.
// In Plan 1 this only updates the local store. In Plan 2 it also publishes to the DHT.
// TODO(you): call s.store.AnnounceProvider(ctx, trackID, c.peerID)
func (c *SQLCatalog) Announce(ctx context.Context, trackID string) error {
	return c.store.AnnounceProvider(ctx, trackID, c.peerID)
}

// FindProviders returns all known peerIDs that have announced the track.
// In Plan 1 this only queries the local store.
// TODO(you): call s.store.FindProviders, convert strings to peer.IDs
func (c *SQLCatalog) FindProviders(ctx context.Context, trackID string) ([]peer.ID, error) {
	ids, err := c.store.FindProviders(ctx, trackID)
	if err != nil {
		return nil, err
	}
	var pids []peer.ID
	for _, id := range ids {
		pid, err := peer.Decode(id)
		if err != nil {
			continue // skip malformed IDs
		}
		pids = append(pids, pid)
	}
	return pids, nil
}
