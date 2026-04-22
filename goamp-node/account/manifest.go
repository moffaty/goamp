package account

import (
	"bytes"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"time"
)

// manifestSigDomain is the domain-separation tag for the top-level manifest
// signature (distinct from sub-key attestations).
const manifestSigDomain = "goamp-manifest-v1"

// DeviceEntry is one active device in a manifest. SubPub is hex-encoded;
// MasterSig is base64 over (subKeySigDomain || deviceID || subPub-raw || createdAt).
// DeviceID is the first 16 hex chars of SubPub.
type DeviceEntry struct {
	SubPub    string    `json:"sub_pub"`
	Name      string    `json:"name"`
	OS        string    `json:"os"`
	AddedAt   time.Time `json:"added_at"`
	MasterSig string    `json:"master_sig"`
}

// RevokedEntry records a removed sub-key.
type RevokedEntry struct {
	SubPub    string    `json:"sub_pub"`
	RevokedAt time.Time `json:"revoked_at"`
	Reason    string    `json:"reason"`
}

// Manifest is the signed public document listing active sub-keys for an
// account. Version is monotonically increasing; MasterSig is base64 over
// the canonical body (see CanonicalManifestBody).
type Manifest struct {
	Version    uint64         `json:"version"`
	AccountPub string         `json:"account_pub"`
	Devices    []DeviceEntry  `json:"devices"`
	Revoked    []RevokedEntry `json:"revoked"`
	CreatedAt  time.Time      `json:"created_at"`
	MasterSig  string         `json:"master_sig"`
}

func deviceIDFromSubPub(subPub ed25519.PublicKey) string {
	return hex.EncodeToString(subPub)[:16]
}

// BuildDeviceEntry generates a DeviceEntry with a master attestation.
func BuildDeviceEntry(master *MasterKey, subPub ed25519.PublicKey, name, os string, addedAt time.Time) (DeviceEntry, error) {
	if master == nil {
		return DeviceEntry{}, fmt.Errorf("nil master")
	}
	deviceID := deviceIDFromSubPub(subPub)
	sig, err := SignSubKey(master, subPub, deviceID, addedAt.Unix())
	if err != nil {
		return DeviceEntry{}, err
	}
	return DeviceEntry{
		SubPub:    hex.EncodeToString(subPub),
		Name:      name,
		OS:        os,
		AddedAt:   addedAt.UTC(),
		MasterSig: base64.StdEncoding.EncodeToString(sig),
	}, nil
}

// deviceEntryCanonical is used in canonical JSON — same as DeviceEntry but
// without the MasterSig field so the manifest body is sig-free.
type deviceEntryCanonical struct {
	SubPub  string    `json:"sub_pub"`
	Name    string    `json:"name"`
	OS      string    `json:"os"`
	AddedAt time.Time `json:"added_at"`
}

// CanonicalManifestBody returns deterministic JSON bytes of the manifest
// WITHOUT the top-level MasterSig field and WITHOUT per-device master_sig
// fields. This is what master signs.
func CanonicalManifestBody(m *Manifest) ([]byte, error) {
	devices := make([]deviceEntryCanonical, len(m.Devices))
	for i, d := range m.Devices {
		devices[i] = deviceEntryCanonical{
			SubPub:  d.SubPub,
			Name:    d.Name,
			OS:      d.OS,
			AddedAt: d.AddedAt.UTC(),
		}
	}
	body := struct {
		Version    uint64                 `json:"version"`
		AccountPub string                 `json:"account_pub"`
		Devices    []deviceEntryCanonical `json:"devices"`
		Revoked    []RevokedEntry         `json:"revoked"`
		CreatedAt  time.Time              `json:"created_at"`
	}{
		Version:    m.Version,
		AccountPub: m.AccountPub,
		Devices:    devices,
		Revoked:    m.Revoked,
		CreatedAt:  m.CreatedAt.UTC(),
	}
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(&body); err != nil {
		return nil, err
	}
	out := buf.Bytes()
	if len(out) > 0 && out[len(out)-1] == '\n' {
		out = out[:len(out)-1]
	}
	return out, nil
}

// BuildManifest assembles and signs a manifest. Defer master.Wipe() after.
func BuildManifest(master *MasterKey, devices []DeviceEntry, revoked []RevokedEntry, version uint64, createdAt time.Time) (*Manifest, error) {
	if master == nil {
		return nil, fmt.Errorf("nil master")
	}
	if version == 0 {
		return nil, fmt.Errorf("version must be >= 1")
	}
	mf := &Manifest{
		Version:    version,
		AccountPub: hex.EncodeToString(master.PublicKey),
		Devices:    devices,
		Revoked:    revoked,
		CreatedAt:  createdAt.UTC(),
	}
	body, err := CanonicalManifestBody(mf)
	if err != nil {
		return nil, err
	}
	signed := append([]byte(manifestSigDomain), body...)
	sig := ed25519.Sign(master.PrivateKey, signed)
	mf.MasterSig = base64.StdEncoding.EncodeToString(sig)
	return mf, nil
}

// VerifyManifest checks top-level sig + every DeviceEntry.MasterSig.
func VerifyManifest(m *Manifest) error {
	if m == nil {
		return fmt.Errorf("nil manifest")
	}
	pub, err := hex.DecodeString(m.AccountPub)
	if err != nil {
		return fmt.Errorf("account_pub hex: %w", err)
	}
	if len(pub) != ed25519.PublicKeySize {
		return fmt.Errorf("account_pub wrong size: %d", len(pub))
	}
	masterPub := ed25519.PublicKey(pub)

	body, err := CanonicalManifestBody(m)
	if err != nil {
		return err
	}
	sig, err := base64.StdEncoding.DecodeString(m.MasterSig)
	if err != nil {
		return fmt.Errorf("master_sig base64: %w", err)
	}
	signed := append([]byte(manifestSigDomain), body...)
	if !ed25519.Verify(masterPub, signed, sig) {
		return fmt.Errorf("manifest master_sig invalid")
	}

	for i, d := range m.Devices {
		subPub, err := hex.DecodeString(d.SubPub)
		if err != nil {
			return fmt.Errorf("device[%d] sub_pub hex: %w", i, err)
		}
		if len(subPub) != ed25519.PublicKeySize {
			return fmt.Errorf("device[%d] sub_pub wrong size", i)
		}
		devSig, err := base64.StdEncoding.DecodeString(d.MasterSig)
		if err != nil {
			return fmt.Errorf("device[%d] master_sig base64: %w", i, err)
		}
		deviceID := deviceIDFromSubPub(subPub)
		if err := VerifySubKey(masterPub, subPub, deviceID, d.AddedAt.Unix(), devSig); err != nil {
			return fmt.Errorf("device[%d] %s: %w", i, d.Name, err)
		}
	}
	return nil
}
