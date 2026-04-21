// goamp-relay — minimal HTTP relay for multi-device manifest + state blobs.
package main

import (
	"flag"
	"log"
	"net/http"
	"os"

	"github.com/goamp/sdk/relay"
)

func main() {
	addr := flag.String("addr", ":7480", "listen address")
	flag.Parse()
	store := relay.NewMemStore()
	log.Printf("goamp-relay listening on %s", *addr)
	if err := http.ListenAndServe(*addr, relay.NewServer(store)); err != nil {
		log.Printf("serve: %v", err)
		os.Exit(1)
	}
}
