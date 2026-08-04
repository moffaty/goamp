package api_test

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"testing"

	"github.com/goamp/sdk/api"
	"github.com/goamp/sdk/sdk"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// fakeNode satisfies sdk.Node via the embedded (nil) interface; only the content
// methods are exercised by the content handlers.
type fakeNode struct {
	sdk.Node
	store map[string][]byte
}

func (f *fakeNode) ProvideContent(_ context.Context, id string, data []byte) error {
	f.store[id] = data
	return nil
}

func (f *fakeNode) GetContent(_ context.Context, id string) ([]byte, error) {
	d, ok := f.store[id]
	if !ok {
		return nil, fmt.Errorf("miss")
	}
	return d, nil
}

func newContentServer() (*api.Server, *fakeNode) {
	n := &fakeNode{store: map[string][]byte{}}
	return api.New(n, nil, nil, nil), n
}

func TestContentProvideReadsFileAndStores(t *testing.T) {
	srv, node := newContentServer()

	dir := t.TempDir()
	path := filepath.Join(dir, "track.opus")
	require.NoError(t, os.WriteFile(path, []byte("audio-bytes"), 0o600))

	body := fmt.Sprintf(`{"track_id":"youtube:v1","path":%q}`, path)
	req := httptest.NewRequest(http.MethodPost, "/content/provide", bytes.NewBufferString(body))
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusNoContent, rec.Code)
	assert.Equal(t, []byte("audio-bytes"), node.store["youtube:v1"])
}

func TestContentProvideRejectsMissingFields(t *testing.T) {
	srv, _ := newContentServer()
	req := httptest.NewRequest(http.MethodPost, "/content/provide", bytes.NewBufferString(`{"track_id":"x"}`))
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestContentGetHitAndMiss(t *testing.T) {
	srv, node := newContentServer()
	node.store["soundcloud:https://sc/x"] = []byte("the-bytes")

	// Hit — id carries ':' and '/', url-encoded in the query.
	req := httptest.NewRequest(http.MethodGet, "/content?id="+url.QueryEscape("soundcloud:https://sc/x"), nil)
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "the-bytes", rec.Body.String())

	// Miss → 404.
	req2 := httptest.NewRequest(http.MethodGet, "/content?id=unknown-id", nil)
	rec2 := httptest.NewRecorder()
	srv.ServeHTTP(rec2, req2)
	assert.Equal(t, http.StatusNotFound, rec2.Code)
}
