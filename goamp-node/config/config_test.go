package config_test

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
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

func TestDefaultDataDirIsOSAppropriate(t *testing.T) {
	dir := config.DefaultDataDir()
	require.NotEmpty(t, dir)
	assert.True(t, filepath.IsAbs(dir), "data dir must be absolute, got %q", dir)
	assert.Contains(t, dir, "goamp")

	// It must NOT be the old unconventional ~/.goamp dotfolder on any OS
	// where a proper convention exists.
	switch runtime.GOOS {
	case "windows":
		// %AppData%\goamp
		assert.True(t, strings.Contains(dir, "AppData") || strings.Contains(dir, "Roaming"),
			"Windows data dir should live under AppData, got %q", dir)
	case "darwin":
		assert.Contains(t, dir, filepath.Join("Library", "Application Support"))
	case "linux":
		assert.True(t, strings.Contains(dir, ".local/share") || strings.Contains(dir, ".config"),
			"Linux data dir should follow XDG, got %q", dir)
	}
}

func TestDefaultDataDirRespectsXDGOnLinux(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("XDG_DATA_HOME is Linux-only")
	}
	t.Setenv("XDG_DATA_HOME", "/tmp/xdg-test")
	assert.Equal(t, filepath.Join("/tmp/xdg-test", "goamp"), config.DefaultDataDir())
}

func TestDefaultConfigUsesDefaultDataDir(t *testing.T) {
	cfg := config.Default()
	base := config.DefaultDataDir()
	assert.Equal(t, base, cfg.Node.DataDir)
	assert.Equal(t, filepath.Join(base, "identity.key"), cfg.Identity.KeyPath)
	assert.Equal(t, filepath.Join(base, "plugins"), cfg.Plugins.Dir)
}

func TestApplyDataDir(t *testing.T) {
	cfg := config.Default()
	dir := filepath.Join("C:", "Users", "Moffaty", "AppData", "Roaming", "com.goamp.app", "node")
	config.ApplyDataDir(cfg, dir)

	assert.Equal(t, dir, cfg.Node.DataDir)
	assert.Equal(t, filepath.Join(dir, "identity.key"), cfg.Identity.KeyPath)
	assert.Equal(t, filepath.Join(dir, "plugins"), cfg.Plugins.Dir)
	assert.Equal(t, filepath.Join(dir, "archive"), cfg.Archive.StoragePath)
}

func TestApplyDataDirOverridesConfigFile(t *testing.T) {
	// A node.toml setting must lose to --data-dir (applied last by main.go).
	dir := t.TempDir()
	f := filepath.Join(dir, "node.toml")
	err := os.WriteFile(f, []byte(`
[node]
data_dir = "/some/old/path"
`), 0600)
	require.NoError(t, err)

	cfg, err := config.Load(f)
	require.NoError(t, err)
	assert.Equal(t, "/some/old/path", cfg.Node.DataDir) // from file

	config.ApplyDataDir(cfg, "/new/unified/path")
	assert.Equal(t, "/new/unified/path", cfg.Node.DataDir) // overridden
	assert.Equal(t, filepath.Join("/new/unified/path", "identity.key"), cfg.Identity.KeyPath)
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
