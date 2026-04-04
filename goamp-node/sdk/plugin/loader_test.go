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

// buildFakePlugin compiles the fake_plugin helper binary into a temp dir.
func buildFakePlugin(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	// Write a minimal Go plugin that prints {"port": N} and then serves gRPC
	src := filepath.Join(dir, "main.go")
	binName := "fake-plugin"
	if runtime.GOOS == "windows" {
		binName += ".exe"
	}
	bin := filepath.Join(dir, binName)

	// Find a free port first
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	port := ln.Addr().(*net.TCPAddr).Port
	ln.Close()

	mainSrc := fmt.Sprintf(`package main
import (
	"fmt"
	"net"
	"context"
	pb "github.com/goamp/sdk/proto"
	"google.golang.org/grpc"
)

type server struct{ pb.UnimplementedGoampPluginServer }

func (s *server) Register(_ context.Context, _ *pb.RegisterRequest) (*pb.PluginManifest, error) {
	return &pb.PluginManifest{Id: "fake-plugin", Version: "1.0.0"}, nil
}

func main() {
	lis, _ := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", %d))
	fmt.Printf("{\"port\": %d}\n", %d)
	srv := grpc.NewServer()
	pb.RegisterGoampPluginServer(srv, &server{})
	srv.Serve(lis)
}
`, port, port, port)

	require.NoError(t, os.WriteFile(src, []byte(mainSrc), 0600))
	cmd := exec.Command("go", "build", "-o", bin, src)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	require.NoError(t, err, "build fake plugin: %s", out)

	// Write plugin.json
	m := plugin.Manifest{ID: "fake-plugin", Version: "1.0.0"}
	data, _ := json.Marshal(m)
	require.NoError(t, os.WriteFile(filepath.Join(dir, "plugin.json"), data, 0600))

	// Rename binary to match plugin ID
	finalBin := filepath.Join(dir, "fake-plugin")
	if bin != finalBin {
		require.NoError(t, os.Rename(bin, finalBin))
	}
	require.NoError(t, os.Chmod(finalBin, 0755))

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
