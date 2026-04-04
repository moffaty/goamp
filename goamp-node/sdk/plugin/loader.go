package plugin

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// Loader scans a plugin directory, spawns each plugin binary, and maintains
// live gRPC connections to them.
type Loader struct {
	dir     string
	plugins map[string]*LoadedPlugin // keyed by plugin ID
}

// NewLoader creates a Loader that will scan dir for plugins.
func NewLoader(dir string) *Loader {
	return &Loader{
		dir:     dir,
		plugins: make(map[string]*LoadedPlugin),
	}
}

// LoadAll scans dir for subdirectories containing plugin.json, spawns each
// binary, and registers it via gRPC.
// Non-fatal errors (missing binary, timeout, gRPC failure) are logged and skipped.
func (l *Loader) LoadAll(ctx context.Context) {
	entries, err := os.ReadDir(l.dir)
	if err != nil {
		if !os.IsNotExist(err) {
			log.Printf("[plugin] scan %s: %v", l.dir, err)
		}
		return
	}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		manifestPath := filepath.Join(l.dir, entry.Name(), "plugin.json")
		data, err := os.ReadFile(manifestPath)
		if err != nil {
			continue // no plugin.json — skip
		}
		var m Manifest
		if err := json.Unmarshal(data, &m); err != nil {
			log.Printf("[plugin] parse %s: %v", manifestPath, err)
			continue
		}
		if err := l.spawn(ctx, filepath.Join(l.dir, entry.Name()), m); err != nil {
			log.Printf("[plugin] spawn %s: %v", m.ID, err)
		}
	}
}

// spawn starts the plugin binary, reads its port from stdout, and dials gRPC.
func (l *Loader) spawn(ctx context.Context, dir string, m Manifest) error {
	// Look for a binary named after the plugin ID inside the plugin dir.
	binPath := filepath.Join(dir, m.ID)
	if _, err := os.Stat(binPath); err != nil {
		// Try platform suffix on Windows
		binPath = filepath.Join(dir, m.ID+".exe")
		if _, err := os.Stat(binPath); err != nil {
			return fmt.Errorf("binary not found in %s", dir)
		}
	}

	cmd := exec.CommandContext(ctx, binPath)
	cmd.Dir = dir
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("stdout pipe: %w", err)
	}
	cmd.Stderr = os.Stderr

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start: %w", err)
	}

	// Read first line within 5 seconds: {"port": N}
	portCh := make(chan int, 1)
	go func() {
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			var msg struct {
				Port int `json:"port"`
			}
			if err := json.Unmarshal([]byte(line), &msg); err == nil && msg.Port > 0 {
				portCh <- msg.Port
				return
			}
		}
		close(portCh)
	}()

	select {
	case port, ok := <-portCh:
		if !ok {
			cmd.Process.Kill()
			return fmt.Errorf("plugin exited without announcing port")
		}
		client, err := Dial(port)
		if err != nil {
			cmd.Process.Kill()
			return fmt.Errorf("dial port %d: %w", port, err)
		}
		// Call Register to verify the plugin is healthy
		regCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
		_, err = client.Register(regCtx, "0.1.0")
		if err != nil {
			client.Close()
			cmd.Process.Kill()
			return fmt.Errorf("register: %w", err)
		}
		l.plugins[m.ID] = &LoadedPlugin{
			Manifest: m,
			Port:     port,
			client:   client,
		}
		log.Printf("[plugin] loaded %s v%s on port %d", m.ID, m.Version, port)
		return nil

	case <-time.After(5 * time.Second):
		cmd.Process.Kill()
		return fmt.Errorf("timeout waiting for port announcement")
	}
}

// Get returns a loaded plugin by ID.
func (l *Loader) Get(id string) (*LoadedPlugin, bool) {
	p, ok := l.plugins[id]
	return p, ok
}

// List returns all loaded plugins.
func (l *Loader) List() []*LoadedPlugin {
	plugins := make([]*LoadedPlugin, 0, len(l.plugins))
	for _, p := range l.plugins {
		plugins = append(plugins, p)
	}
	return plugins
}

// Close terminates all plugin connections (not the processes — they manage their own lifecycle).
func (l *Loader) Close() {
	for _, p := range l.plugins {
		p.client.Close()
	}
}
