package relay

import (
	"encoding/json"
	"io"
	"net/http"
	"time"
)

func (h *handlers) putSession(w http.ResponseWriter, r *http.Request) {
	accountPub := r.PathValue("account_pub")
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "read body", http.StatusBadRequest)
		return
	}
	if _, err := h.authorizeActive(r, accountPub, body); err != nil {
		http.Error(w, err.Error(), http.StatusUnauthorized)
		return
	}
	var probe struct {
		Version uint64 `json:"version"`
	}
	if err := json.Unmarshal(body, &probe); err != nil {
		http.Error(w, "decode: "+err.Error(), http.StatusBadRequest)
		return
	}
	if err := h.store.PutSession(accountPub, probe.Version, body); err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	w.WriteHeader(http.StatusOK)
}

func (h *handlers) getSession(w http.ResponseWriter, r *http.Request) {
	accountPub := r.PathValue("account_pub")
	if _, err := h.authorizeActive(r, accountPub, nil); err != nil {
		http.Error(w, err.Error(), http.StatusUnauthorized)
		return
	}
	data, _, ok := h.store.GetSession(accountPub)
	if !ok {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	w.Header().Set("content-type", "application/json")
	_, _ = w.Write(data)
}

func (h *handlers) postCommand(w http.ResponseWriter, r *http.Request) {
	accountPub := r.PathValue("account_pub")
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "read body", http.StatusBadRequest)
		return
	}
	if _, err := h.authorizeActive(r, accountPub, body); err != nil {
		http.Error(w, err.Error(), http.StatusUnauthorized)
		return
	}
	h.store.EnqueueCommand(accountPub, body)
	w.WriteHeader(http.StatusOK)
}

func (h *handlers) pullCommands(w http.ResponseWriter, r *http.Request) {
	accountPub := r.PathValue("account_pub")
	if _, err := h.authorizeActive(r, accountPub, nil); err != nil {
		http.Error(w, err.Error(), http.StatusUnauthorized)
		return
	}
	cmds := h.store.DrainCommands(accountPub)
	out := make([]json.RawMessage, 0, len(cmds))
	for _, raw := range cmds {
		out = append(out, raw)
	}
	w.Header().Set("content-type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"commands":  out,
		"server_ts": time.Now().UnixNano(),
	})
}
