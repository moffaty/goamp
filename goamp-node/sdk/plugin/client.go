package plugin

import (
	"context"
	"fmt"

	pb "github.com/goamp/sdk/proto"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

// GoampPluginClient is a typed wrapper around the generated gRPC client.
type GoampPluginClient struct {
	conn *grpc.ClientConn
	raw  pb.GoampPluginClient
}

// Dial connects to a plugin's gRPC server at localhost:port.
func Dial(port int) (GoampPluginClient, error) {
	addr := fmt.Sprintf("localhost:%d", port)
	conn, err := grpc.NewClient(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return GoampPluginClient{}, fmt.Errorf("dial plugin at %s: %w", addr, err)
	}
	return GoampPluginClient{conn: conn, raw: pb.NewGoampPluginClient(conn)}, nil
}

// Register calls the plugin's Register RPC to obtain its manifest.
func (c GoampPluginClient) Register(ctx context.Context, nodeVersion string) (*pb.PluginManifest, error) {
	return c.raw.Register(ctx, &pb.RegisterRequest{NodeVersion: nodeVersion})
}

// Search delegates a search query to the plugin.
func (c GoampPluginClient) Search(ctx context.Context, query string, limit uint32) ([]*pb.Track, error) {
	resp, err := c.raw.Search(ctx, &pb.SearchRequest{Query: query, Limit: limit})
	if err != nil {
		return nil, err
	}
	return resp.Tracks, nil
}

// StreamURL asks the plugin for a playable URL for a track.
func (c GoampPluginClient) StreamURL(ctx context.Context, providerID, trackID string) (string, error) {
	resp, err := c.raw.StreamURL(ctx, &pb.StreamURLRequest{
		ProviderId: providerID,
		TrackId:    trackID,
	})
	if err != nil {
		return "", err
	}
	return resp.Url, nil
}

// Close releases the gRPC connection.
func (c GoampPluginClient) Close() error {
	if c.conn != nil {
		return c.conn.Close()
	}
	return nil
}
