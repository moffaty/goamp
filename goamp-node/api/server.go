// Package api implements the HTTP REST + WebSocket API for the GOAMP node.
package api

import (
	"fmt"
	"net/http"

	"github.com/goamp/sdk/sdk"
	"github.com/goamp/sdk/sdk/catalog"
	"github.com/goamp/sdk/sdk/plugin"
	"github.com/goamp/sdk/sdk/profiles"
)

// Server wires together all HTTP handlers and serves the API.
type Server struct {
	node     sdk.Node
	catalog  *catalog.SQLCatalog
	profiles *profiles.SQLProfileAggregator
	plugins  *plugin.Loader
	hub      *WSHub
}

// New creates a Server. Call Start to begin accepting connections.
// TODO(you): this constructor is done. Implement handlers in the other files.
func New(node sdk.Node, cat *catalog.SQLCatalog, prof *profiles.SQLProfileAggregator, loader *plugin.Loader) *Server {
	s := &Server{
		node:     node,
		catalog:  cat,
		profiles: prof,
		plugins:  loader,
		hub:      newWSHub(),
	}
	// Wire node events to WebSocket hub so Tauri receives them in real time.
	// TODO(you): in node.go, call s.hub.Broadcast when Emit is called.
	return s
}

// Start registers all routes and calls http.ListenAndServe.
// It blocks until the server stops.
// TODO(you): register all routes (see plan), call http.ListenAndServe(addr, mux).
func (s *Server) Start(addr string) error {
	mux := http.NewServeMux()

	// Health + peers
	mux.HandleFunc("GET /health", s.handleHealth)
	mux.HandleFunc("GET /peers", s.handlePeers)

	// Catalog
	mux.HandleFunc("GET /catalog/search", s.handleCatalogSearch)
	mux.HandleFunc("POST /catalog/announce", s.handleCatalogAnnounce)

	// Profiles
	mux.HandleFunc("POST /profiles/sync", s.handleProfileSync)
	mux.HandleFunc("GET /recommendations", s.handleRecommendations)

	// WebSocket events
	mux.HandleFunc("GET /events", s.hub.ServeWS)

	// Plugins
	mux.HandleFunc("GET /plugins", s.handlePluginList)
	// Wildcard for plugin proxy — must be last
	mux.HandleFunc("/plugins/", s.handlePluginProxy)

	fmt.Printf("GOAMP node API listening on %s\n", addr)
	return http.ListenAndServe(addr, mux)
}

// Hub returns the WebSocket hub so the Node can push events.
func (s *Server) Hub() *WSHub {
	return s.hub
}
