package relay

import (
	"bytes"
	"testing"
	"time"

	"github.com/goamp/sdk/account"
)

func TestSignAndVerifyRequest(t *testing.T) {
	sub, _ := account.NewSubKey()
	body := []byte(`{"hello":"world"}`)
	ts := time.Now().UnixNano()

	hdr, err := SignRequest(sub, "PUT", "/manifest/abc", body, ts)
	if err != nil {
		t.Fatal(err)
	}
	pub, err := VerifyRequest(hdr, "PUT", "/manifest/abc", body)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(pub, sub.PublicKey) {
		t.Fatal("verified sub_pub mismatch")
	}
}

func TestVerifyRejectsTamperedBody(t *testing.T) {
	sub, _ := account.NewSubKey()
	hdr, _ := SignRequest(sub, "PUT", "/x", []byte("a"), time.Now().UnixNano())
	if _, err := VerifyRequest(hdr, "PUT", "/x", []byte("b")); err == nil {
		t.Fatal("expected body tamper to fail")
	}
}

func TestVerifyRejectsWrongPath(t *testing.T) {
	sub, _ := account.NewSubKey()
	hdr, _ := SignRequest(sub, "PUT", "/a", []byte("x"), time.Now().UnixNano())
	if _, err := VerifyRequest(hdr, "PUT", "/b", []byte("x")); err == nil {
		t.Fatal("expected path tamper to fail")
	}
}

func TestVerifyRejectsMalformedHeader(t *testing.T) {
	if _, err := VerifyRequest("junk", "GET", "/x", nil); err == nil {
		t.Fatal("expected parse error")
	}
}
