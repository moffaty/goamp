// Package plugin manages external process plugins.
// Each plugin is a separate binary that speaks gRPC (GoampPlugin service).
package plugin

// Manifest is the plugin.json file found in ~/.goamp/plugins/{name}/plugin.json
type Manifest struct {
	ID       string   `json:"id"`
	Version  string   `json:"version"`
	Protocols []string `json:"protocols"`
	Provides  []string `json:"provides"`   // e.g. "search_provider"
	APIPort   int      `json:"api_port"`   // 0 = determined at runtime from stdout
}

// LoadedPlugin is a running plugin process with an active gRPC connection.
type LoadedPlugin struct {
	Manifest Manifest
	Port     int
	client   GoampPluginClient
}

// Client returns the gRPC client for this plugin.
func (p *LoadedPlugin) Client() GoampPluginClient {
	return p.client
}
