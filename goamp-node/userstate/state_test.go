package userstate

import (
	"testing"
	"time"
)

func TestMergeLikedTracksUnion(t *testing.T) {
	a := NewUserState()
	b := NewUserState()
	a.LikeTrack("track-1", time.Unix(100, 0))
	b.LikeTrack("track-2", time.Unix(200, 0))

	merged := Merge(a, b)
	if !merged.IsLiked("track-1") {
		t.Fatal("missing track-1")
	}
	if !merged.IsLiked("track-2") {
		t.Fatal("missing track-2")
	}
}

func TestMergeLikeWinsOverOlderUnlike(t *testing.T) {
	a := NewUserState()
	a.LikeTrack("t", time.Unix(100, 0))
	b := NewUserState()
	b.UnlikeTrack("t", time.Unix(50, 0))

	merged := Merge(a, b)
	if !merged.IsLiked("t") {
		t.Fatal("newer like should win over older unlike")
	}
}

func TestMergeUnlikeWinsOverOlderLike(t *testing.T) {
	a := NewUserState()
	a.LikeTrack("t", time.Unix(100, 0))
	b := NewUserState()
	b.UnlikeTrack("t", time.Unix(200, 0))

	merged := Merge(a, b)
	if merged.IsLiked("t") {
		t.Fatal("newer unlike should win")
	}
}

func TestMergeSettingLastWriteWins(t *testing.T) {
	a := NewUserState()
	b := NewUserState()
	a.SetSetting("theme", "dark", time.Unix(100, 0))
	b.SetSetting("theme", "light", time.Unix(200, 0))

	merged := Merge(a, b)
	if v, _ := merged.Setting("theme"); v != "light" {
		t.Fatalf("got %q want light", v)
	}
}

func TestMergePlaylistAddedBoth(t *testing.T) {
	a := NewUserState()
	b := NewUserState()
	a.UpsertPlaylist(Playlist{ID: "p1", Name: "Mixes", Tracks: []string{"t1"}, UpdatedAt: time.Unix(100, 0)})
	b.UpsertPlaylist(Playlist{ID: "p2", Name: "Chill", Tracks: []string{"t2"}, UpdatedAt: time.Unix(150, 0)})

	merged := Merge(a, b)
	if _, ok := merged.Playlist("p1"); !ok {
		t.Fatal("missing p1")
	}
	if _, ok := merged.Playlist("p2"); !ok {
		t.Fatal("missing p2")
	}
}

func TestMergePlaylistNewerWins(t *testing.T) {
	a := NewUserState()
	a.UpsertPlaylist(Playlist{ID: "p", Name: "Old", UpdatedAt: time.Unix(100, 0)})
	b := NewUserState()
	b.UpsertPlaylist(Playlist{ID: "p", Name: "New", UpdatedAt: time.Unix(200, 0)})

	merged := Merge(a, b)
	p, _ := merged.Playlist("p")
	if p.Name != "New" {
		t.Fatalf("got %q", p.Name)
	}
}

func TestJSONRoundTrip(t *testing.T) {
	s := NewUserState()
	s.LikeTrack("t", time.Unix(100, 0))
	s.SetSetting("theme", "dark", time.Unix(50, 0))
	s.UpsertPlaylist(Playlist{ID: "p", Name: "X", UpdatedAt: time.Unix(200, 0)})

	data, err := s.MarshalJSON()
	if err != nil {
		t.Fatal(err)
	}
	var back UserState
	if err := back.UnmarshalJSON(data); err != nil {
		t.Fatal(err)
	}
	if !back.IsLiked("t") {
		t.Fatal("liked lost")
	}
	if v, _ := back.Setting("theme"); v != "dark" {
		t.Fatal("setting lost")
	}
	if p, _ := back.Playlist("p"); p.Name != "X" {
		t.Fatal("playlist lost")
	}
}
