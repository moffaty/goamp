package identity_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/goamp/sdk/identity"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLoadOrGenerateCreatesKey(t *testing.T) {
	path := filepath.Join(t.TempDir(), "identity.key")
	priv, err := identity.LoadOrGenerate(path)
	require.NoError(t, err)
	assert.NotNil(t, priv)
	_, err = os.Stat(path)
	require.NoError(t, err, "key file should exist after generation")
}

func TestLoadOrGenerateDeterministic(t *testing.T) {
	path := filepath.Join(t.TempDir(), "identity.key")

	priv1, err := identity.LoadOrGenerate(path)
	require.NoError(t, err)
	pid1, err := identity.PeerID(priv1)
	require.NoError(t, err)

	priv2, err := identity.LoadOrGenerate(path)
	require.NoError(t, err)
	pid2, err := identity.PeerID(priv2)
	require.NoError(t, err)

	assert.Equal(t, pid1, pid2, "same file should yield same peerID")
}

func TestKeyFilePermissions(t *testing.T) {
	path := filepath.Join(t.TempDir(), "identity.key")
	_, err := identity.LoadOrGenerate(path)
	require.NoError(t, err)

	info, err := os.Stat(path)
	require.NoError(t, err)
	assert.Equal(t, os.FileMode(0600), info.Mode().Perm(), "key file must be 0600")
}
