package api

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/goamp/sdk/account"
	"github.com/goamp/sdk/sync"
)

// RegisterStateSyncRoutes wires /state/sync-{up,down} onto mux.
func (s *Server) RegisterStateSyncRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /state/sync-up", s.handleStateSyncUp)
	mux.HandleFunc("POST /state/sync-down", s.handleStateSyncDown)
}

type syncReq struct {
	AccountPub   string `json:"account_pub"`
	SubSkB64     string `json:"sub_sk_b64"`
	StateKeyB64  string `json:"state_key_b64"`
	PlaintextB64 string `json:"plaintext_b64,omitempty"`
	RelayURL     string `json:"relay_url"`
}

func (r *syncReq) decode() (*account.SubKey, []byte, []byte, error) {
	skBytes, err := base64.StdEncoding.DecodeString(r.SubSkB64)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("sub_sk_b64: %w", err)
	}
	if len(skBytes) != ed25519.PrivateKeySize {
		return nil, nil, nil, fmt.Errorf("sub_sk wrong size: %d", len(skBytes))
	}
	sk := ed25519.PrivateKey(skBytes)
	pub, _ := sk.Public().(ed25519.PublicKey)
	key, err := base64.StdEncoding.DecodeString(r.StateKeyB64)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("state_key_b64: %w", err)
	}
	if len(key) != 32 {
		return nil, nil, nil, fmt.Errorf("state_key wrong size: %d", len(key))
	}
	plain, err := base64.StdEncoding.DecodeString(r.PlaintextB64)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("plaintext_b64: %w", err)
	}
	return &account.SubKey{PrivateKey: sk, PublicKey: pub}, key, plain, nil
}

func (s *Server) handleStateSyncUp(w http.ResponseWriter, r *http.Request) {
	var req syncReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad json: "+err.Error(), 400)
		return
	}
	sub, key, plain, err := req.decode()
	if err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	c := sync.NewClient(req.RelayURL)
	if err := c.SyncUpFor(req.AccountPub, key, sub, plain); err != nil {
		http.Error(w, err.Error(), 502)
		return
	}
	writeJSON(w, map[string]bool{"ok": true})
}

func (s *Server) handleStateSyncDown(w http.ResponseWriter, r *http.Request) {
	var req syncReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad json: "+err.Error(), 400)
		return
	}
	sub, key, _, err := req.decode()
	if err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	c := sync.NewClient(req.RelayURL)
	plain, err := c.SyncDownFor(req.AccountPub, key, sub)
	if err != nil {
		http.Error(w, err.Error(), 502)
		return
	}
	writeJSON(w, map[string]string{
		"plaintext_b64": base64.StdEncoding.EncodeToString(plain),
	})
}
