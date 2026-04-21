package relay

import (
	"fmt"
	"sync"
	"time"

	"github.com/goamp/sdk/account"
)

const blobRetention = 3

type blobSnapshot struct {
	Data     []byte
	StoredAt time.Time
}

// MemStore is an in-memory MVP backend. Prod will swap for S3 + Redis.
type MemStore struct {
	mu        sync.RWMutex
	manifests map[string]*account.Manifest
	blobs     map[string][]blobSnapshot
}

func NewMemStore() *MemStore {
	return &MemStore{
		manifests: map[string]*account.Manifest{},
		blobs:     map[string][]blobSnapshot{},
	}
}

// PutManifest stores only if version is strictly greater than current.
// Caller must verify signatures first.
func (s *MemStore) PutManifest(m *account.Manifest) error {
	if m == nil || m.AccountPub == "" {
		return fmt.Errorf("nil or empty account_pub")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if prev, ok := s.manifests[m.AccountPub]; ok {
		if m.Version <= prev.Version {
			return fmt.Errorf("stale version %d (current %d)", m.Version, prev.Version)
		}
	}
	s.manifests[m.AccountPub] = m
	return nil
}

func (s *MemStore) GetManifest(accountPub string) (*account.Manifest, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	m, ok := s.manifests[accountPub]
	return m, ok
}

func (s *MemStore) IsRevoked(accountPub, subPubHex string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	m, ok := s.manifests[accountPub]
	if !ok {
		return false
	}
	for _, r := range m.Revoked {
		if r.SubPub == subPubHex {
			return true
		}
	}
	return false
}

func (s *MemStore) IsActive(accountPub, subPubHex string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	m, ok := s.manifests[accountPub]
	if !ok {
		return false
	}
	for _, d := range m.Devices {
		if d.SubPub == subPubHex {
			return true
		}
	}
	return false
}

func (s *MemStore) PutBlob(accountPub string, data []byte, at time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	buf := s.blobs[accountPub]
	buf = append(buf, blobSnapshot{Data: append([]byte(nil), data...), StoredAt: at})
	if len(buf) > blobRetention {
		buf = buf[len(buf)-blobRetention:]
	}
	s.blobs[accountPub] = buf
}

func (s *MemStore) GetLatestBlob(accountPub string) ([]byte, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	buf := s.blobs[accountPub]
	if len(buf) == 0 {
		return nil, false
	}
	return append([]byte(nil), buf[len(buf)-1].Data...), true
}

func (s *MemStore) ListBlobs(accountPub string) []blobSnapshot {
	s.mu.RLock()
	defer s.mu.RUnlock()
	buf := s.blobs[accountPub]
	out := make([]blobSnapshot, len(buf))
	copy(out, buf)
	return out
}
