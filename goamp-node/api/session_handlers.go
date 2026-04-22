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

// RegisterSessionRoutes wires /session/* and /commands/* handlers onto mux.
func (s *Server) RegisterSessionRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /session/put", s.handleSessionPut)
	mux.HandleFunc("POST /session/get", s.handleSessionGet)
	mux.HandleFunc("POST /commands/post", s.handleCommandPost)
	mux.HandleFunc("POST /commands/pull", s.handleCommandPull)
}

type sessionReq struct {
	AccountPub  string `json:"account_pub"`
	SubSkB64    string `json:"sub_sk_b64"`
	RelayURL    string `json:"relay_url"`
	SessionJSON string `json:"session_json,omitempty"`
	CommandJSON string `json:"command_json,omitempty"`
}

func (r *sessionReq) sub() (*account.SubKey, error) {
	b, err := base64.StdEncoding.DecodeString(r.SubSkB64)
	if err != nil || len(b) != ed25519.PrivateKeySize {
		return nil, fmt.Errorf("sub_sk_b64 invalid")
	}
	sk := ed25519.PrivateKey(b)
	pub, _ := sk.Public().(ed25519.PublicKey)
	return &account.SubKey{PrivateKey: sk, PublicKey: pub}, nil
}

func (s *Server) handleSessionPut(w http.ResponseWriter, r *http.Request) {
	var req sessionReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad json", 400)
		return
	}
	sub, err := req.sub()
	if err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	c := sync.NewClient(req.RelayURL)
	if err := c.PutSession(req.AccountPub, sub, []byte(req.SessionJSON)); err != nil {
		http.Error(w, err.Error(), 502)
		return
	}
	writeJSON(w, map[string]bool{"ok": true})
}

func (s *Server) handleSessionGet(w http.ResponseWriter, r *http.Request) {
	var req sessionReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad json", 400)
		return
	}
	sub, err := req.sub()
	if err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	c := sync.NewClient(req.RelayURL)
	data, err := c.GetSession(req.AccountPub, sub)
	if err != nil {
		http.Error(w, err.Error(), 502)
		return
	}
	writeJSON(w, map[string]string{"session_json": string(data)})
}

func (s *Server) handleCommandPost(w http.ResponseWriter, r *http.Request) {
	var req sessionReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad json", 400)
		return
	}
	sub, err := req.sub()
	if err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	c := sync.NewClient(req.RelayURL)
	if err := c.PostCommand(req.AccountPub, sub, []byte(req.CommandJSON)); err != nil {
		http.Error(w, err.Error(), 502)
		return
	}
	writeJSON(w, map[string]bool{"ok": true})
}

func (s *Server) handleCommandPull(w http.ResponseWriter, r *http.Request) {
	var req sessionReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad json", 400)
		return
	}
	sub, err := req.sub()
	if err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	c := sync.NewClient(req.RelayURL)
	cmds, err := c.PullCommands(req.AccountPub, sub)
	if err != nil {
		http.Error(w, err.Error(), 502)
		return
	}
	out := make([]string, len(cmds))
	for i, b := range cmds {
		out[i] = string(b)
	}
	writeJSON(w, map[string]interface{}{"commands": out})
}
