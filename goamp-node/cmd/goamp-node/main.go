// goamp-node is the GOAMP P2P node binary.
// It is a thin wrapper around the github.com/goamp/sdk library.
// Tauri spawns it as a sidecar and communicates via HTTP REST + WebSocket.
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	"github.com/goamp/sdk/api"
	"github.com/goamp/sdk/config"
	"github.com/goamp/sdk/identity"
	goampsdk "github.com/goamp/sdk/sdk"
	"github.com/goamp/sdk/sdk/catalog"
	"github.com/goamp/sdk/sdk/node"
	"github.com/goamp/sdk/sdk/plugin"
	"github.com/goamp/sdk/sdk/profiles"
	"github.com/goamp/sdk/store"
)

func main() {
	var (
		mode       = flag.String("mode", "", "node mode: client|full|server (overrides config)")
		apiPort    = flag.Int("api-port", 0, "HTTP API port (overrides config)")
		configPath = flag.String("config", "", "path to node.toml (default: ~/.goamp/node.toml)")
	)
	flag.Parse()

	// 1. Load config
	cfgPath := *configPath
	if cfgPath == "" {
		home, _ := os.UserHomeDir()
		cfgPath = filepath.Join(home, ".goamp", "node.toml")
	}
	cfg, err := config.Load(cfgPath)
	if err != nil {
		log.Fatalf("config: %v", err)
	}
	if *mode != "" {
		cfg.Node.Mode = *mode
	}
	if *apiPort != 0 {
		cfg.Node.APIPort = *apiPort
	}

	// 2. Ensure data directory exists
	if err := os.MkdirAll(cfg.Node.DataDir, 0700); err != nil {
		log.Fatalf("data dir: %v", err)
	}

	// 3. Load or generate identity key
	_, err = identity.LoadOrGenerate(cfg.Identity.KeyPath)
	if err != nil {
		log.Fatalf("identity: %v", err)
	}

	// 4. Open SQLite store
	db, err := store.Open(cfg.Node.DataDir)
	if err != nil {
		log.Fatalf("store: %v", err)
	}
	defer db.Close()

	// 5. Build SDK modules
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Node stub (Plan 1 — no real libp2p yet)
	// In Plan 2, replace with node.NewLibP2PNode(ctx, privKey, cfg)
	var srv *api.Server
	n := node.New(func(event goampsdk.Event) {
		if srv != nil {
			srv.Hub().Broadcast(event)
		}
	})

	cat := catalog.New(db, "local")
	prof := profiles.New(db)

	// 6. Load plugins
	loader := plugin.NewLoader(cfg.Plugins.Dir)
	if cfg.Plugins.Enabled {
		loader.LoadAll(ctx)
	}
	defer loader.Close()

	// 7. Build and start HTTP server
	srv = api.New(n, cat, prof, loader)

	// Signal handling — graceful shutdown on SIGTERM or SIGINT
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)
	go func() {
		<-sigCh
		log.Println("[goamp-node] shutting down…")
		cancel()
		db.Close()
		os.Exit(0)
	}()

	addr := fmt.Sprintf(":%d", cfg.Node.APIPort)

	// Print ready signal to stdout so Tauri knows the port
	fmt.Printf("ready:%d\n", cfg.Node.APIPort)
	os.Stdout.Sync()

	log.Printf("[goamp-node] mode=%s api=%s", cfg.Node.Mode, addr)
	if err := srv.Start(addr); err != nil {
		log.Fatalf("server: %v", err)
	}
}
