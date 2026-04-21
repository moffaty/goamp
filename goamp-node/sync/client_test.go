package sync

import (
	"net/http/httptest"
	"testing"
	"time"

	"github.com/goamp/sdk/account"
	"github.com/goamp/sdk/relay"
)

func bootstrap(t *testing.T) (*Client, *account.SubKey, account.Mnemonic) {
	t.Helper()
	store := relay.NewMemStore()
	srv := httptest.NewServer(relay.NewServer(store))
	t.Cleanup(srv.Close)

	m, _ := account.NewMnemonic()
	master, _ := account.MasterFromMnemonic(m)
	defer master.Wipe()
	sub, _ := account.NewSubKey()
	now := time.Now().UTC()
	entry, _ := account.BuildDeviceEntry(master, sub.PublicKey, "Mac", "darwin", now)
	mf, _ := account.BuildManifest(master, []account.DeviceEntry{entry}, nil, 1, now)

	c := NewClient(srv.URL)
	if err := c.PutManifest(mf, nil); err != nil {
		t.Fatal(err)
	}
	return c, sub, m
}

func TestPutAndGetManifest(t *testing.T) {
	c, _, _ := bootstrap(t)
	mf, err := c.GetManifest(c.lastAccountPub())
	if err != nil {
		t.Fatal(err)
	}
	if mf.Version != 1 {
		t.Fatalf("version = %d", mf.Version)
	}
}

func TestPutAndGetState(t *testing.T) {
	c, sub, _ := bootstrap(t)
	if err := c.PutState(c.lastAccountPub(), sub, []byte("ciphertext")); err != nil {
		t.Fatal(err)
	}
	blob, err := c.GetState(c.lastAccountPub(), sub)
	if err != nil {
		t.Fatal(err)
	}
	if string(blob) != "ciphertext" {
		t.Fatalf("got %q", blob)
	}
}

func TestSyncUpDownForRoundTrip(t *testing.T) {
	c, sub, _ := bootstrap(t)
	var key [32]byte
	for i := range key {
		key[i] = byte(i)
	}
	plain := []byte("state-blob")
	if err := c.SyncUpFor(c.lastAccountPub(), key[:], sub, plain); err != nil {
		t.Fatal(err)
	}
	got, err := c.SyncDownFor(c.lastAccountPub(), key[:], sub)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "state-blob" {
		t.Fatalf("got %q", got)
	}
}

func TestSyncDownForMissingReturnsNil(t *testing.T) {
	c, sub, _ := bootstrap(t)
	var key [32]byte
	got, err := c.SyncDownFor(c.lastAccountPub(), key[:], sub)
	if err != nil {
		t.Fatal(err)
	}
	if got != nil {
		t.Fatal("expected nil on missing blob")
	}
}
