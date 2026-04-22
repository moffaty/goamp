package session

import (
	"encoding/json"
	"testing"
)

func TestSessionJSONRoundTrip(t *testing.T) {
	s := Session{
		ActiveDeviceID:      "dev1",
		Track:               TrackRef{TrackID: "t1", Source: "yt", Title: "Song"},
		PositionMs:          12345,
		PositionUpdatedAtNs: 1000,
		PlaybackState:       Playing,
		Queue:               []TrackRef{{TrackID: "t2"}},
		QueuePosition:       0,
		Shuffle:             false,
		Repeat:              RepeatOff,
		LastHeartbeatNs:     2000,
		Version:             7,
	}
	data, err := json.Marshal(s)
	if err != nil {
		t.Fatal(err)
	}
	var back Session
	if err := json.Unmarshal(data, &back); err != nil {
		t.Fatal(err)
	}
	if back.ActiveDeviceID != s.ActiveDeviceID || back.PositionMs != s.PositionMs || back.Version != s.Version {
		t.Fatal("roundtrip mismatch")
	}
}

func TestCommandJSONRoundTrip(t *testing.T) {
	c := Command{
		Op:         OpSeek,
		ArgInt:     42,
		IssuedBy:   "subpubX",
		IssuedAtNs: 100,
		Nonce:      []byte{1, 2, 3},
	}
	data, _ := json.Marshal(c)
	var back Command
	if err := json.Unmarshal(data, &back); err != nil {
		t.Fatal(err)
	}
	if back.Op != OpSeek || back.ArgInt != 42 || back.IssuedBy != "subpubX" {
		t.Fatal("cmd roundtrip mismatch")
	}
}
