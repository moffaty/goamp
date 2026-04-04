// Package archive implements the Archive interface with local file storage.
package archive

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/goamp/sdk/sdk"
)

// LocalArchive stores raw audio fragments as files under a configurable directory.
type LocalArchive struct {
	dir   string
	quota sdk.StorageQuota
}

// New creates a LocalArchive.
// quotaGB = 0 means unlimited.
// TODO(you): implement Store and Retrieve; the constructor is done.
func New(dir string, quotaGB int64) *LocalArchive {
	return &LocalArchive{
		dir: dir,
		quota: sdk.StorageQuota{
			TotalBytes: quotaGB * 1024 * 1024 * 1024,
		},
	}
}

// Store writes data to dir/trackID.
// TODO(you): os.MkdirAll(a.dir), os.WriteFile(filepath.Join(a.dir, trackID), data, 0600)
// Update a.quota.UsedBytes.
func (a *LocalArchive) Store(ctx context.Context, trackID string, data []byte) error {
	if err := os.MkdirAll(a.dir, 0700); err != nil {
		return fmt.Errorf("mkdir archive: %w", err)
	}
	path := filepath.Join(a.dir, trackID)
	if err := os.WriteFile(path, data, 0600); err != nil {
		return fmt.Errorf("write archive: %w", err)
	}
	a.quota.UsedBytes += int64(len(data))
	return nil
}

// Retrieve reads the stored data for trackID.
// TODO(you): os.ReadFile(filepath.Join(a.dir, trackID))
func (a *LocalArchive) Retrieve(ctx context.Context, trackID string) ([]byte, error) {
	path := filepath.Join(a.dir, trackID)
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read archive: %w", err)
	}
	return data, nil
}

// Quota returns the current storage quota status.
func (a *LocalArchive) Quota() sdk.StorageQuota {
	return a.quota
}
