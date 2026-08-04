// Package archive implements the Archive interface with local file storage.
package archive

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"

	"github.com/goamp/sdk/sdk"
)

// LocalArchive stores raw audio fragments as files under a configurable directory.
type LocalArchive struct {
	dir   string
	quota sdk.StorageQuota
	used  int64
	count int
}

// New creates a LocalArchive and scans dir so usage is accurate across restarts.
// quotaGB = 0 means unlimited.
func New(dir string, quotaGB int64) *LocalArchive {
	a := &LocalArchive{
		dir: dir,
		quota: sdk.StorageQuota{
			TotalBytes: quotaGB * 1024 * 1024 * 1024,
		},
	}
	a.scan()
	return a
}

// scan seeds used/count from files already on disk.
func (a *LocalArchive) scan() {
	entries, err := os.ReadDir(a.dir)
	if err != nil {
		return // dir may not exist yet — zero usage
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		if info, err := e.Info(); err == nil {
			a.used += info.Size()
			a.count++
		}
	}
}

// key maps any track id to a flat, fixed-length, traversal-proof filename.
// Content ids contain ':' and '/', so they must not be used as raw paths.
func (a *LocalArchive) key(trackID string) string {
	sum := sha256.Sum256([]byte(trackID))
	return hex.EncodeToString(sum[:])
}

// Store writes data under the hashed track id, enforcing a non-zero quota.
func (a *LocalArchive) Store(ctx context.Context, trackID string, data []byte) error {
	if err := os.MkdirAll(a.dir, 0700); err != nil {
		return fmt.Errorf("mkdir archive: %w", err)
	}
	path := filepath.Join(a.dir, a.key(trackID))

	// Overwrite adjusts usage by the size delta; a new file adds its full size.
	var prev int64 = -1
	if info, err := os.Stat(path); err == nil {
		prev = info.Size()
	}
	newUsed := a.used + int64(len(data))
	if prev >= 0 {
		newUsed -= prev
	}
	if a.quota.TotalBytes > 0 && newUsed > a.quota.TotalBytes {
		return fmt.Errorf("archive quota exceeded: %d > %d bytes", newUsed, a.quota.TotalBytes)
	}

	if err := os.WriteFile(path, data, 0600); err != nil {
		return fmt.Errorf("write archive: %w", err)
	}
	a.used = newUsed
	if prev < 0 {
		a.count++
	}
	return nil
}

// Retrieve reads the stored data for trackID.
func (a *LocalArchive) Retrieve(ctx context.Context, trackID string) ([]byte, error) {
	path := filepath.Join(a.dir, a.key(trackID))
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read archive: %w", err)
	}
	return data, nil
}

// Quota returns the current storage quota status (with scanned usage).
func (a *LocalArchive) Quota() sdk.StorageQuota {
	return sdk.StorageQuota{TotalBytes: a.quota.TotalBytes, UsedBytes: a.used}
}

// Stats reports the number of stored items and total bytes used.
func (a *LocalArchive) Stats() (count int, usedBytes int64) {
	return a.count, a.used
}
