// Package relay provides signed-request primitives shared by the GOAMP
// relay server and the client in goamp-node.
package relay

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"strings"

	"github.com/goamp/sdk/account"
)

func canonicalMessage(method, path string, body []byte, nonce []byte, timestampNs int64) []byte {
	bodyHash := sha256.Sum256(body)
	return []byte(fmt.Sprintf("%s\n%s\n%d\n%s\n%s",
		method, path, timestampNs,
		hex.EncodeToString(nonce),
		hex.EncodeToString(bodyHash[:]),
	))
}

// SignRequest returns the X-GOAMP-Sig header value.
// Format: subPubHex.nonceHex.timestampNs.sigB64
func SignRequest(sub *account.SubKey, method, path string, body []byte, timestampNs int64) (string, error) {
	if sub == nil {
		return "", fmt.Errorf("nil sub")
	}
	var nonce [16]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		return "", err
	}
	msg := canonicalMessage(method, path, body, nonce[:], timestampNs)
	sig := ed25519.Sign(sub.PrivateKey, msg)
	return fmt.Sprintf("%s.%s.%d.%s",
		hex.EncodeToString(sub.PublicKey),
		hex.EncodeToString(nonce[:]),
		timestampNs,
		base64.StdEncoding.EncodeToString(sig),
	), nil
}

type ParsedSig struct {
	SubPub      ed25519.PublicKey
	Nonce       []byte
	TimestampNs int64
	Sig         []byte
}

func ParseSigHeader(hdr string) (*ParsedSig, error) {
	parts := strings.Split(hdr, ".")
	if len(parts) != 4 {
		return nil, fmt.Errorf("sig header: want 4 parts, got %d", len(parts))
	}
	pub, err := hex.DecodeString(parts[0])
	if err != nil || len(pub) != ed25519.PublicKeySize {
		return nil, fmt.Errorf("sig header: sub_pub: %v", err)
	}
	nonce, err := hex.DecodeString(parts[1])
	if err != nil {
		return nil, fmt.Errorf("sig header: nonce: %w", err)
	}
	var ts int64
	if _, err := fmt.Sscanf(parts[2], "%d", &ts); err != nil {
		return nil, fmt.Errorf("sig header: timestamp: %w", err)
	}
	sig, err := base64.StdEncoding.DecodeString(parts[3])
	if err != nil {
		return nil, fmt.Errorf("sig header: sig: %w", err)
	}
	return &ParsedSig{
		SubPub:      ed25519.PublicKey(pub),
		Nonce:       nonce,
		TimestampNs: ts,
		Sig:         sig,
	}, nil
}

// VerifyRequest returns the authenticated sub_pub on success.
func VerifyRequest(hdr, method, path string, body []byte) (ed25519.PublicKey, error) {
	p, err := ParseSigHeader(hdr)
	if err != nil {
		return nil, err
	}
	msg := canonicalMessage(method, path, body, p.Nonce, p.TimestampNs)
	if !ed25519.Verify(p.SubPub, msg, p.Sig) {
		return nil, fmt.Errorf("signature invalid")
	}
	return p.SubPub, nil
}
