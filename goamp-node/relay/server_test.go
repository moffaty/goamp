package relay

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/goamp/sdk/account"
)

type accountFixture struct {
	mnemonic account.Mnemonic
	pub      string
	sub      *account.SubKey
	manifest *account.Manifest
}

func newAccountFixture(t *testing.T) accountFixture {
	t.Helper()
	m, _ := account.NewMnemonic()
	master, _ := account.MasterFromMnemonic(m)
	defer master.Wipe()
	sub, _ := account.NewSubKey()
	now := time.Now().UTC()
	entry, _ := account.BuildDeviceEntry(master, sub.PublicKey, "Mac", "darwin", now)
	mf, _ := account.BuildManifest(master, []account.DeviceEntry{entry}, nil, 1, now)
	return accountFixture{m, mf.AccountPub, sub, mf}
}

func newTestServer() (*httptest.Server, *MemStore) {
	store := NewMemStore()
	srv := httptest.NewServer(NewServer(store))
	return srv, store
}

func putJSON(url string, body []byte, sigHdr string) (*http.Response, error) {
	req, _ := http.NewRequest("PUT", url, bytes.NewReader(body))
	req.Header.Set("content-type", "application/json")
	if sigHdr != "" {
		req.Header.Set("X-GOAMP-Sig", sigHdr)
	}
	return http.DefaultClient.Do(req)
}

func TestPutManifestBootstrap(t *testing.T) {
	srv, store := newTestServer()
	defer srv.Close()
	fx := newAccountFixture(t)
	body, _ := json.Marshal(fx.manifest)

	resp, err := putJSON(srv.URL+"/manifest/"+fx.pub, body, "")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		msg, _ := io.ReadAll(resp.Body)
		t.Fatalf("status = %d: %s", resp.StatusCode, msg)
	}
	if _, ok := store.GetManifest(fx.pub); !ok {
		t.Fatal("manifest not stored")
	}
}

func TestPutManifestRejectsStaleVersion(t *testing.T) {
	srv, _ := newTestServer()
	defer srv.Close()
	fx := newAccountFixture(t)
	body1, _ := json.Marshal(fx.manifest)
	_, _ = putJSON(srv.URL+"/manifest/"+fx.pub, body1, "")

	stale := *fx.manifest
	stale.Version = 1
	body2, _ := json.Marshal(&stale)
	// Sign v2 attempt with original sub (it's active in stored v1).
	hdr, _ := SignRequest(fx.sub, "PUT", "/manifest/"+fx.pub, body2, time.Now().UnixNano())
	resp, _ := putJSON(srv.URL+"/manifest/"+fx.pub, body2, hdr)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("status = %d want 409", resp.StatusCode)
	}
}

func TestPutManifestRejectsInvalidSignature(t *testing.T) {
	srv, _ := newTestServer()
	defer srv.Close()
	fx := newAccountFixture(t)
	broken := *fx.manifest
	broken.MasterSig = "aGVsbG8="
	body, _ := json.Marshal(&broken)
	resp, _ := putJSON(srv.URL+"/manifest/"+fx.pub, body, "")
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d want 400", resp.StatusCode)
	}
}

func TestGetManifestPublic(t *testing.T) {
	srv, store := newTestServer()
	defer srv.Close()
	fx := newAccountFixture(t)
	_ = store.PutManifest(fx.manifest)

	resp, _ := http.Get(srv.URL + "/manifest/" + fx.pub)
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	var got account.Manifest
	_ = json.NewDecoder(resp.Body).Decode(&got)
	if got.AccountPub != fx.pub {
		t.Fatal("mismatched account_pub")
	}
}

func TestPutStateRequiresActiveSig(t *testing.T) {
	srv, store := newTestServer()
	defer srv.Close()
	fx := newAccountFixture(t)
	_ = store.PutManifest(fx.manifest)

	body := []byte("ciphertext")
	hdr, _ := SignRequest(fx.sub, "PUT", "/state/"+fx.pub, body, time.Now().UnixNano())
	resp, err := putJSON(srv.URL+"/state/"+fx.pub, body, hdr)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		msg, _ := io.ReadAll(resp.Body)
		t.Fatalf("status = %d: %s", resp.StatusCode, msg)
	}
	blob, ok := store.GetLatestBlob(fx.pub)
	if !ok || string(blob) != "ciphertext" {
		t.Fatal("blob not stored")
	}
}

func TestPutStateRejectsUnsignedRequest(t *testing.T) {
	srv, store := newTestServer()
	defer srv.Close()
	fx := newAccountFixture(t)
	_ = store.PutManifest(fx.manifest)
	resp, _ := putJSON(srv.URL+"/state/"+fx.pub, []byte("x"), "")
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d", resp.StatusCode)
	}
}

func TestPutStateRejectsRevokedDevice(t *testing.T) {
	srv, store := newTestServer()
	defer srv.Close()
	fx := newAccountFixture(t)
	m, _ := account.MasterFromMnemonic(fx.mnemonic)
	defer m.Wipe()
	revoked := []account.RevokedEntry{{
		SubPub:    hex.EncodeToString(fx.sub.PublicKey),
		RevokedAt: time.Now().UTC(),
		Reason:    "test",
	}}
	newSub, _ := account.NewSubKey()
	entry2, _ := account.BuildDeviceEntry(m, newSub.PublicKey, "Phone", "ios", time.Now().UTC())
	mf2, _ := account.BuildManifest(m, []account.DeviceEntry{entry2}, revoked, 2, time.Now().UTC())
	_ = store.PutManifest(mf2)

	body := []byte("x")
	hdr, _ := SignRequest(fx.sub, "PUT", "/state/"+fx.pub, body, time.Now().UnixNano())
	resp, _ := putJSON(srv.URL+"/state/"+fx.pub, body, hdr)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d want 401", resp.StatusCode)
	}
}

func TestPutManifestAcceptsSignerActiveInNewManifest(t *testing.T) {
	srv, store := newTestServer()
	defer srv.Close()
	fx := newAccountFixture(t)
	_ = store.PutManifest(fx.manifest)

	m, _ := account.MasterFromMnemonic(fx.mnemonic)
	defer m.Wipe()
	newSub, _ := account.NewSubKey()
	oldEntry := fx.manifest.Devices[0]
	newEntry, _ := account.BuildDeviceEntry(m, newSub.PublicKey, "Phone", "ios", time.Now().UTC())
	mf2, _ := account.BuildManifest(m, []account.DeviceEntry{oldEntry, newEntry}, nil, 2, time.Now().UTC())
	body, _ := json.Marshal(mf2)
	hdr, _ := SignRequest(newSub, "PUT", "/manifest/"+fx.pub, body, time.Now().UnixNano())
	resp, _ := putJSON(srv.URL+"/manifest/"+fx.pub, body, hdr)
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		msg, _ := io.ReadAll(resp.Body)
		t.Fatalf("status = %d: %s", resp.StatusCode, msg)
	}
}

func TestGetStateRoundTrip(t *testing.T) {
	srv, store := newTestServer()
	defer srv.Close()
	fx := newAccountFixture(t)
	_ = store.PutManifest(fx.manifest)
	store.PutBlob(fx.pub, []byte("secret"), time.Now())

	hdr, _ := SignRequest(fx.sub, "GET", "/state/"+fx.pub, nil, time.Now().UnixNano())
	req, _ := http.NewRequest("GET", srv.URL+"/state/"+fx.pub, nil)
	req.Header.Set("X-GOAMP-Sig", hdr)
	resp, _ := http.DefaultClient.Do(req)
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	data, _ := io.ReadAll(resp.Body)
	if string(data) != "secret" {
		t.Fatalf("got %q", data)
	}
}
