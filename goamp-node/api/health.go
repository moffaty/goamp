package api

import (
	"encoding/json"
	"net/http"
	"time"
)

var startTime = time.Now()

// handleHealth responds with node status, uptime, and peer count.
// TODO(you): fill in peer_count from s.node.Peers(), mode from config.
func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	peerCount := 0
	if s.node != nil {
		peerCount = len(s.node.Peers())
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"status":      "ok",
		"peer_count":  peerCount,
		"uptime_secs": int(time.Since(startTime).Seconds()),
		"version":     "0.1.0",
	})
}

// handlePeers returns the list of connected peers.
// TODO(you): return peers from s.node.Peers() as JSON.
func (s *Server) handlePeers(w http.ResponseWriter, r *http.Request) {
	var peers []map[string]any
	if s.node != nil {
		for _, p := range s.node.Peers() {
			addrs := make([]string, len(p.Addrs))
			for i, a := range p.Addrs {
				addrs[i] = a.String()
			}
			peers = append(peers, map[string]any{
				"id":    p.ID.String(),
				"addrs": addrs,
			})
		}
	}
	if peers == nil {
		peers = []map[string]any{}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"peers": peers})
}
