package relay

import (
	"testing"
	"time"

	"github.com/goamp/sdk/account"
)

func freshManifest(t *testing.T, version uint64) *account.Manifest {
	t.Helper()
	m, _ := account.NewMnemonic()
	master, _ := account.MasterFromMnemonic(m)
	defer master.Wipe()
	sub, _ := account.NewSubKey()
	now := time.Now().UTC()
	entry, _ := account.BuildDeviceEntry(master, sub.PublicKey, "Mac", "darwin", now)
	mf, _ := account.BuildManifest(master, []account.DeviceEntry{entry}, nil, version, now)
	return mf
}

func TestPutAndGetManifest(t *testing.T) {
	s := NewMemStore()
	mf := freshManifest(t, 1)
	if err := s.PutManifest(mf); err != nil {
		t.Fatal(err)
	}
	got, ok := s.GetManifest(mf.AccountPub)
	if !ok || got.Version != 1 {
		t.Fatal("missing or wrong version")
	}
}

func TestPutManifestRejectsStale(t *testing.T) {
	s := NewMemStore()
	mf := freshManifest(t, 2)
	_ = s.PutManifest(mf)
	stale := *mf
	stale.Version = 2
	if err := s.PutManifest(&stale); err == nil {
		t.Fatal("expected stale-version rejection")
	}
	older := *mf
	older.Version = 1
	if err := s.PutManifest(&older); err == nil {
		t.Fatal("expected older-version rejection")
	}
}

func TestGetManifestMissing(t *testing.T) {
	s := NewMemStore()
	if _, ok := s.GetManifest("nonexistent"); ok {
		t.Fatal("expected missing account")
	}
}

func TestBlobRoundTripAndRetention(t *testing.T) {
	s := NewMemStore()
	acct := "a1b2c3"
	for i := byte(1); i <= 5; i++ {
		s.PutBlob(acct, []byte{i}, time.Now())
	}
	snaps := s.ListBlobs(acct)
	if len(snaps) != 3 {
		t.Fatalf("retention: got %d, want 3", len(snaps))
	}
	latest, ok := s.GetLatestBlob(acct)
	if !ok || len(latest) != 1 || latest[0] != 5 {
		t.Fatal("latest blob wrong")
	}
}

func TestGetBlobMissing(t *testing.T) {
	s := NewMemStore()
	if _, ok := s.GetLatestBlob("nope"); ok {
		t.Fatal("expected missing")
	}
}
