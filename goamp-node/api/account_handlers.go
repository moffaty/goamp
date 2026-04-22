package api

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"time"

	"github.com/goamp/sdk/account"
	gosync "github.com/goamp/sdk/sync"
)

// RegisterAccountRoutes wires /account/* handlers onto mux.
func (s *Server) RegisterAccountRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /account/create", s.handleAccountCreate)
	mux.HandleFunc("POST /account/load", s.handleAccountLoad)
	mux.HandleFunc("POST /account/sign-manifest", s.handleAccountSignManifest)
	mux.HandleFunc("POST /account/verify-manifest", s.handleAccountVerifyManifest)
	mux.HandleFunc("POST /account/recover", s.handleAccountRecover)
	mux.HandleFunc("GET /account/list-devices", s.handleAccountListDevices)
	mux.HandleFunc("POST /account/revoke", s.handleAccountRevoke)
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

type recoverReq struct {
	Mnemonic   string `json:"mnemonic"`
	DeviceName string `json:"device_name"`
	OS         string `json:"os"`
	RelayURL   string `json:"relay_url"`
}

type recoverResp struct {
	AccountPub      string `json:"account_pub"`
	SubPub          string `json:"sub_pub"`
	SubSk           string `json:"sub_sk"`
	StateKey        string `json:"state_key"`
	ManifestVersion uint64 `json:"manifest_version"`
}

func (s *Server) handleAccountRecover(w http.ResponseWriter, r *http.Request) {
	var req recoverReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad json", 400)
		return
	}
	if req.DeviceName == "" || req.OS == "" || req.RelayURL == "" {
		http.Error(w, "device_name, os, relay_url required", 400)
		return
	}
	mnem := account.Mnemonic(req.Mnemonic)
	master, err := account.MasterFromMnemonic(mnem)
	if err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	defer master.Wipe()
	accountPub := hex.EncodeToString(master.PublicKey)

	client := gosync.NewClient(req.RelayURL)
	prev, err := client.GetManifest(accountPub)
	if err != nil {
		http.Error(w, "fetch manifest: "+err.Error(), 502)
		return
	}
	newSub, err := account.NewSubKey()
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	now := time.Now().UTC()
	newEntry, err := account.BuildDeviceEntry(master, newSub.PublicKey, req.DeviceName, req.OS, now)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	devices := append([]account.DeviceEntry{}, prev.Devices...)
	devices = append(devices, newEntry)
	version := prev.Version + 1
	mf, err := account.BuildManifest(master, devices, prev.Revoked, version, now)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	if err := client.PutManifest(mf, newSub); err != nil {
		http.Error(w, "push manifest: "+err.Error(), 502)
		return
	}
	stateKey, err := account.DeriveStateKey(mnem, account.StateKeyV1)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	writeJSON(w, recoverResp{
		AccountPub:      accountPub,
		SubPub:          hex.EncodeToString(newSub.PublicKey),
		SubSk:           base64.StdEncoding.EncodeToString(newSub.PrivateKey),
		StateKey:        base64.StdEncoding.EncodeToString(stateKey),
		ManifestVersion: mf.Version,
	})
}

type listDevicesResp struct {
	Devices []account.DeviceEntry  `json:"devices"`
	Revoked []account.RevokedEntry `json:"revoked"`
	Version uint64                 `json:"version"`
}

func (s *Server) handleAccountListDevices(w http.ResponseWriter, r *http.Request) {
	accountPub := r.URL.Query().Get("account_pub")
	relayURL := r.URL.Query().Get("relay_url")
	if accountPub == "" || relayURL == "" {
		http.Error(w, "account_pub and relay_url required", 400)
		return
	}
	client := gosync.NewClient(relayURL)
	mf, err := client.GetManifest(accountPub)
	if err != nil {
		http.Error(w, err.Error(), 502)
		return
	}
	writeJSON(w, listDevicesResp{
		Devices: mf.Devices,
		Revoked: mf.Revoked,
		Version: mf.Version,
	})
}

type revokeReq struct {
	Mnemonic        string `json:"mnemonic"`
	SubSkB64        string `json:"sub_sk_b64"`
	SubPubToRevoke  string `json:"sub_pub_to_revoke"`
	Reason          string `json:"reason"`
	RelayURL        string `json:"relay_url"`
}

func (s *Server) handleAccountRevoke(w http.ResponseWriter, r *http.Request) {
	var req revokeReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad json", 400)
		return
	}
	if req.SubPubToRevoke == "" || req.RelayURL == "" {
		http.Error(w, "sub_pub_to_revoke, relay_url required", 400)
		return
	}
	mnem := account.Mnemonic(req.Mnemonic)
	master, err := account.MasterFromMnemonic(mnem)
	if err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	defer master.Wipe()
	accountPub := hex.EncodeToString(master.PublicKey)

	skBytes, err := base64.StdEncoding.DecodeString(req.SubSkB64)
	if err != nil || len(skBytes) != ed25519.PrivateKeySize {
		http.Error(w, "sub_sk_b64 invalid", 400)
		return
	}
	sk := ed25519.PrivateKey(skBytes)
	pub, _ := sk.Public().(ed25519.PublicKey)
	callerSub := &account.SubKey{PrivateKey: sk, PublicKey: pub}

	client := gosync.NewClient(req.RelayURL)
	prev, err := client.GetManifest(accountPub)
	if err != nil {
		http.Error(w, "fetch manifest: "+err.Error(), 502)
		return
	}
	remaining := make([]account.DeviceEntry, 0, len(prev.Devices))
	var removed bool
	for _, d := range prev.Devices {
		if d.SubPub == req.SubPubToRevoke {
			removed = true
			continue
		}
		remaining = append(remaining, d)
	}
	if !removed {
		http.Error(w, "sub_pub not in current devices", 404)
		return
	}
	if len(remaining) == 0 {
		http.Error(w, "cannot revoke last device", 400)
		return
	}
	now := time.Now().UTC()
	revokedList := append([]account.RevokedEntry{}, prev.Revoked...)
	revokedList = append(revokedList, account.RevokedEntry{
		SubPub:    req.SubPubToRevoke,
		RevokedAt: now,
		Reason:    req.Reason,
	})
	mf, err := account.BuildManifest(master, remaining, revokedList, prev.Version+1, now)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	if err := client.PutManifest(mf, callerSub); err != nil {
		http.Error(w, "push manifest: "+err.Error(), 502)
		return
	}
	writeJSON(w, map[string]interface{}{
		"ok":               true,
		"manifest_version": mf.Version,
	})
}
