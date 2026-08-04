package api

import (
	"encoding/json"
	"net/http"
	"os"
)

// handleContentProvide reads a local file and provides it to the network as the
// content for a track id. Body: {"track_id": "...", "path": "/abs/path"}.
// The desktop and node share the machine, so a path (not the bytes) is passed.
func (s *Server) handleContentProvide(w http.ResponseWriter, r *http.Request) {
	var body struct {
		TrackID string `json:"track_id"`
		Path    string `json:"path"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.TrackID == "" || body.Path == "" {
		http.Error(w, "track_id and path required", http.StatusBadRequest)
		return
	}
	data, err := os.ReadFile(body.Path)
	if err != nil {
		http.Error(w, "read file: "+err.Error(), http.StatusBadRequest)
		return
	}
	if err := s.node.ProvideContent(r.Context(), body.TrackID, data); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleContentGet serves a track's bytes for the id in the query, or 404 when no
// peer (or the local archive) holds it. Query id may contain ':' and '/' (e.g.
// "soundcloud:https://…"), so it travels as a query param, not a path segment.
// Route: GET /content?id=<url-encoded>.
func (s *Server) handleContentGet(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("id")
	if id == "" {
		http.Error(w, "missing track_id", http.StatusBadRequest)
		return
	}
	data, err := s.node.GetContent(r.Context(), id)
	if err != nil || len(data) == 0 {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	_, _ = w.Write(data)
}
