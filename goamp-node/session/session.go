// Package session defines the cross-device playback session and remote
// command types for multi-device sync.
package session

type PlaybackState string

const (
	Playing   PlaybackState = "playing"
	Paused    PlaybackState = "paused"
	Buffering PlaybackState = "buffering"
	Stopped   PlaybackState = "stopped"
)

type RepeatMode string

const (
	RepeatOff RepeatMode = "off"
	RepeatOne RepeatMode = "one"
	RepeatAll RepeatMode = "all"
)

type TrackRef struct {
	TrackID string `json:"track_id"`
	Source  string `json:"source"`
	Title   string `json:"title,omitempty"`
	Artist  string `json:"artist,omitempty"`
	URL     string `json:"url,omitempty"`
}

type Session struct {
	ActiveDeviceID      string        `json:"active_device_id"`
	Track               TrackRef      `json:"track"`
	PositionMs          uint64        `json:"position_ms"`
	PositionUpdatedAtNs int64         `json:"position_updated_at_ns"`
	PlaybackState       PlaybackState `json:"playback_state"`
	Queue               []TrackRef    `json:"queue"`
	QueuePosition       uint32        `json:"queue_position"`
	Shuffle             bool          `json:"shuffle"`
	Repeat              RepeatMode    `json:"repeat"`
	LastHeartbeatNs     int64         `json:"last_heartbeat_ns"`
	Version             uint64        `json:"version"`
}

type Op string

const (
	OpPlay       Op = "play"
	OpPause      Op = "pause"
	OpSeek       Op = "seek"
	OpNext       Op = "next"
	OpPrev       Op = "prev"
	OpAddToQueue Op = "add_to_queue"
	OpSetShuffle Op = "set_shuffle"
	OpSetRepeat  Op = "set_repeat"
	OpPlayTrack  Op = "play_track"
	OpTakeover   Op = "takeover"
)

type Command struct {
	Op         Op        `json:"op"`
	ArgInt     int64     `json:"arg_int,omitempty"`
	ArgStr     string    `json:"arg_str,omitempty"`
	ArgTrack   *TrackRef `json:"arg_track,omitempty"`
	IssuedBy   string    `json:"issued_by"`
	IssuedAtNs int64     `json:"issued_at_ns"`
	Nonce      []byte    `json:"nonce"`
}
