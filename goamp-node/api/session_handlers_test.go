package api

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/goamp/sdk/account"
	"github.com/goamp/sdk/relay"
)

func TestSessionAndCommandsE2E(t *testing.T) {
	relayStore := relay.NewMemStore()
	relaySrv := httptest.NewServer(relay.NewServer(relayStore))
	defer relaySrv.Close()

	// Bootstrap account on relay.
	m, _ := account.NewMnemonic()
	master, _ := account.MasterFromMnemonic(m)
	sub, _ := account.NewSubKey()
	now := time.Now().UTC()
	entry, _ := account.BuildDeviceEntry(master, sub.PublicKey, "Mac", "darwin", now)
	mf, _ := account.BuildManifest(master, []account.DeviceEntry{entry}, nil, 1, now)
	master.Wipe()
	if err := relayStore.PutManifest(mf); err != nil {
		t.Fatal(err)
	}

	srv := New(nil, nil, nil, nil)
	mux := http.NewServeMux()
	srv.RegisterSessionRoutes(mux)
	nodeSrv := httptest.NewServer(mux)
	defer nodeSrv.Close()

	common := map[string]string{
		"account_pub": mf.AccountPub,
		"sub_sk_b64":  base64.StdEncoding.EncodeToString(sub.PrivateKey),
		"relay_url":   relaySrv.URL,
	}
	post := func(t *testing.T, path string, extra map[string]string) (*http.Response, []byte) {
		t.Helper()
		body := map[string]string{}
		for k, v := range common {
			body[k] = v
		}
		for k, v := range extra {
			body[k] = v
		}
		buf, _ := json.Marshal(body)
		resp, err := http.Post(nodeSrv.URL+path, "application/json", bytes.NewReader(buf))
		if err != nil {
			t.Fatal(err)
		}
		data, _ := readAll(resp)
		return resp, data
	}

	resp, _ := post(t, "/session/put", map[string]string{
		"session_json": `{"version":1,"active_device_id":"d","playback_state":"playing"}`,
	})
	if resp.StatusCode != 200 {
		t.Fatalf("session/put status %d", resp.StatusCode)
	}

	resp2, body := post(t, "/session/get", nil)
	if resp2.StatusCode != 200 {
		t.Fatalf("session/get status %d", resp2.StatusCode)
	}
	var getResp struct {
		SessionJSON string `json:"session_json"`
	}
	if err := json.Unmarshal(body, &getResp); err != nil {
		t.Fatalf("session/get unmarshal: %v", err)
	}
	if !strings.Contains(getResp.SessionJSON, `"active_device_id":"d"`) {
		t.Fatalf("session/get session_json: %s", getResp.SessionJSON)
	}

	resp3, _ := post(t, "/commands/post", map[string]string{
		"command_json": `{"op":"pause","issued_by":"x","issued_at_ns":1,"nonce":"AAAA"}`,
	})
	if resp3.StatusCode != 200 {
		t.Fatalf("commands/post status %d", resp3.StatusCode)
	}

	resp4, body4 := post(t, "/commands/pull", nil)
	if resp4.StatusCode != 200 {
		t.Fatalf("commands/pull status %d", resp4.StatusCode)
	}
	var pulled struct {
		Commands []string `json:"commands"`
	}
	_ = json.Unmarshal(body4, &pulled)
	if len(pulled.Commands) != 1 || !strings.Contains(pulled.Commands[0], `"pause"`) {
		t.Fatalf("pulled wrong: %v", pulled.Commands)
	}
}

func readAll(r *http.Response) ([]byte, error) {
	defer r.Body.Close()
	buf := new(bytes.Buffer)
	_, err := buf.ReadFrom(r.Body)
	return buf.Bytes(), err
}
