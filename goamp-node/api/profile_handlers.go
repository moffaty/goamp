package api

import (
	"encoding/json"
	"net/http"
	"strconv"

	goampsdk "github.com/goamp/sdk/sdk"

	"github.com/goamp/sdk/proto"
)

// handleProfileSync handles POST /profiles/sync body: TasteProfile JSON
// TODO(you): decode body as proto.TasteProfile, call s.profiles.Submit, return 204.
func (s *Server) handleProfileSync(w http.ResponseWriter, r *http.Request) {
	var profile proto.TasteProfile
	if err := json.NewDecoder(r.Body).Decode(&profile); err != nil {
		http.Error(w, "invalid profile: "+err.Error(), http.StatusBadRequest)
		return
	}
	// Filter mood centroids: only sync moods with enough data
	if len(profile.MoodCentroids) > 0 {
		filtered := make(map[string]*proto.MoodCentroid)
		for moodID, centroid := range profile.MoodCentroids {
			if centroid.TrackCount >= 10 {
				filtered[moodID] = centroid
			}
		}
		profile.MoodCentroids = filtered
	}

	if err := s.profiles.Submit(r.Context(), &profile); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if s.node != nil {
		_ = s.node.PublishProfile(r.Context(), &profile)
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleGetPeerProfiles handles GET /profiles/peers?limit=N
// Returns peer taste profiles stored from gossip, newest first.
func (s *Server) handleGetPeerProfiles(w http.ResponseWriter, r *http.Request) {
	limit := 100
	if n, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && n > 0 {
		limit = n
	}
	rows, err := s.profiles.GetPeerProfiles(r.Context(), limit)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	type profileEntry struct {
		Hash       string          `json:"hash"`
		Data       json.RawMessage `json:"data"`
		ReceivedAt int64           `json:"received_at"`
	}
	entries := make([]profileEntry, 0, len(rows))
	for _, row := range rows {
		entries = append(entries, profileEntry{
			Hash:       row.Hash,
			Data:       json.RawMessage(row.Data),
			ReceivedAt: row.ReceivedAt,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"profiles": entries})
}

// handleRecommendations handles GET /recommendations
// TODO(you): call s.profiles.GetRecommendations, return JSON.
func (s *Server) handleRecommendations(w http.ResponseWriter, r *http.Request) {
	recs, err := s.profiles.GetRecommendations(r.Context(), nil)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if recs == nil {
		recs = []goampsdk.Recommendation{}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"recommendations": recs})
}
