package relay

import (
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/goamp/sdk/account"
)

const ClockSkewNs = int64(30 * time.Second)

func NewServer(store *MemStore) http.Handler {
	mux := http.NewServeMux()
	h := &handlers{store: store}
	mux.HandleFunc("PUT /manifest/{account_pub}", h.putManifest)
	mux.HandleFunc("GET /manifest/{account_pub}", h.getManifest)
	mux.HandleFunc("PUT /state/{account_pub}", h.putState)
	mux.HandleFunc("GET /state/{account_pub}", h.getState)
	return mux
}

type handlers struct {
	store *MemStore
}

func (h *handlers) putManifest(w http.ResponseWriter, r *http.Request) {
	accountPub := r.PathValue("account_pub")
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "read body", http.StatusBadRequest)
		return
	}
	var mf account.Manifest
	if err := json.Unmarshal(body, &mf); err != nil {
		http.Error(w, "decode: "+err.Error(), http.StatusBadRequest)
		return
	}
	if mf.AccountPub != accountPub {
		http.Error(w, "account_pub path/body mismatch", http.StatusBadRequest)
		return
	}
	if err := account.VerifyManifest(&mf); err != nil {
		http.Error(w, "verify: "+err.Error(), http.StatusBadRequest)
		return
	}

	if prev, ok := h.store.GetManifest(accountPub); ok {
		sig := r.Header.Get("X-GOAMP-Sig")
		if sig == "" {
			http.Error(w, "missing X-GOAMP-Sig (manifest update requires active sub-key)", http.StatusUnauthorized)
			return
		}
		subPub, err := verifySignedRequest(sig, r.Method, r.URL.Path, body)
		if err != nil {
			http.Error(w, err.Error(), http.StatusUnauthorized)
			return
		}
		subPubHex := hex.EncodeToString(subPub)
		if !isActiveInManifest(prev, subPubHex) && !isActiveInManifest(&mf, subPubHex) {
			http.Error(w, "signing sub-key not active in previous or new manifest", http.StatusUnauthorized)
			return
		}
	}

	if err := h.store.PutManifest(&mf); err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	w.WriteHeader(http.StatusOK)
}

func (h *handlers) getManifest(w http.ResponseWriter, r *http.Request) {
	mf, ok := h.store.GetManifest(r.PathValue("account_pub"))
	if !ok {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	w.Header().Set("content-type", "application/json")
	_ = json.NewEncoder(w).Encode(mf)
}

func (h *handlers) putState(w http.ResponseWriter, r *http.Request) {
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
	h.store.PutBlob(accountPub, body, time.Now())
	w.WriteHeader(http.StatusOK)
}

func (h *handlers) getState(w http.ResponseWriter, r *http.Request) {
	accountPub := r.PathValue("account_pub")
	if _, err := h.authorizeActive(r, accountPub, nil); err != nil {
		http.Error(w, err.Error(), http.StatusUnauthorized)
		return
	}
	blob, ok := h.store.GetLatestBlob(accountPub)
	if !ok {
		http.Error(w, "no blob", http.StatusNotFound)
		return
	}
	w.Header().Set("content-type", "application/octet-stream")
	_, _ = w.Write(blob)
}

func (h *handlers) authorizeActive(r *http.Request, accountPub string, body []byte) ([]byte, error) {
	sig := r.Header.Get("X-GOAMP-Sig")
	if sig == "" {
		return nil, &httpErr{http.StatusUnauthorized, "missing X-GOAMP-Sig"}
	}
	subPub, err := verifySignedRequest(sig, r.Method, r.URL.Path, body)
	if err != nil {
		return nil, err
	}
	subPubHex := hex.EncodeToString(subPub)
	if h.store.IsRevoked(accountPub, subPubHex) {
		return nil, &httpErr{http.StatusUnauthorized, "revoked"}
	}
	if !h.store.IsActive(accountPub, subPubHex) {
		return nil, &httpErr{http.StatusUnauthorized, "sub-key not active for account"}
	}
	return subPub, nil
}

func verifySignedRequest(hdr, method, path string, body []byte) ([]byte, error) {
	p, err := ParseSigHeader(hdr)
	if err != nil {
		return nil, err
	}
	now := time.Now().UnixNano()
	if abs(now-p.TimestampNs) > ClockSkewNs {
		return nil, &httpErr{http.StatusUnauthorized, "clock skew"}
	}
	return VerifyRequest(hdr, method, path, body)
}

func isActiveInManifest(m *account.Manifest, subPubHex string) bool {
	for _, d := range m.Devices {
		if strings.EqualFold(d.SubPub, subPubHex) {
			return true
		}
	}
	return false
}

func abs(x int64) int64 {
	if x < 0 {
		return -x
	}
	return x
}

type httpErr struct {
	code int
	msg  string
}

func (e *httpErr) Error() string { return e.msg }
