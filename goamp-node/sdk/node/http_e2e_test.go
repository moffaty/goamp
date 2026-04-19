package node_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/goamp/sdk/api"
	"github.com/goamp/sdk/proto"
	"github.com/goamp/sdk/sdk/catalog"
	"github.com/goamp/sdk/sdk/node"
	"github.com/goamp/sdk/sdk/profiles"
	"github.com/goamp/sdk/store"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// spawnHTTPNode wires a full P2PNode + SQLite store + api.Server behind httptest.Server.
// Returns the node and the HTTP base URL.
func spawnHTTPNode(t *testing.T) (*node.P2PNode, string) {
	t.Helper()

	s, err := store.Open(":memory:")
	require.NoError(t, err)
	t.Cleanup(func() { s.Close() })

	cat := catalog.New(s, "local")
	agg := profiles.New(s)

	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)

	n, err := node.New(ctx, node.Config{
		ListenAddr: "/ip4/127.0.0.1/tcp/0",
		Catalog:    cat,
		Profiles:   agg,
	})
	require.NoError(t, err)
	require.NoError(t, n.Start(ctx))
	t.Cleanup(func() { _ = n.Stop() })

	srv := api.New(n, cat, agg, nil)
	ts := httptest.NewServer(srv.Handler())
	t.Cleanup(ts.Close)

	return n, ts.URL
}

// TestE2EHTTPProfileGossip simulates two Tauri clients talking to separate goamp-node
// sidecars over HTTP. Client A POSTs a taste profile, and client B must see it appear
// under GET /profiles/peers after the GossipSub mesh propagates it.
func TestE2EHTTPProfileGossip(t *testing.T) {
	nodeA, urlA := spawnHTTPNode(t)
	nodeB, urlB := spawnHTTPNode(t)

	connectNodes(t, nodeA, nodeB)
	waitForGossipMesh(t, nodeA, nodeB)

	profile := &proto.TasteProfile{
		Version:      1,
		LikedHashes:  []string{"h1", "h2", "h3"},
		TotalListens: 42,
	}
	body, err := json.Marshal(profile)
	require.NoError(t, err)

	// POST /profiles/sync on node A (what Tauri's sync_to_node does).
	resp, err := http.Post(urlA+"/profiles/sync", "application/json", bytes.NewReader(body))
	require.NoError(t, err)
	_ = resp.Body.Close()
	require.Equal(t, http.StatusNoContent, resp.StatusCode)

	// GET /profiles/peers on node B (what Tauri's fetch_peer_profiles does).
	// GossipSub needs a beat to propagate, so poll until it shows up.
	require.Eventually(t, func() bool {
		r, err := http.Get(urlB + "/profiles/peers?limit=10")
		if err != nil {
			return false
		}
		defer r.Body.Close()
		if r.StatusCode != http.StatusOK {
			return false
		}
		var body struct {
			Profiles []struct {
				Hash       string          `json:"hash"`
				Data       json.RawMessage `json:"data"`
				ReceivedAt int64           `json:"received_at"`
			} `json:"profiles"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			return false
		}
		if len(body.Profiles) == 0 {
			return false
		}
		// Decode the stored profile and confirm it matches what A sent.
		var got proto.TasteProfile
		if err := json.Unmarshal(body.Profiles[0].Data, &got); err != nil {
			return false
		}
		return got.TotalListens == 42 && len(got.LikedHashes) == 3
	}, 10*time.Second, 200*time.Millisecond, "node B must receive A's profile via gossip")
}

// TestE2EHTTPNodeBNoPeers verifies /profiles/peers returns 200 + empty array when
// the node has not received anything yet — no flaky startup race.
func TestE2EHTTPNodeBNoPeers(t *testing.T) {
	_, url := spawnHTTPNode(t)

	r, err := http.Get(url + "/profiles/peers")
	require.NoError(t, err)
	defer r.Body.Close()

	assert.Equal(t, http.StatusOK, r.StatusCode)

	var body struct {
		Profiles []any `json:"profiles"`
	}
	require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
	assert.Empty(t, body.Profiles)
}
