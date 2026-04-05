package plugin_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/goamp/sdk/sdk/plugin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// buildFakePlugin compiles the fake plugin (from testdata/fakeplugin) into a temp dir.
// It builds from the module root so all dependencies are resolved.
func buildFakePlugin(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()

	// Find module root by walking up from this file
	_, filename, _, _ := runtime.Caller(0)
	moduleRoot := filepath.Clean(filepath.Join(filepath.Dir(filename), "..", ".."))

	// Find a free port
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	port := ln.Addr().(*net.TCPAddr).Port
	ln.Close()

	bin := filepath.Join(dir, "fake-plugin")
	if runtime.GOOS == "windows" {
		bin += ".exe"
	}

	// Build from module root where go.mod lives; embed port via ldflags
	cmd := exec.Command("go", "build",
		"-ldflags", fmt.Sprintf("-X main.port=%d", port),
		"-o", bin,
		"./sdk/plugin/testdata/fakeplugin",
	)
	cmd.Dir = moduleRoot
	out, err := cmd.CombinedOutput()
	require.NoError(t, err, "build fake plugin: %s", out)
	require.NoError(t, os.Chmod(bin, 0755))

	// Write plugin.json
	m := plugin.Manifest{ID: "fake-plugin", Version: "1.0.0"}
	data, _ := json.Marshal(m)
	require.NoError(t, os.WriteFile(filepath.Join(dir, "plugin.json"), data, 0600))

	return dir
}

func TestLoaderLoadAll(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping plugin build test in short mode")
	}
	pluginDir := t.TempDir()
	fakeDir := buildFakePlugin(t)

	// Place fake plugin subdirectory inside pluginDir
	require.NoError(t, os.Rename(fakeDir, filepath.Join(pluginDir, "fake-plugin")))

	loader := plugin.NewLoader(pluginDir)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	loader.LoadAll(ctx)
	defer loader.Close()

	plugins := loader.List()
	require.Len(t, plugins, 1)
	assert.Equal(t, "fake-plugin", plugins[0].Manifest.ID)
}

func TestLoaderEmptyDir(t *testing.T) {
	loader := plugin.NewLoader(t.TempDir())
	loader.LoadAll(context.Background())
	assert.Empty(t, loader.List())
}

func TestLoaderNonExistentDir(t *testing.T) {
	loader := plugin.NewLoader("/does/not/exist")
	// Should not panic or error
	loader.LoadAll(context.Background())
	assert.Empty(t, loader.List())
}
