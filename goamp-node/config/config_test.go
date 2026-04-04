package config_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/goamp/sdk/config"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestDefaultConfig(t *testing.T) {
	cfg := config.Default()
	assert.Equal(t, "client", cfg.Node.Mode)
	assert.Equal(t, 7472, cfg.Node.APIPort)
	assert.True(t, cfg.Network.EnableMDNS)
	assert.Equal(t, 50, cfg.Network.MaxPeers)
}

func TestLoadNonExistentPath(t *testing.T) {
	cfg, err := config.Load("/does/not/exist/node.toml")
	require.NoError(t, err)
	assert.Equal(t, "client", cfg.Node.Mode) // defaults intact
}

func TestLoadEmptyPath(t *testing.T) {
	cfg, err := config.Load("")
	require.NoError(t, err)
	assert.Equal(t, 7472, cfg.Node.APIPort)
}

func TestLoadOverridesFields(t *testing.T) {
	// TODO(you): create a temp TOML file, verify specific fields are overridden
	// while unspecified fields keep their defaults.
	dir := t.TempDir()
	f := filepath.Join(dir, "node.toml")
	err := os.WriteFile(f, []byte(`
[node]
mode = "full"
api_port = 8000
`), 0600)
	require.NoError(t, err)

	cfg, err := config.Load(f)
	require.NoError(t, err)
	assert.Equal(t, "full", cfg.Node.Mode)
	assert.Equal(t, 8000, cfg.Node.APIPort)
	assert.Equal(t, 50, cfg.Network.MaxPeers) // default kept
}
