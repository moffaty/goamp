package api

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/goamp/sdk/account"
	"github.com/goamp/sdk/relay"
)

func TestStateSyncUpDown(t *testing.T) {
	store := relay.NewMemStore()
	relaySrv := httptest.NewServer(relay.NewServer(store))
	defer relaySrv.Close()

	m, _ := account.NewMnemonic()
	master, _ := account.MasterFromMnemonic(m)
	sub, _ := account.NewSubKey()
	now := time.Now().UTC()
	entry, _ := account.BuildDeviceEntry(master, sub.PublicKey, "Mac", "darwin", now)
	mf, _ := account.BuildManifest(master, []account.DeviceEntry{entry}, nil, 1, now)
	master.Wipe()
	if err := store.PutManifest(mf); err != nil {
		t.Fatal(err)
	}

	var stateKey [32]byte
	for i := range stateKey {
		stateKey[i] = byte(i)
	}

	srv := New(nil, nil, nil, nil)
	mux := http.NewServeMux()
	srv.RegisterStateSyncRoutes(mux)
	nodeSrv := httptest.NewServer(mux)
	defer nodeSrv.Close()

	upBody, _ := json.Marshal(map[string]string{
		"account_pub":   mf.AccountPub,
		"sub_sk_b64":    base64.StdEncoding.EncodeToString(sub.PrivateKey),
		"state_key_b64": base64.StdEncoding.EncodeToString(stateKey[:]),
		"plaintext_b64": base64.StdEncoding.EncodeToString([]byte(`{"liked":true}`)),
		"relay_url":     relaySrv.URL,
	})
	resp, err := http.Post(nodeSrv.URL+"/state/sync-up", "application/json", bytes.NewReader(upBody))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("up status = %d", resp.StatusCode)
	}

	downBody, _ := json.Marshal(map[string]string{
		"account_pub":   mf.AccountPub,
		"sub_sk_b64":    base64.StdEncoding.EncodeToString(sub.PrivateKey),
		"state_key_b64": base64.StdEncoding.EncodeToString(stateKey[:]),
		"relay_url":     relaySrv.URL,
	})
	resp2, _ := http.Post(nodeSrv.URL+"/state/sync-down", "application/json", bytes.NewReader(downBody))
	defer resp2.Body.Close()
	if resp2.StatusCode != 200 {
		t.Fatalf("down status = %d", resp2.StatusCode)
	}
	var out struct {
		PlaintextB64 string `json:"plaintext_b64"`
	}
	_ = json.NewDecoder(resp2.Body).Decode(&out)
	got, _ := base64.StdEncoding.DecodeString(out.PlaintextB64)
	if string(got) != `{"liked":true}` {
		t.Fatalf("got %q", got)
	}
}

func TestStateSyncUpRejectsBadKey(t *testing.T) {
	srv := New(nil, nil, nil, nil)
	mux := http.NewServeMux()
	srv.RegisterStateSyncRoutes(mux)
	nodeSrv := httptest.NewServer(mux)
	defer nodeSrv.Close()

	body, _ := json.Marshal(map[string]string{
		"account_pub":   "deadbeef",
		"sub_sk_b64":    "not-base64!",
		"state_key_b64": base64.StdEncoding.EncodeToString(make([]byte, 32)),
		"relay_url":     "http://unused",
	})
	resp, _ := http.Post(nodeSrv.URL+"/state/sync-up", "application/json", bytes.NewReader(body))
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d want 400", resp.StatusCode)
	}
}
