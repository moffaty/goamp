package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
)

// handlePluginList handles GET /plugins and returns all loaded plugins.
func (s *Server) handlePluginList(w http.ResponseWriter, r *http.Request) {
	if s.plugins == nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"plugins": []any{}})
		return
	}
	type pluginInfo struct {
		ID        string   `json:"id"`
		Version   string   `json:"version"`
		Port      int      `json:"port"`
		Protocols []string `json:"protocols"`
	}
	var infos []pluginInfo
	for _, p := range s.plugins.List() {
		infos = append(infos, pluginInfo{
			ID:        p.Manifest.ID,
			Version:   p.Manifest.Version,
			Port:      p.Port,
			Protocols: p.Manifest.Protocols,
		})
	}
	if infos == nil {
		infos = []pluginInfo{}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"plugins": infos})
}

// handlePluginProxy reverse-proxies requests under /plugins/{id}/* to the
// plugin's HTTP server running on its announced port.
//
// Example: GET /plugins/vk-music/search?q=test
//
//	→ GET http://localhost:{vk-music port}/search?q=test
func (s *Server) handlePluginProxy(w http.ResponseWriter, r *http.Request) {
	// Path: /plugins/{id}/rest...
	path := strings.TrimPrefix(r.URL.Path, "/plugins/")
	parts := strings.SplitN(path, "/", 2)
	if len(parts) == 0 || parts[0] == "" {
		http.Error(w, "missing plugin id", http.StatusBadRequest)
		return
	}
	pluginID := parts[0]

	if s.plugins == nil {
		http.Error(w, "plugin system not initialised", http.StatusServiceUnavailable)
		return
	}
	p, ok := s.plugins.Get(pluginID)
	if !ok {
		http.Error(w, fmt.Sprintf("plugin %q not loaded", pluginID), http.StatusNotFound)
		return
	}

	target, err := url.Parse(fmt.Sprintf("http://localhost:%d", p.Port))
	if err != nil {
		http.Error(w, "invalid plugin address", http.StatusInternalServerError)
		return
	}

	proxy := httputil.NewSingleHostReverseProxy(target)

	// Rewrite the request path: strip /plugins/{id} prefix
	r2 := r.Clone(r.Context())
	rest := "/"
	if len(parts) > 1 {
		rest = "/" + parts[1]
	}
	r2.URL.Path = rest
	r2.URL.RawPath = rest
	r2.Host = target.Host

	proxy.ServeHTTP(w, r2)
}
