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
