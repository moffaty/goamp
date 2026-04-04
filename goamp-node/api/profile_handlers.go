package api

import (
	"encoding/json"
	"net/http"

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
	if err := s.profiles.Submit(r.Context(), &profile); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
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
