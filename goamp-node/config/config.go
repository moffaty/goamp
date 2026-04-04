// Package config handles loading ~/.goamp/node.toml with sensible defaults.
package config

import (
	"os"
	"path/filepath"

	"github.com/BurntSushi/toml"
)

type Config struct {
	Node     NodeConfig     `toml:"node"`
	Identity IdentityConfig `toml:"identity"`
	Network  NetworkConfig  `toml:"network"`
	Archive  ArchiveConfig  `toml:"archive"`
	Plugins  PluginsConfig  `toml:"plugins"`
}

type NodeConfig struct {
	Mode    string `toml:"mode"`    // "client" | "full" | "server"
	DataDir string `toml:"data_dir"`
	APIPort int    `toml:"api_port"`
}

type IdentityConfig struct {
	KeyPath     string `toml:"key_path"`
	UserKeyPath string `toml:"user_key_path"`
}

type NetworkConfig struct {
	BootstrapDNS string `toml:"bootstrap_dns"`
	EnableMDNS   bool   `toml:"enable_mdns"`
	MaxPeers     int    `toml:"max_peers"`
}

type ArchiveConfig struct {
	Enabled     bool   `toml:"enabled"`
	QuotaGB     int64  `toml:"quota_gb"`
	StoragePath string `toml:"storage_path"`
}

type PluginsConfig struct {
	Dir     string `toml:"dir"`
	Enabled bool   `toml:"enabled"`
}

// Default returns a Config with all fields set to sensible values.
// TODO(you): fill in the default values matching the spec's node.toml section.
// Expand "~" using os.UserHomeDir() for any path field that starts with "~".
func Default() *Config {
	home, _ := os.UserHomeDir()
	goampDir := filepath.Join(home, ".goamp")
	return &Config{
		Node: NodeConfig{
			Mode:    "client",
			DataDir: goampDir,
			APIPort: 7472,
		},
		Identity: IdentityConfig{
			KeyPath:     filepath.Join(goampDir, "identity.key"),
			UserKeyPath: "",
		},
		Network: NetworkConfig{
			BootstrapDNS: "_goamp._tcp.goamp.app",
			EnableMDNS:   true,
			MaxPeers:     50,
		},
		Archive: ArchiveConfig{
			Enabled:     false,
			QuotaGB:     0,
			StoragePath: filepath.Join(goampDir, "archive"),
		},
		Plugins: PluginsConfig{
			Dir:     filepath.Join(goampDir, "plugins"),
			Enabled: true,
		},
	}
}

// Load reads the TOML file at path (if it exists) over the defaults.
// If path is empty or the file does not exist, returns defaults unchanged.
// TODO(you): implement TOML decoding using github.com/BurntSushi/toml.
// Hint: toml.DecodeFile(path, cfg) merges only the keys present in the file.
func Load(path string) (*Config, error) {
	cfg := Default()
	if path == "" {
		return cfg, nil
	}
	if _, err := os.Stat(path); os.IsNotExist(err) {
		return cfg, nil
	}
	if _, err := toml.DecodeFile(path, cfg); err != nil {
		return nil, err
	}
	// TODO(you): expand "~" in all path fields after decoding.
	return cfg, nil
}
