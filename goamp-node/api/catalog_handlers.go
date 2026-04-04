package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/goamp/sdk/proto"
	"github.com/goamp/sdk/sdk"
)

// handleCatalogSearch handles GET /catalog/search?q=&genre=&limit=
// TODO(you): parse query params, call s.catalog.Search, return JSON.
func (s *Server) handleCatalogSearch(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	genreParam := r.URL.Query().Get("genre")
	limitParam := r.URL.Query().Get("limit")

	var genres []string
	if genreParam != "" {
		genres = strings.Split(genreParam, ",")
	}
	limit := 20
	if n, err := strconv.Atoi(limitParam); err == nil && n > 0 {
		limit = n
	}

	tracks, err := s.catalog.Search(r.Context(), sdk.Query{Q: q, Genres: genres, Limit: limit})
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if tracks == nil {
		tracks = []*proto.Track{}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"tracks": tracks})
}

// handleCatalogAnnounce handles POST /catalog/announce body: {"track_id":"..."}
// TODO(you): decode body, call s.catalog.Announce, return 204.
func (s *Server) handleCatalogAnnounce(w http.ResponseWriter, r *http.Request) {
	var body struct {
		TrackID string `json:"track_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.TrackID == "" {
		http.Error(w, "missing track_id", http.StatusBadRequest)
		return
	}
	if err := s.catalog.Announce(r.Context(), body.TrackID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
