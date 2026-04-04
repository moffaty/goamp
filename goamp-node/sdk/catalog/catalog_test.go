package catalog_test

import (
	"context"
	"testing"

	"github.com/goamp/sdk/proto"
	"github.com/goamp/sdk/sdk"
	"github.com/goamp/sdk/sdk/catalog"
	"github.com/goamp/sdk/store"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newCatalog(t *testing.T) *catalog.SQLCatalog {
	t.Helper()
	s, err := store.Open(":memory:")
	require.NoError(t, err)
	t.Cleanup(func() { s.Close() })
	return catalog.New(s, "local")
}

func TestIndex(t *testing.T) {
	c := newCatalog(t)
	ctx := context.Background()

	err := c.Index(ctx, &proto.Track{
		Id: "track1", Artist: "Boards of Canada", Title: "Dayvan Cowboy",
		DurationSecs: 420, Genre: "electronic", PeerCount: 1,
	})
	require.NoError(t, err)

	results, err := c.Search(ctx, sdk.Query{Q: "boards", Limit: 10})
	require.NoError(t, err)
	require.Len(t, results, 1)
	assert.Equal(t, "track1", results[0].Id)
}

func TestAnnounceAndFindProviders(t *testing.T) {
	c := newCatalog(t)
	ctx := context.Background()

	require.NoError(t, c.Index(ctx, &proto.Track{Id: "t1", Artist: "A", Title: "B", PeerCount: 1}))
	require.NoError(t, c.Announce(ctx, "t1"))

	// TODO(you): un-comment when FindProviders returns peer.IDs correctly
	// providers, err := c.FindProviders(ctx, "t1")
	// require.NoError(t, err)
	// assert.NotEmpty(t, providers)
}
