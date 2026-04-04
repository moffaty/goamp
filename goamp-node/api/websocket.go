package api

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"

	"github.com/goamp/sdk/sdk"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

// WSHub manages all active WebSocket connections and broadcasts events to them.
type WSHub struct {
	mu      sync.Mutex
	clients map[*websocket.Conn]struct{}
}

func newWSHub() *WSHub {
	return &WSHub{clients: make(map[*websocket.Conn]struct{})}
}

// Broadcast sends an Event to all connected WebSocket clients.
// Called by the Node whenever it emits an event.
func (h *WSHub) Broadcast(event sdk.Event) {
	data, err := json.Marshal(event)
	if err != nil {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	for conn := range h.clients {
		if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
			conn.Close()
			delete(h.clients, conn)
		}
	}
}

// ServeWS upgrades an HTTP connection to WebSocket and keeps it open.
// The client receives JSON events pushed via Broadcast.
// TODO(you): this is complete; no changes needed.
func (h *WSHub) ServeWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("ws upgrade: %v", err)
		return
	}
	h.mu.Lock()
	h.clients[conn] = struct{}{}
	h.mu.Unlock()

	defer func() {
		h.mu.Lock()
		delete(h.clients, conn)
		h.mu.Unlock()
		conn.Close()
	}()

	// Keep alive — read and discard pings/close frames
	for {
		if _, _, err := conn.ReadMessage(); err != nil {
			return
		}
	}
}
