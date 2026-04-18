// Package profiles implements the ProfileAggregator interface.
package profiles

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"

	"github.com/goamp/sdk/proto"
	"github.com/goamp/sdk/sdk"
	"github.com/goamp/sdk/store"
)

// SQLProfileAggregator is the SQLite-backed ProfileAggregator implementation.
type SQLProfileAggregator struct {
	store store.Store
}

// New creates a SQLProfileAggregator backed by the provided store.
func New(s store.Store) *SQLProfileAggregator {
	return &SQLProfileAggregator{store: s}
}

// Submit stores a TasteProfile received from any source (local user or remote peer).
// The profile is keyed by SHA-256(JSON(profile)).
// TODO(you): marshal profile to JSON, compute hash, call store.StorePeerProfile.
func (p *SQLProfileAggregator) Submit(ctx context.Context, profile *proto.TasteProfile) error {
	data, err := json.Marshal(profile)
	if err != nil {
		return fmt.Errorf("marshal profile: %w", err)
	}
	hash := fmt.Sprintf("%x", sha256.Sum256(data))
	return p.store.StorePeerProfile(ctx, hash, data)
}

// GetRecommendations returns cached recommendations.
// In Plan 1 this just reads the recommendation cache.
// In Plan 2 it will also consider the provided likes when scoring.
// TODO(you): call store.GetRecommendations, convert to sdk.Recommendation slice.
func (p *SQLProfileAggregator) GetRecommendations(ctx context.Context, likes []string) ([]sdk.Recommendation, error) {
	recs, err := p.store.GetRecommendations(ctx, 20)
	if err != nil {
		return nil, err
	}
	result := make([]sdk.Recommendation, len(recs))
	for i, r := range recs {
		result[i] = sdk.Recommendation{
			TrackID: r.TrackID,
			Score:   r.Score,
			Source:  r.Source,
		}
	}
	return result, nil
}

// GetPeerProfiles returns the most recent peer profiles from the store.
func (p *SQLProfileAggregator) GetPeerProfiles(ctx context.Context, limit int) ([]store.PeerProfileRow, error) {
	return p.store.GetPeerProfiles(ctx, limit)
}

// StorePeer stores a profile received from a remote peer.
// TODO(you): marshal PeerProfile.Profile to JSON, store with PeerProfile.Hash.
func (p *SQLProfileAggregator) StorePeer(ctx context.Context, profile sdk.PeerProfile) error {
	data, err := json.Marshal(profile.Profile)
	if err != nil {
		return fmt.Errorf("marshal peer profile: %w", err)
	}
	return p.store.StorePeerProfile(ctx, profile.Hash, data)
}
