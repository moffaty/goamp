// Package config handles loading ~/.goamp/node.toml with sensible defaults.
package config

import (
	"os"
	"path/filepath"
	"runtime"

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

// DefaultDataDir returns the OS-conventional per-user data directory for GOAMP.
// Used as the default when neither --data-dir nor a config file specifies one
// (i.e. standalone runs — when spawned by Tauri, --data-dir always wins).
//
//	Windows: %AppData%\goamp                      (…\AppData\Roaming\goamp)
//	macOS:   ~/Library/Application Support/goamp
//	Linux:   $XDG_DATA_HOME/goamp  or  ~/.local/share/goamp
//
// Falls back to ~/.goamp only if the OS directory cannot be resolved.
func DefaultDataDir() string {
	switch runtime.GOOS {
	case "linux":
		// os.UserConfigDir() returns ~/.config on Linux, but application *data*
		// belongs in XDG_DATA_HOME (~/.local/share) — matches the Tauri host.
		if xdg := os.Getenv("XDG_DATA_HOME"); xdg != "" {
			return filepath.Join(xdg, "goamp")
		}
		if home, err := os.UserHomeDir(); err == nil {
			return filepath.Join(home, ".local", "share", "goamp")
		}
	default:
		// Windows → %AppData% (Roaming); macOS → ~/Library/Application Support.
		if dir, err := os.UserConfigDir(); err == nil {
			return filepath.Join(dir, "goamp")
		}
	}
	// Last resort — works everywhere, just not idiomatic.
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".goamp")
}

// Default returns a Config with all fields set to sensible, OS-appropriate values.
func Default() *Config {
	goampDir := DefaultDataDir()
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

// ApplyDataDir points DataDir and every path derived from it at dir.
// The host application (Tauri) calls this — via the --data-dir flag — so the
// node stores its SQLite store, identity key, plugins and archive inside the
// OS app-data folder alongside goamp.db, instead of the default ~/.goamp.
// This keeps both binaries' state in one place.
func ApplyDataDir(cfg *Config, dir string) {
	cfg.Node.DataDir = dir
	cfg.Identity.KeyPath = filepath.Join(dir, "identity.key")
	cfg.Plugins.Dir = filepath.Join(dir, "plugins")
	cfg.Archive.StoragePath = filepath.Join(dir, "archive")
}

// Load reads the TOML file at path (if it exists) over the defaults.
// If path is empty or the file does not exist, returns defaults unchanged.
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
	return cfg, nil
}
