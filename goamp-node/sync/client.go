// Package sync is the client library goamp-node uses to talk to a GOAMP
// relay for manifest + state blob sync.
package sync

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/goamp/sdk/account"
	"github.com/goamp/sdk/relay"
	"github.com/goamp/sdk/userstate"
)

type Client struct {
	baseURL           string
	http              *http.Client
	lastAccountPubVal string
}

func NewClient(baseURL string) *Client {
	return &Client{
		baseURL: baseURL,
		http:    &http.Client{Timeout: 10 * time.Second},
	}
}

func (c *Client) lastAccountPub() string { return c.lastAccountPubVal }

// PutManifest uploads a signed manifest. subForUpdate required for v >= 2
// (active sub-key auth); nil bootstraps v1.
func (c *Client) PutManifest(mf *account.Manifest, subForUpdate *account.SubKey) error {
	body, err := json.Marshal(mf)
	if err != nil {
		return err
	}
	path := "/manifest/" + mf.AccountPub
	req, err := http.NewRequest(http.MethodPut, c.baseURL+path, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("content-type", "application/json")
	if subForUpdate != nil {
		hdr, err := relay.SignRequest(subForUpdate, req.Method, path, body, time.Now().UnixNano())
		if err != nil {
			return err
		}
		req.Header.Set("X-GOAMP-Sig", hdr)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		msg, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("put manifest: %d %s", resp.StatusCode, msg)
	}
	c.lastAccountPubVal = mf.AccountPub
	return nil
}

func (c *Client) GetManifest(accountPub string) (*account.Manifest, error) {
	resp, err := c.http.Get(c.baseURL + "/manifest/" + accountPub)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		msg, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("get manifest: %d %s", resp.StatusCode, msg)
	}
	var mf account.Manifest
	if err := json.NewDecoder(resp.Body).Decode(&mf); err != nil {
		return nil, err
	}
	return &mf, nil
}

func (c *Client) PutState(accountPub string, sub *account.SubKey, ciphertext []byte) error {
	path := "/state/" + accountPub
	req, err := http.NewRequest(http.MethodPut, c.baseURL+path, bytes.NewReader(ciphertext))
	if err != nil {
		return err
	}
	hdr, err := relay.SignRequest(sub, req.Method, path, ciphertext, time.Now().UnixNano())
	if err != nil {
		return err
	}
	req.Header.Set("X-GOAMP-Sig", hdr)
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		msg, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("put state: %d %s", resp.StatusCode, msg)
	}
	return nil
}

func (c *Client) GetState(accountPub string, sub *account.SubKey) ([]byte, error) {
	path := "/state/" + accountPub
	req, err := http.NewRequest(http.MethodGet, c.baseURL+path, nil)
	if err != nil {
		return nil, err
	}
	hdr, err := relay.SignRequest(sub, req.Method, path, nil, time.Now().UnixNano())
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-GOAMP-Sig", hdr)
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return nil, nil
	}
	if resp.StatusCode/100 != 2 {
		msg, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("get state: %d %s", resp.StatusCode, msg)
	}
	return io.ReadAll(resp.Body)
}

// SyncUpFor encrypts plaintext and uploads to /state for the given accountPub.
func (c *Client) SyncUpFor(accountPub string, stateKey []byte, sub *account.SubKey, plaintext []byte) error {
	ct, err := userstate.Seal(stateKey, plaintext)
	if err != nil {
		return err
	}
	return c.PutState(accountPub, sub, ct)
}

// SyncDownFor fetches the latest state blob and decrypts it. Returns nil,nil
// if no blob exists yet.
func (c *Client) SyncDownFor(accountPub string, stateKey []byte, sub *account.SubKey) ([]byte, error) {
	blob, err := c.GetState(accountPub, sub)
	if err != nil {
		return nil, err
	}
	if blob == nil {
		return nil, nil
	}
	return userstate.Open(stateKey, blob)
}

// PutSession uploads JSON-encoded session bytes to the relay.
func (c *Client) PutSession(accountPub string, sub *account.SubKey, sessionJSON []byte) error {
	path := "/session/" + accountPub
	req, _ := http.NewRequest(http.MethodPut, c.baseURL+path, bytes.NewReader(sessionJSON))
	hdr, err := relay.SignRequest(sub, req.Method, path, sessionJSON, time.Now().UnixNano())
	if err != nil {
		return err
	}
	req.Header.Set("X-GOAMP-Sig", hdr)
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		msg, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("put session: %d %s", resp.StatusCode, msg)
	}
	return nil
}

func (c *Client) GetSession(accountPub string, sub *account.SubKey) ([]byte, error) {
	path := "/session/" + accountPub
	req, _ := http.NewRequest(http.MethodGet, c.baseURL+path, nil)
	hdr, err := relay.SignRequest(sub, req.Method, path, nil, time.Now().UnixNano())
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-GOAMP-Sig", hdr)
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == 404 {
		return nil, nil
	}
	if resp.StatusCode/100 != 2 {
		msg, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("get session: %d %s", resp.StatusCode, msg)
	}
	return io.ReadAll(resp.Body)
}

func (c *Client) PostCommand(accountPub string, sub *account.SubKey, cmdJSON []byte) error {
	path := "/commands/" + accountPub
	req, _ := http.NewRequest(http.MethodPost, c.baseURL+path, bytes.NewReader(cmdJSON))
	hdr, err := relay.SignRequest(sub, req.Method, path, cmdJSON, time.Now().UnixNano())
	if err != nil {
		return err
	}
	req.Header.Set("X-GOAMP-Sig", hdr)
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		msg, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("post command: %d %s", resp.StatusCode, msg)
	}
	return nil
}

// PullCommands drains and returns pending commands.
func (c *Client) PullCommands(accountPub string, sub *account.SubKey) ([][]byte, error) {
	path := "/commands/" + accountPub + "/pull"
	req, _ := http.NewRequest(http.MethodPost, c.baseURL+path, nil)
	hdr, err := relay.SignRequest(sub, req.Method, path, nil, time.Now().UnixNano())
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-GOAMP-Sig", hdr)
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		msg, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("pull commands: %d %s", resp.StatusCode, msg)
	}
	var out struct {
		Commands []json.RawMessage `json:"commands"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	res := make([][]byte, len(out.Commands))
	for i, cmd := range out.Commands {
		res[i] = []byte(cmd)
	}
	return res, nil
}
