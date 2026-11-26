package main

import (
	"context"
	"fmt"
	"net"

	pb "github.com/goamp/sdk/proto"
	"google.golang.org/grpc"
)

type server struct {
	pb.UnimplementedGoampPluginServer
	grpcServer *grpc.Server
}

func (s *server) Register(_ context.Context, _ *pb.RegisterRequest) (*pb.PluginManifest, error) {
	// This fixture only handles registration. Finish the RPC before exiting
	// so the process cannot hold the test runner's stderr open after the test.
	go s.grpcServer.GracefulStop()
	return &pb.PluginManifest{Id: "fake-plugin", Version: "1.0.0"}, nil
}

func main() {
	lis, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		panic(err)
	}
	fmt.Printf("{\"port\": %d}\n", lis.Addr().(*net.TCPAddr).Port)
	srv := grpc.NewServer()
	pb.RegisterGoampPluginServer(srv, &server{grpcServer: srv})
	srv.Serve(lis)
}
