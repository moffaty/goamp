package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/goamp/sdk/proto"
	_ "modernc.org/sqlite" // register "sqlite" driver (no CGO)
)

// SQLiteStore is the production Store backed by a local SQLite database.
// Use Open() to create one.
type SQLiteStore struct {
	db *sql.DB
}

// Open opens (or creates) the SQLite database at dataDir/node.db and runs
// the schema migrations.
// For tests, pass ":memory:" as dataDir to use an in-memory database.
// TODO(you): implement the CRUD methods below.
func Open(dataDir string) (*SQLiteStore, error) {
	var dsn string
	if dataDir == ":memory:" {
		dsn = ":memory:"
	} else {
		dsn = filepath.Join(dataDir, "node.db")
	}
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	if _, err := db.Exec(schema); err != nil {
		return nil, fmt.Errorf("run migrations: %w", err)
	}
	return &SQLiteStore{db: db}, nil
}

func (s *SQLiteStore) Close() error {
	return s.db.Close()
}

// IndexTrack upserts a track into the local catalog.
// TODO(you): INSERT OR REPLACE INTO tracks(...) VALUES(...)
func (s *SQLiteStore) IndexTrack(ctx context.Context, t *proto.Track) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT OR REPLACE INTO tracks
		  (id, musicbrainz_id, artist, title, duration_secs, genre, peer_count)
		VALUES (?, ?, ?, ?, ?, ?, ?)`,
		t.Id, t.MusicbrainzId, t.Artist, t.Title,
		t.DurationSecs, t.Genre, t.PeerCount,
	)
	return err
}

// SearchTracks returns tracks matching q (case-insensitive substring on artist or title)
// and optionally filtered by genres.
// TODO(you): build the SQL dynamically based on genres slice.
func (s *SQLiteStore) SearchTracks(ctx context.Context, q string, genres []string, limit int) ([]*proto.Track, error) {
	if limit <= 0 {
		limit = 20
	}
	like := "%" + strings.ToLower(q) + "%"

	query := `SELECT id, musicbrainz_id, artist, title, duration_secs, genre, peer_count
	          FROM tracks
	          WHERE (LOWER(artist) LIKE ? OR LOWER(title) LIKE ?)`
	args := []any{like, like}

	if len(genres) > 0 {
		placeholders := strings.Repeat("?,", len(genres))
		placeholders = placeholders[:len(placeholders)-1]
		query += " AND genre IN (" + placeholders + ")"
		for _, g := range genres {
			args = append(args, g)
		}
	}
	query += " LIMIT ?"
	args = append(args, limit)

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tracks []*proto.Track
	for rows.Next() {
		t := &proto.Track{}
		if err := rows.Scan(&t.Id, &t.MusicbrainzId, &t.Artist, &t.Title,
			&t.DurationSecs, &t.Genre, &t.PeerCount); err != nil {
			return nil, err
		}
		tracks = append(tracks, t)
	}
	return tracks, rows.Err()
}

// AnnounceProvider records that peerID has the given trackID available.
// TODO(you): INSERT OR REPLACE INTO providers(track_id, peer_id, announced_at) VALUES(?,?,unixepoch())
func (s *SQLiteStore) AnnounceProvider(ctx context.Context, trackID, peerID string) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT OR REPLACE INTO providers (track_id, peer_id, announced_at) VALUES (?, ?, unixepoch())`,
		trackID, peerID)
	return err
}

// FindProviders returns all peerIDs that have announced the given trackID.
func (s *SQLiteStore) FindProviders(ctx context.Context, trackID string) ([]string, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT peer_id FROM providers WHERE track_id = ?`, trackID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var peers []string
	for rows.Next() {
		var pid string
		if err := rows.Scan(&pid); err != nil {
			return nil, err
		}
		peers = append(peers, pid)
	}
	return peers, rows.Err()
}

// UpsertPeer stores or updates a peer in the peer book.
// Addrs and Protocols are serialised as JSON arrays.
// TODO(you): marshal slices to JSON, then INSERT OR REPLACE INTO peers(...)
func (s *SQLiteStore) UpsertPeer(ctx context.Context, p Peer) error {
	addrs, _ := json.Marshal(p.Addrs)
	protocols, _ := json.Marshal(p.Protocols)
	_, err := s.db.ExecContext(ctx, `
		INSERT OR REPLACE INTO peers (peer_id, addrs, node_version, protocols, last_seen, reputation)
		VALUES (?, ?, ?, ?, ?, ?)`,
		p.PeerID, string(addrs), p.NodeVersion, string(protocols), p.LastSeen, p.Reputation,
	)
	return err
}

// ListPeers returns all known peers from the peer book.
func (s *SQLiteStore) ListPeers(ctx context.Context) ([]Peer, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT peer_id, addrs, node_version, protocols, last_seen, reputation FROM peers`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var peers []Peer
	for rows.Next() {
		var p Peer
		var addrs, protocols string
		if err := rows.Scan(&p.PeerID, &addrs, &p.NodeVersion, &protocols, &p.LastSeen, &p.Reputation); err != nil {
			return nil, err
		}
		_ = json.Unmarshal([]byte(addrs), &p.Addrs)
		_ = json.Unmarshal([]byte(protocols), &p.Protocols)
		peers = append(peers, p)
	}
	return peers, rows.Err()
}

// StorePeerProfile saves a received taste profile keyed by its hash.
func (s *SQLiteStore) StorePeerProfile(ctx context.Context, hash string, data []byte) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT OR REPLACE INTO peer_profiles (profile_hash, profile_data) VALUES (?, ?)`,
		hash, string(data))
	return err
}

// CacheRecommendation stores a recommendation score for a track.
func (s *SQLiteStore) CacheRecommendation(ctx context.Context, trackID string, score float64, source string) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT OR REPLACE INTO recommendation_cache (track_id, score, source) VALUES (?, ?, ?)`,
		trackID, score, source)
	return err
}

// GetRecommendations returns the top-N cached recommendations ordered by score.
func (s *SQLiteStore) GetRecommendations(ctx context.Context, limit int) ([]Recommendation, error) {
	if limit <= 0 {
		limit = 20
	}
	rows, err := s.db.QueryContext(ctx,
		`SELECT track_id, score, source, cached_at FROM recommendation_cache ORDER BY score DESC LIMIT ?`,
		limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var recs []Recommendation
	for rows.Next() {
		var r Recommendation
		if err := rows.Scan(&r.TrackID, &r.Score, &r.Source, &r.CachedAt); err != nil {
			return nil, err
		}
		recs = append(recs, r)
	}
	return recs, rows.Err()
}
