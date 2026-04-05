package main

import (
	"context"
	"fmt"
	"net"

	pb "github.com/goamp/sdk/proto"
	"google.golang.org/grpc"
)

// port is injected at build time via -ldflags "-X main.port=NNNN"
var port = "0"

type server struct{ pb.UnimplementedGoampPluginServer }

func (s *server) Register(_ context.Context, _ *pb.RegisterRequest) (*pb.PluginManifest, error) {
	return &pb.PluginManifest{Id: "fake-plugin", Version: "1.0.0"}, nil
}

func main() {
	lis, err := net.Listen("tcp", "127.0.0.1:"+port)
	if err != nil {
		panic(err)
	}
	fmt.Printf("{\"port\": %s}\n", port)
	srv := grpc.NewServer()
	pb.RegisterGoampPluginServer(srv, &server{})
	srv.Serve(lis)
}
