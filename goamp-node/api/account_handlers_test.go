package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
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
