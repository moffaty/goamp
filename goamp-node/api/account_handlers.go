package api

import (
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"time"

	"github.com/goamp/sdk/account"
)

// RegisterAccountRoutes wires /account/* handlers onto mux.
func (s *Server) RegisterAccountRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /account/create", s.handleAccountCreate)
	mux.HandleFunc("POST /account/load", s.handleAccountLoad)
	mux.HandleFunc("POST /account/sign-manifest", s.handleAccountSignManifest)
	mux.HandleFunc("POST /account/verify-manifest", s.handleAccountVerifyManifest)
}

type createReq struct {
	DeviceName string `json:"device_name"`
	OS         string `json:"os"`
}

type createResp struct {
	Mnemonic   string            `json:"mnemonic"`
	AccountPub string            `json:"account_pub"`
	SubPub     string            `json:"sub_pub"`
	SubSk      string            `json:"sub_sk"`
	StateKey   string            `json:"state_key"`
	Manifest   *account.Manifest `json:"manifest"`
}

func (s *Server) handleAccountCreate(w http.ResponseWriter, r *http.Request) {
	var req createReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad json: "+err.Error(), 400)
		return
	}
	if req.DeviceName == "" || req.OS == "" {
		http.Error(w, "device_name and os required", 400)
		return
	}

	mnem, err := account.NewMnemonic()
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	master, err := account.MasterFromMnemonic(mnem)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	defer master.Wipe()

	sub, err := account.NewSubKey()
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	now := time.Now().UTC()
	entry, err := account.BuildDeviceEntry(master, sub.PublicKey, req.DeviceName, req.OS, now)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	mf, err := account.BuildManifest(master, []account.DeviceEntry{entry}, nil, 1, now)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	stateKey, err := account.DeriveStateKey(mnem, account.StateKeyV1)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}

	writeJSON(w, createResp{
		Mnemonic:   string(mnem),
		AccountPub: hex.EncodeToString(master.PublicKey),
		SubPub:     hex.EncodeToString(sub.PublicKey),
		SubSk:      base64.StdEncoding.EncodeToString(sub.PrivateKey),
		StateKey:   base64.StdEncoding.EncodeToString(stateKey),
		Manifest:   mf,
	})
}

type loadReq struct {
	Mnemonic string `json:"mnemonic"`
}

type loadResp struct {
	AccountPub string `json:"account_pub"`
	StateKey   string `json:"state_key"`
}

func (s *Server) handleAccountLoad(w http.ResponseWriter, r *http.Request) {
	var req loadReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad json: "+err.Error(), 400)
		return
	}
	mnem := account.Mnemonic(req.Mnemonic)
	master, err := account.MasterFromMnemonic(mnem)
	if err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	defer master.Wipe()
	stateKey, err := account.DeriveStateKey(mnem, account.StateKeyV1)
	if err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	writeJSON(w, loadResp{
		AccountPub: hex.EncodeToString(master.PublicKey),
		StateKey:   base64.StdEncoding.EncodeToString(stateKey),
	})
}

type signManifestReq struct {
	Mnemonic string                 `json:"mnemonic"`
	Version  uint64                 `json:"version"`
	Devices  []account.DeviceEntry  `json:"devices"`
	Revoked  []account.RevokedEntry `json:"revoked"`
}

func (s *Server) handleAccountSignManifest(w http.ResponseWriter, r *http.Request) {
	var req signManifestReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad json: "+err.Error(), 400)
		return
	}
	master, err := account.MasterFromMnemonic(account.Mnemonic(req.Mnemonic))
	if err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	defer master.Wipe()
	mf, err := account.BuildManifest(master, req.Devices, req.Revoked, req.Version, time.Now().UTC())
	if err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	writeJSON(w, mf)
}

func (s *Server) handleAccountVerifyManifest(w http.ResponseWriter, r *http.Request) {
	var mf account.Manifest
	if err := json.NewDecoder(r.Body).Decode(&mf); err != nil {
		http.Error(w, "bad json: "+err.Error(), 400)
		return
	}
	verr := account.VerifyManifest(&mf)
	writeJSON(w, map[string]interface{}{
		"valid": verr == nil,
		"error": errString(verr),
	})
}

func errString(e error) string {
	if e == nil {
		return ""
	}
	return e.Error()
}

func writeJSON(w http.ResponseWriter, v interface{}) {
	w.Header().Set("content-type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}
