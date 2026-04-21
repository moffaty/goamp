package userstate

import (
	"encoding/json"
	"time"
)

type Playlist struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Tracks    []string  `json:"tracks"`
	UpdatedAt time.Time `json:"updated_at"`
}

type stampedBool struct {
	Value     bool      `json:"value"`
	UpdatedAt time.Time `json:"updated_at"`
}

type stampedString struct {
	Value     string    `json:"value"`
	UpdatedAt time.Time `json:"updated_at"`
}

type UserState struct {
	Playlists   map[string]Playlist      `json:"playlists"`
	LikedTracks map[string]stampedBool   `json:"liked_tracks"`
	Settings    map[string]stampedString `json:"settings"`
}

func NewUserState() *UserState {
	return &UserState{
		Playlists:   map[string]Playlist{},
		LikedTracks: map[string]stampedBool{},
		Settings:    map[string]stampedString{},
	}
}

func (s *UserState) LikeTrack(id string, at time.Time) {
	s.LikedTracks[id] = stampedBool{Value: true, UpdatedAt: at.UTC()}
}

func (s *UserState) UnlikeTrack(id string, at time.Time) {
	s.LikedTracks[id] = stampedBool{Value: false, UpdatedAt: at.UTC()}
}

func (s *UserState) IsLiked(id string) bool {
	v, ok := s.LikedTracks[id]
	return ok && v.Value
}

func (s *UserState) SetSetting(key, value string, at time.Time) {
	s.Settings[key] = stampedString{Value: value, UpdatedAt: at.UTC()}
}

func (s *UserState) Setting(key string) (string, bool) {
	v, ok := s.Settings[key]
	if !ok {
		return "", false
	}
	return v.Value, true
}

func (s *UserState) UpsertPlaylist(p Playlist) {
	p.UpdatedAt = p.UpdatedAt.UTC()
	s.Playlists[p.ID] = p
}

func (s *UserState) Playlist(id string) (Playlist, bool) {
	p, ok := s.Playlists[id]
	return p, ok
}

func (s *UserState) MarshalJSON() ([]byte, error) {
	type alias UserState
	return json.Marshal((*alias)(s))
}

func (s *UserState) UnmarshalJSON(data []byte) error {
	type alias UserState
	tmp := &alias{}
	if err := json.Unmarshal(data, tmp); err != nil {
		return err
	}
	if tmp.Playlists == nil {
		tmp.Playlists = map[string]Playlist{}
	}
	if tmp.LikedTracks == nil {
		tmp.LikedTracks = map[string]stampedBool{}
	}
	if tmp.Settings == nil {
		tmp.Settings = map[string]stampedString{}
	}
	*s = UserState(*tmp)
	return nil
}

// Merge combines a and b by LWW on every stamped field. Neither argument
// is mutated.
func Merge(a, b *UserState) *UserState {
	out := NewUserState()
	mergeStampedBools(out.LikedTracks, a.LikedTracks, b.LikedTracks)
	mergeStampedStrings(out.Settings, a.Settings, b.Settings)
	mergePlaylists(out.Playlists, a.Playlists, b.Playlists)
	return out
}

func mergeStampedBools(out, a, b map[string]stampedBool) {
	for k, v := range a {
		out[k] = v
	}
	for k, v := range b {
		cur, ok := out[k]
		if !ok || v.UpdatedAt.After(cur.UpdatedAt) {
			out[k] = v
		}
	}
}

func mergeStampedStrings(out, a, b map[string]stampedString) {
	for k, v := range a {
		out[k] = v
	}
	for k, v := range b {
		cur, ok := out[k]
		if !ok || v.UpdatedAt.After(cur.UpdatedAt) {
			out[k] = v
		}
	}
}

func mergePlaylists(out, a, b map[string]Playlist) {
	for k, v := range a {
		out[k] = v
	}
	for k, v := range b {
		cur, ok := out[k]
		if !ok || v.UpdatedAt.After(cur.UpdatedAt) {
			out[k] = v
		}
	}
}
