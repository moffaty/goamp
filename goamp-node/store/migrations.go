package store

// schema is the SQLite DDL executed on every Open() call.
// All statements use IF NOT EXISTS so they are idempotent.
// TODO(you): verify column types match the proto.Track fields you use.
const schema = `
CREATE TABLE IF NOT EXISTS tracks (
    id             TEXT PRIMARY KEY,
    musicbrainz_id TEXT,
    acoustid       TEXT,
    artist         TEXT NOT NULL,
    title          TEXT NOT NULL,
    duration_secs  INTEGER,
    genre          TEXT,
    peer_count     INTEGER DEFAULT 1,
    last_seen      INTEGER,
    created_at     INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS providers (
    track_id     TEXT NOT NULL,
    peer_id      TEXT NOT NULL,
    announced_at INTEGER DEFAULT (unixepoch()),
    PRIMARY KEY (track_id, peer_id)
);

CREATE TABLE IF NOT EXISTS peers (
    peer_id      TEXT PRIMARY KEY,
    addrs        TEXT NOT NULL,   -- JSON array of multiaddrs
    node_version TEXT,
    protocols    TEXT,            -- JSON array
    last_seen    INTEGER,
    reputation   INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS peer_profiles (
    profile_hash TEXT PRIMARY KEY,
    profile_data TEXT NOT NULL,   -- JSON TasteProfile
    received_at  INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS recommendation_cache (
    track_id  TEXT PRIMARY KEY,
    score     REAL    NOT NULL,
    source    TEXT    NOT NULL,
    cached_at INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist);
CREATE INDEX IF NOT EXISTS idx_tracks_title  ON tracks(title);
CREATE INDEX IF NOT EXISTS idx_tracks_genre  ON tracks(genre);
`
