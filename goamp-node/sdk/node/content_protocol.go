package node

import (
	"context"
	"fmt"
	"io"

	"github.com/libp2p/go-libp2p/core/network"
	"github.com/libp2p/go-libp2p/core/peer"
)

// ContentProtocolID is the libp2p stream protocol that transfers a track's raw
// audio bytes between peers. Wire format: the client writes the track id then
// CloseWrite; the server replies with the audio bytes (empty = not held).
const ContentProtocolID = "/goamp/content/1.0"

// registerContentProtocol serves a track's bytes from the local Archive.
func (n *P2PNode) registerContentProtocol() {
	n.host.SetStreamHandler(ContentProtocolID, func(s network.Stream) {
		defer s.Close()
		// The client's CloseWrite delimits the id, so ReadAll returns just the id.
		idBytes, err := io.ReadAll(s)
		if err != nil {
			return
		}
		data, err := n.cfg.Archive.Retrieve(context.Background(), string(idBytes))
		if err != nil {
			return // miss/error → write nothing; client reads zero bytes.
		}
		_, _ = s.Write(data)
	})
}

// FetchContent requests a track's bytes from peerID over the content protocol.
// Returns an empty slice (no error) when the peer does not hold the track.
func (n *P2PNode) FetchContent(ctx context.Context, peerID peer.ID, trackID string) ([]byte, error) {
	s, err := n.host.NewStream(ctx, peerID, ContentProtocolID)
	if err != nil {
		return nil, fmt.Errorf("open content stream: %w", err)
	}
	defer s.Close()

	if _, err := s.Write([]byte(trackID)); err != nil {
		return nil, fmt.Errorf("write track id: %w", err)
	}
	// Signal end-of-request so the server can read the id and reply.
	_ = s.CloseWrite()

	data, err := io.ReadAll(s)
	if err != nil {
		return nil, fmt.Errorf("read content: %w", err)
	}
	return data, nil
}

// ProvideContent stores a track's bytes locally and announces this node as a DHT
// provider for its id, so peers can discover and fetch it.
func (n *P2PNode) ProvideContent(ctx context.Context, trackID string, data []byte) error {
	if n.cfg.Archive == nil {
		return fmt.Errorf("no archive configured")
	}
	if err := n.cfg.Archive.Store(ctx, trackID, data); err != nil {
		return fmt.Errorf("archive store: %w", err)
	}
	return n.Announce(ctx, trackID)
}

// GetContent returns a track's bytes: the local copy if held, otherwise fetched
// from a DHT provider (and cached locally). Errors when no seeder has it.
func (n *P2PNode) GetContent(ctx context.Context, trackID string) ([]byte, error) {
	if n.cfg.Archive != nil {
		if data, err := n.cfg.Archive.Retrieve(ctx, trackID); err == nil && len(data) > 0 {
			return data, nil
		}
	}

	providers, err := n.FindProviders(ctx, trackID)
	if err != nil {
		return nil, fmt.Errorf("find providers: %w", err)
	}
	for _, pid := range providers {
		if pid == n.host.ID() {
			continue
		}
		data, err := n.FetchContent(ctx, pid, trackID)
		if err != nil || len(data) == 0 {
			continue
		}
		if n.cfg.Archive != nil {
			_ = n.cfg.Archive.Store(ctx, trackID, data) // cache for future seeding
		}
		return data, nil
	}
	return nil, fmt.Errorf("no provider served content for %s", trackID)
}
