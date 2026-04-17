package node

import (
	"context"
	"encoding/binary"
	"fmt"
	"io"

	goamppb "github.com/goamp/sdk/proto"
	"github.com/goamp/sdk/sdk"
	"github.com/libp2p/go-libp2p/core/network"
	"github.com/libp2p/go-libp2p/core/peer"
	"google.golang.org/protobuf/proto"
)

const CatalogProtocolID = "/goamp/catalog/1.0"

func (n *P2PNode) registerCatalogProtocol() {
	n.host.SetStreamHandler(CatalogProtocolID, func(s network.Stream) {
		defer s.Close()
		var req goamppb.SearchRequest
		if err := readProto(s, &req); err != nil {
			return
		}
		tracks, err := n.cfg.Catalog.Search(context.Background(), sdk.Query{
			Q:      req.Query,
			Genres: req.Genres,
			Limit:  int(req.Limit),
		})
		if err != nil {
			tracks = nil
		}
		resp := &goamppb.SearchResponse{Tracks: tracks}
		_ = writeProto(s, resp)
	})
}

// RemoteSearch opens a catalog protocol stream to peerID and returns search results.
func (n *P2PNode) RemoteSearch(ctx context.Context, peerID peer.ID, q sdk.Query) ([]*goamppb.Track, error) {
	s, err := n.host.NewStream(ctx, peerID, CatalogProtocolID)
	if err != nil {
		return nil, fmt.Errorf("open stream: %w", err)
	}
	defer s.Close()

	req := &goamppb.SearchRequest{
		Query:  q.Q,
		Genres: q.Genres,
		Limit:  uint32(q.Limit),
	}
	if err := writeProto(s, req); err != nil {
		return nil, fmt.Errorf("write request: %w", err)
	}
	// Signal that we're done writing so the server can read EOF.
	_ = s.CloseWrite()

	var resp goamppb.SearchResponse
	if err := readProto(s, &resp); err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}
	return resp.Tracks, nil
}

// writeProto writes a length-prefixed protobuf message to w.
func writeProto(w io.Writer, msg proto.Message) error {
	b, err := proto.Marshal(msg)
	if err != nil {
		return err
	}
	if err := binary.Write(w, binary.BigEndian, uint32(len(b))); err != nil {
		return err
	}
	_, err = w.Write(b)
	return err
}

// readProto reads a length-prefixed protobuf message from r.
func readProto(r io.Reader, msg proto.Message) error {
	var length uint32
	if err := binary.Read(r, binary.BigEndian, &length); err != nil {
		return err
	}
	buf := make([]byte, length)
	if _, err := io.ReadFull(r, buf); err != nil {
		return err
	}
	return proto.Unmarshal(buf, msg)
}
