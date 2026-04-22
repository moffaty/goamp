package relay

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"testing"
	"time"
)

func TestSessionPutAndGet(t *testing.T) {
	srv, store := newTestServer()
	defer srv.Close()
	fx := newAccountFixture(t)
	_ = store.PutManifest(fx.manifest)

	body := []byte(`{"version":1,"active_device_id":"dev"}`)
	hdr, _ := SignRequest(fx.sub, "PUT", "/session/"+fx.pub, body, time.Now().UnixNano())
	resp, _ := putJSON(srv.URL+"/session/"+fx.pub, body, hdr)
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		msg, _ := io.ReadAll(resp.Body)
		t.Fatalf("put status %d: %s", resp.StatusCode, msg)
	}

	hdr2, _ := SignRequest(fx.sub, "GET", "/session/"+fx.pub, nil, time.Now().UnixNano())
	req, _ := http.NewRequest("GET", srv.URL+"/session/"+fx.pub, nil)
	req.Header.Set("X-GOAMP-Sig", hdr2)
	resp2, _ := http.DefaultClient.Do(req)
	defer resp2.Body.Close()
	if resp2.StatusCode != 200 {
		t.Fatalf("get status %d", resp2.StatusCode)
	}
	got, _ := io.ReadAll(resp2.Body)
	if !bytes.Contains(got, []byte(`"active_device_id":"dev"`)) {
		t.Fatalf("body wrong: %s", got)
	}
}

func TestSessionPutRejectsStaleVersion(t *testing.T) {
	srv, store := newTestServer()
	defer srv.Close()
	fx := newAccountFixture(t)
	_ = store.PutManifest(fx.manifest)
	body1 := []byte(`{"version":2}`)
	hdr1, _ := SignRequest(fx.sub, "PUT", "/session/"+fx.pub, body1, time.Now().UnixNano())
	_, _ = putJSON(srv.URL+"/session/"+fx.pub, body1, hdr1)

	body2 := []byte(`{"version":1}`)
	hdr2, _ := SignRequest(fx.sub, "PUT", "/session/"+fx.pub, body2, time.Now().UnixNano())
	resp, _ := putJSON(srv.URL+"/session/"+fx.pub, body2, hdr2)
	defer resp.Body.Close()
	if resp.StatusCode != 409 {
		t.Fatalf("status %d want 409", resp.StatusCode)
	}
}

func TestCommandPostAndPull(t *testing.T) {
	srv, store := newTestServer()
	defer srv.Close()
	fx := newAccountFixture(t)
	_ = store.PutManifest(fx.manifest)

	cmd := []byte(`{"op":"pause","issued_by":"x","issued_at_ns":1,"nonce":"AAAA"}`)
	hdr, _ := SignRequest(fx.sub, "POST", "/commands/"+fx.pub, cmd, time.Now().UnixNano())
	postReq, _ := http.NewRequest("POST", srv.URL+"/commands/"+fx.pub, bytes.NewReader(cmd))
	postReq.Header.Set("X-GOAMP-Sig", hdr)
	r1, _ := http.DefaultClient.Do(postReq)
	r1.Body.Close()
	if r1.StatusCode != 200 {
		t.Fatalf("post status %d", r1.StatusCode)
	}

	hdr2, _ := SignRequest(fx.sub, "POST", "/commands/"+fx.pub+"/pull", nil, time.Now().UnixNano())
	pullReq, _ := http.NewRequest("POST", srv.URL+"/commands/"+fx.pub+"/pull", nil)
	pullReq.Header.Set("X-GOAMP-Sig", hdr2)
	r2, _ := http.DefaultClient.Do(pullReq)
	defer r2.Body.Close()
	if r2.StatusCode != 200 {
		t.Fatalf("pull status %d", r2.StatusCode)
	}
	var out struct {
		Commands []json.RawMessage `json:"commands"`
	}
	_ = json.NewDecoder(r2.Body).Decode(&out)
	if len(out.Commands) != 1 {
		t.Fatalf("pulled %d cmds", len(out.Commands))
	}
}
