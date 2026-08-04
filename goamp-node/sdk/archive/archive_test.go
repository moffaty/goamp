package archive

import (
	"context"
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestStoreRetrieveRoundTripWithUnsafeID(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	a := New(dir, 0)

	// A content id with ':' and '/' must not create nested dirs or escape.
	const id = "soundcloud:https://host/user/sets/x"
	data := []byte("audio-bytes")
	require.NoError(t, a.Store(ctx, id, data))

	got, err := a.Retrieve(ctx, id)
	require.NoError(t, err)
	assert.Equal(t, data, got)

	// Only flat files under dir — no subdirectories from the '/' in the id.
	entries, err := os.ReadDir(dir)
	require.NoError(t, err)
	for _, e := range entries {
		assert.False(t, e.IsDir(), "id slashes must not create directories")
	}
}

func TestQuotaRejectsOverflow(t *testing.T) {
	ctx := context.Background()
	// TotalBytes is quotaGB*1GiB, so use a tiny archive by constructing directly.
	a := &LocalArchive{dir: t.TempDir()}
	a.quota.TotalBytes = 10

	require.NoError(t, a.Store(ctx, "a", []byte("12345"))) // 5 <= 10
	_, used := a.Stats()
	require.Equal(t, int64(5), used)

	err := a.Store(ctx, "b", []byte("123456")) // 5+6 = 11 > 10
	require.Error(t, err)
	_, used = a.Stats()
	assert.Equal(t, int64(5), used, "rejected store must not change usage")
}

func TestScanSeedsUsageOnNew(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()

	a1 := New(dir, 0)
	require.NoError(t, a1.Store(ctx, "youtube:v1", []byte("hello")))

	// A fresh archive over the same dir must see the existing usage.
	a2 := New(dir, 0)
	count, used := a2.Stats()
	assert.Equal(t, 1, count)
	assert.Equal(t, int64(5), used)
}

func TestStatsAndOverwriteDelta(t *testing.T) {
	ctx := context.Background()
	a := New(t.TempDir(), 0)

	require.NoError(t, a.Store(ctx, "a", []byte("123")))
	require.NoError(t, a.Store(ctx, "b", []byte("4567")))
	count, used := a.Stats()
	assert.Equal(t, 2, count)
	assert.Equal(t, int64(7), used)

	// Overwriting "a" with a larger blob adjusts by delta, not double-count.
	require.NoError(t, a.Store(ctx, "a", []byte("12345")))
	count, used = a.Stats()
	assert.Equal(t, 2, count)
	assert.Equal(t, int64(9), used) // 5 + 4
}
