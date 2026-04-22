package sync

import (
	"net/http/httptest"
	"testing"
	"time"

	"github.com/goamp/sdk/account"
	"github.com/goamp/sdk/relay"
)

func TestE2EBootstrapThenAddDevice(t *testing.T) {
	store := relay.NewMemStore()
	srv := httptest.NewServer(relay.NewServer(store))
	defer srv.Close()
	c := NewClient(srv.URL)

	// v1 — bootstrap.
	m, _ := account.NewMnemonic()
	master, _ := account.MasterFromMnemonic(m)
	sub1, _ := account.NewSubKey()
	now := time.Now().UTC()
	entry1, _ := account.BuildDeviceEntry(master, sub1.PublicKey, "Mac", "darwin", now)
	mf1, _ := account.BuildManifest(master, []account.DeviceEntry{entry1}, nil, 1, now)
	master.Wipe()

	if err := c.PutManifest(mf1, nil); err != nil {
		t.Fatal(err)
	}

	// Push + pull state.
	if err := c.PutState(mf1.AccountPub, sub1, []byte("blob-v1")); err != nil {
		t.Fatal(err)
	}
	got, err := c.GetState(mf1.AccountPub, sub1)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "blob-v1" {
		t.Fatalf("got %q", got)
	}

	// v2 — add phone, signed by sub1.
	master2, _ := account.MasterFromMnemonic(m)
	sub2, _ := account.NewSubKey()
	entry2a, _ := account.BuildDeviceEntry(master2, sub1.PublicKey, "Mac", "darwin", now)
	entry2b, _ := account.BuildDeviceEntry(master2, sub2.PublicKey, "Phone", "ios", time.Now().UTC())
	mf2, _ := account.BuildManifest(master2, []account.DeviceEntry{entry2a, entry2b}, nil, 2, time.Now().UTC())
	master2.Wipe()

	if err := c.PutManifest(mf2, sub1); err != nil {
		t.Fatalf("v2 put: %v", err)
	}

	// sub2 can now authenticate state calls.
	if err := c.PutState(mf2.AccountPub, sub2, []byte("blob-v2")); err != nil {
		t.Fatalf("state as new device: %v", err)
	}
}
