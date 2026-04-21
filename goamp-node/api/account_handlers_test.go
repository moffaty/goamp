package api

import (
	"bytes"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/goamp/sdk/account"
	"github.com/goamp/sdk/relay"
)

func testServer(t *testing.T) *httptest.Server {
	t.Helper()
	srv := New(nil, nil, nil, nil)
	mux := http.NewServeMux()
	srv.RegisterAccountRoutes(mux)
	return httptest.NewServer(mux)
}

func TestAccountCreateReturnsMnemonicAndManifest(t *testing.T) {
	ts := testServer(t)
	defer ts.Close()

	body := []byte(`{"device_name":"Mac","os":"darwin"}`)
	resp, err := http.Post(ts.URL+"/account/create", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	var out struct {
		Mnemonic   string          `json:"mnemonic"`
		AccountPub string          `json:"account_pub"`
		SubPub     string          `json:"sub_pub"`
		SubSk      string          `json:"sub_sk"`
		StateKey   string          `json:"state_key"`
		Manifest   json.RawMessage `json:"manifest"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	if w := len(strings.Fields(out.Mnemonic)); w != 12 {
		t.Fatalf("mnemonic word count = %d", w)
	}
	if out.AccountPub == "" || out.SubPub == "" || out.SubSk == "" || out.StateKey == "" {
		t.Fatal("missing fields")
	}
	if len(out.Manifest) == 0 {
		t.Fatal("empty manifest")
	}
}

func TestAccountLoadReturnsAccountPub(t *testing.T) {
	ts := testServer(t)
	defer ts.Close()

	resp, _ := http.Post(ts.URL+"/account/create", "application/json",
		strings.NewReader(`{"device_name":"Mac","os":"darwin"}`))
	var created struct {
		Mnemonic   string `json:"mnemonic"`
		AccountPub string `json:"account_pub"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&created)
	resp.Body.Close()

	loadBody, _ := json.Marshal(map[string]string{"mnemonic": created.Mnemonic})
	r2, err := http.Post(ts.URL+"/account/load", "application/json", bytes.NewReader(loadBody))
	if err != nil {
		t.Fatal(err)
	}
	defer r2.Body.Close()
	if r2.StatusCode != 200 {
		t.Fatalf("status = %d", r2.StatusCode)
	}
	var loaded struct {
		AccountPub string `json:"account_pub"`
		StateKey   string `json:"state_key"`
	}
	_ = json.NewDecoder(r2.Body).Decode(&loaded)
	if loaded.AccountPub != created.AccountPub {
		t.Fatalf("account_pub mismatch: got %q, want %q", loaded.AccountPub, created.AccountPub)
	}
	if loaded.StateKey == "" {
		t.Fatal("empty state_key")
	}
}

func TestAccountLoadRejectsInvalidMnemonic(t *testing.T) {
	ts := testServer(t)
	defer ts.Close()
	body := []byte(`{"mnemonic":"not a valid mnemonic"}`)
	resp, _ := http.Post(ts.URL+"/account/load", "application/json", bytes.NewReader(body))
	defer resp.Body.Close()
	if resp.StatusCode != 400 {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
}

func TestAccountVerifyManifestAcceptsGood(t *testing.T) {
	ts := testServer(t)
	defer ts.Close()

	resp, _ := http.Post(ts.URL+"/account/create", "application/json",
		strings.NewReader(`{"device_name":"Mac","os":"darwin"}`))
	var created struct {
		Manifest json.RawMessage `json:"manifest"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&created)
	resp.Body.Close()

	r2, _ := http.Post(ts.URL+"/account/verify-manifest", "application/json",
		bytes.NewReader(created.Manifest))
	defer r2.Body.Close()
	if r2.StatusCode != 200 {
		t.Fatalf("status = %d", r2.StatusCode)
	}
	var v struct {
		Valid bool `json:"valid"`
	}
	_ = json.NewDecoder(r2.Body).Decode(&v)
	if !v.Valid {
		t.Fatal("expected valid=true")
	}
}

func TestAccountRecoverAddsDevice(t *testing.T) {
	relayStore := relay.NewMemStore()
	relaySrv := httptest.NewServer(relay.NewServer(relayStore))
	defer relaySrv.Close()

	ts := testServer(t)
	defer ts.Close()
	resp, _ := http.Post(ts.URL+"/account/create", "application/json",
		strings.NewReader(`{"device_name":"Mac","os":"darwin"}`))
	var created struct {
		Mnemonic   string            `json:"mnemonic"`
		AccountPub string            `json:"account_pub"`
		Manifest   *account.Manifest `json:"manifest"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&created)
	resp.Body.Close()
	_ = relayStore.PutManifest(created.Manifest)

	body, _ := json.Marshal(map[string]string{
		"mnemonic":    created.Mnemonic,
		"device_name": "Phone",
		"os":          "ios",
		"relay_url":   relaySrv.URL,
	})
	r2, _ := http.Post(ts.URL+"/account/recover", "application/json", bytes.NewReader(body))
	defer r2.Body.Close()
	if r2.StatusCode != 200 {
		msg, _ := io.ReadAll(r2.Body)
		t.Fatalf("status = %d: %s", r2.StatusCode, msg)
	}
	var out struct {
		AccountPub      string `json:"account_pub"`
		ManifestVersion uint64 `json:"manifest_version"`
	}
	_ = json.NewDecoder(r2.Body).Decode(&out)
	if out.AccountPub != created.AccountPub {
		t.Fatal("account_pub mismatch")
	}
	if out.ManifestVersion != 2 {
		t.Fatalf("version = %d", out.ManifestVersion)
	}
	mf, ok := relayStore.GetManifest(created.AccountPub)
	if !ok || mf.Version != 2 || len(mf.Devices) != 2 {
		t.Fatalf("relay manifest: version=%d devices=%d", mf.Version, len(mf.Devices))
	}
}

func TestAccountListDevices(t *testing.T) {
	relayStore := relay.NewMemStore()
	relaySrv := httptest.NewServer(relay.NewServer(relayStore))
	defer relaySrv.Close()

	m, _ := account.NewMnemonic()
	master, _ := account.MasterFromMnemonic(m)
	sub1, _ := account.NewSubKey()
	sub2, _ := account.NewSubKey()
	now := time.Now().UTC()
	e1, _ := account.BuildDeviceEntry(master, sub1.PublicKey, "Mac", "darwin", now)
	e2, _ := account.BuildDeviceEntry(master, sub2.PublicKey, "Phone", "ios", now)
	mf, _ := account.BuildManifest(master, []account.DeviceEntry{e1, e2}, nil, 1, now)
	master.Wipe()
	_ = relayStore.PutManifest(mf)

	ts := testServer(t)
	defer ts.Close()
	resp, _ := http.Get(ts.URL + "/account/list-devices?account_pub=" + mf.AccountPub + "&relay_url=" + relaySrv.URL)
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	var out struct {
		Devices []account.DeviceEntry `json:"devices"`
		Version uint64                `json:"version"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&out)
	if out.Version != 1 || len(out.Devices) != 2 {
		t.Fatalf("got version=%d devices=%d", out.Version, len(out.Devices))
	}
}

func TestAccountRevokeDevice(t *testing.T) {
	relayStore := relay.NewMemStore()
	relaySrv := httptest.NewServer(relay.NewServer(relayStore))
	defer relaySrv.Close()

	m, _ := account.NewMnemonic()
	master, _ := account.MasterFromMnemonic(m)
	sub1, _ := account.NewSubKey()
	sub2, _ := account.NewSubKey()
	now := time.Now().UTC()
	e1, _ := account.BuildDeviceEntry(master, sub1.PublicKey, "Mac", "darwin", now)
	e2, _ := account.BuildDeviceEntry(master, sub2.PublicKey, "Phone", "ios", now)
	mf, _ := account.BuildManifest(master, []account.DeviceEntry{e1, e2}, nil, 1, now)
	master.Wipe()
	_ = relayStore.PutManifest(mf)

	ts := testServer(t)
	defer ts.Close()

	sub2Hex := hex.EncodeToString(sub2.PublicKey)
	body, _ := json.Marshal(map[string]string{
		"mnemonic":          string(m),
		"sub_sk_b64":        base64.StdEncoding.EncodeToString(sub1.PrivateKey),
		"sub_pub_to_revoke": sub2Hex,
		"reason":            "lost",
		"relay_url":         relaySrv.URL,
	})
	resp, _ := http.Post(ts.URL+"/account/revoke", "application/json", bytes.NewReader(body))
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		msg, _ := io.ReadAll(resp.Body)
		t.Fatalf("status = %d: %s", resp.StatusCode, msg)
	}

	updated, _ := relayStore.GetManifest(mf.AccountPub)
	if updated.Version != 2 {
		t.Fatalf("version = %d", updated.Version)
	}
	if len(updated.Devices) != 1 {
		t.Fatalf("devices = %d want 1", len(updated.Devices))
	}
	if updated.Devices[0].SubPub == sub2Hex {
		t.Fatal("revoked device still active")
	}
	if len(updated.Revoked) != 1 || updated.Revoked[0].SubPub != sub2Hex {
		t.Fatal("revoked list wrong")
	}
}
