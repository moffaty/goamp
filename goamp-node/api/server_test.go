package api_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/goamp/sdk/api"
	"github.com/goamp/sdk/sdk/catalog"
	"github.com/goamp/sdk/sdk/node"
	"github.com/goamp/sdk/sdk/plugin"
	"github.com/goamp/sdk/sdk/profiles"
	"github.com/goamp/sdk/store"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newTestServer(t *testing.T) *api.Server {
	t.Helper()
	st, err := store.Open(":memory:")
	require.NoError(t, err)
	t.Cleanup(func() { st.Close() })

	n := node.NewStub(nil)
	cat := catalog.New(st, "local")
	prof := profiles.New(st)
	loader := plugin.NewLoader(t.TempDir())

	return api.New(n, cat, prof, loader)
}

func TestHealthEndpoint(t *testing.T) {
	srv := newTestServer(t)

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var body map[string]any
	require.NoError(t, json.NewDecoder(w.Body).Decode(&body))
	assert.Equal(t, "ok", body["status"])
	assert.Contains(t, body, "peer_count")
	assert.Contains(t, body, "uptime_secs")
	assert.Contains(t, body, "version")
}

func TestCatalogSearchEmpty(t *testing.T) {
	srv := newTestServer(t)

	req := httptest.NewRequest(http.MethodGet, "/catalog/search?q=test", nil)
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var body map[string]any
	require.NoError(t, json.NewDecoder(w.Body).Decode(&body))
	assert.Contains(t, body, "tracks")
}

func TestCatalogAnnounce(t *testing.T) {
	srv := newTestServer(t)

	body := `{"track_id":"abc123"}`
	req := httptest.NewRequest(http.MethodPost, "/catalog/announce", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, req)

	assert.Equal(t, http.StatusNoContent, w.Code)
}

func TestCatalogAnnounceMissingTrackID(t *testing.T) {
	srv := newTestServer(t)

	req := httptest.NewRequest(http.MethodPost, "/catalog/announce", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestRecommendationsEmpty(t *testing.T) {
	srv := newTestServer(t)

	req := httptest.NewRequest(http.MethodGet, "/recommendations", nil)
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var body map[string]any
	require.NoError(t, json.NewDecoder(w.Body).Decode(&body))
	assert.Contains(t, body, "recommendations")
}

func TestProfileSyncReturns204(t *testing.T) {
	srv := newTestServer(t)
	body := `{"version":1,"liked_hashes":["h1","h2"],"total_listens":5}`
	req := httptest.NewRequest(http.MethodPost, "/profiles/sync", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, req)
	assert.Equal(t, http.StatusNoContent, w.Code)
}

func TestGetPeerProfilesEmpty(t *testing.T) {
	srv := newTestServer(t)
	req := httptest.NewRequest(http.MethodGet, "/profiles/peers", nil)
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, req)
	assert.Equal(t, http.StatusOK, w.Code)
	var body map[string]any
	require.NoError(t, json.NewDecoder(w.Body).Decode(&body))
	assert.Contains(t, body, "profiles")
}

func TestGetPeerProfilesReturnsStored(t *testing.T) {
	srv := newTestServer(t)

	p := `{"version":1,"liked_hashes":["hash1"],"total_listens":3}`
	req := httptest.NewRequest(http.MethodPost, "/profiles/sync", strings.NewReader(p))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, req)
	require.Equal(t, http.StatusNoContent, w.Code)

	req2 := httptest.NewRequest(http.MethodGet, "/profiles/peers?limit=10", nil)
	w2 := httptest.NewRecorder()
	srv.ServeHTTP(w2, req2)
	assert.Equal(t, http.StatusOK, w2.Code)

	var body map[string]any
	require.NoError(t, json.NewDecoder(w2.Body).Decode(&body))
	profiles, ok := body["profiles"].([]any)
	require.True(t, ok)
	assert.Len(t, profiles, 1)

	first := profiles[0].(map[string]any)
	assert.NotEmpty(t, first["hash"])
	assert.NotNil(t, first["data"])
	assert.NotZero(t, first["received_at"])
}

func TestPeersEndpoint(t *testing.T) {
	srv := newTestServer(t)

	req := httptest.NewRequest(http.MethodGet, "/peers", nil)
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var body map[string]any
	require.NoError(t, json.NewDecoder(w.Body).Decode(&body))
	assert.Contains(t, body, "peers")
}
