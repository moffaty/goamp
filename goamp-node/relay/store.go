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

type sessionEntry struct {
	Data    []byte
	Version uint64
}

// MemStore is an in-memory MVP backend. Prod will swap for S3 + Redis.
type MemStore struct {
	mu        sync.RWMutex
	manifests map[string]*account.Manifest
	blobs     map[string][]blobSnapshot
	sessions  map[string]sessionEntry
	commands  map[string][][]byte
}

func NewMemStore() *MemStore {
	return &MemStore{
		manifests: map[string]*account.Manifest{},
		blobs:     map[string][]blobSnapshot{},
		sessions:  map[string]sessionEntry{},
		commands:  map[string][][]byte{},
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

// PutSession accepts only newer Lamport versions.
func (s *MemStore) PutSession(accountPub string, version uint64, data []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if cur, ok := s.sessions[accountPub]; ok {
		if version <= cur.Version {
			return fmt.Errorf("stale session version %d (current %d)", version, cur.Version)
		}
	}
	s.sessions[accountPub] = sessionEntry{Data: append([]byte(nil), data...), Version: version}
	return nil
}

func (s *MemStore) GetSession(accountPub string) ([]byte, uint64, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	cur, ok := s.sessions[accountPub]
	if !ok {
		return nil, 0, false
	}
	return append([]byte(nil), cur.Data...), cur.Version, true
}

func (s *MemStore) EnqueueCommand(accountPub string, raw []byte) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.commands[accountPub] = append(s.commands[accountPub], append([]byte(nil), raw...))
}

// DrainCommands returns and clears the queue for accountPub.
func (s *MemStore) DrainCommands(accountPub string) [][]byte {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := s.commands[accountPub]
	delete(s.commands, accountPub)
	return out
}
