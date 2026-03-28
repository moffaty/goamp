use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;

pub struct Db(pub Mutex<Connection>);

impl Db {
    pub fn get_setting(&self, key: &str) -> Option<String> {
        let conn = self.0.lock().unwrap_or_else(|e| e.into_inner());
        conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| {
            row.get(0)
        })
        .ok()
    }

    pub fn set_setting(&self, key: &str, value: &str) {
        let conn = self.0.lock().unwrap_or_else(|e| e.into_inner());
        let _ = conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
            [key, value],
        );
    }
}

pub fn init(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let db_path = db_path(app);
    let conn = Connection::open(&db_path)?;
    migrate(&conn)?;
    app.manage(Db(Mutex::new(conn)));
    eprintln!("[GOAMP] SQLite initialized at {}", db_path.display());
    Ok(())
}

fn db_path(app: &tauri::App) -> PathBuf {
    let dir = app
        .path()
        .app_data_dir()
        .expect("failed to get app data dir");
    std::fs::create_dir_all(&dir).ok();
    dir.join("goamp.db")
}

/// Create an in-memory database for tests.
#[cfg(test)]
pub fn test_db() -> Db {
    let conn = Connection::open_in_memory().unwrap();
    migrate(&conn).unwrap();
    Db(Mutex::new(conn))
}

fn migrate(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS playlists (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            created_at INTEGER NOT NULL DEFAULT (unixepoch()),
            updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
            position INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS playlist_tracks (
            id TEXT PRIMARY KEY,
            playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
            position INTEGER NOT NULL DEFAULT 0,
            title TEXT NOT NULL,
            artist TEXT NOT NULL DEFAULT '',
            duration REAL NOT NULL DEFAULT 0,
            source TEXT NOT NULL DEFAULT 'local',
            source_id TEXT NOT NULL DEFAULT ''
        );

        CREATE INDEX IF NOT EXISTS idx_playlist_tracks_playlist
            ON playlist_tracks(playlist_id, position);

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS scrobble_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            artist TEXT NOT NULL,
            track TEXT NOT NULL,
            album TEXT NOT NULL DEFAULT '',
            timestamp INTEGER NOT NULL,
            duration INTEGER NOT NULL DEFAULT 0,
            service TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            attempts INTEGER NOT NULL DEFAULT 0,
            last_error TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_scrobble_queue_status
            ON scrobble_queue(status, service);

        CREATE TABLE IF NOT EXISTS feature_flags (
            key TEXT PRIMARY KEY,
            enabled INTEGER NOT NULL DEFAULT 1,
            description TEXT NOT NULL DEFAULT ''
        );

        -- Default feature flags
        INSERT OR IGNORE INTO feature_flags (key, enabled, description) VALUES
            ('youtube_search', 1, 'YouTube search and playback'),
            ('soundcloud_search', 1, 'SoundCloud search'),
            ('yandex_music', 1, 'Yandex Music integration'),
            ('lastfm_scrobble', 1, 'Last.fm scrobbling'),
            ('listenbrainz_scrobble', 1, 'ListenBrainz scrobbling'),
            ('visualizer', 1, 'Butterchurn visualizer'),
            ('media_keys', 1, 'System media keys / MPRIS'),
            ('system_tray', 1, 'System tray icon'),
            ('auto_scrobble', 1, 'Auto-scrobble after 50% or 4 min');

        -- Special system playlist for last session
        INSERT OR IGNORE INTO playlists (id, name, position)
            VALUES ('__last_session__', 'Last Session', -1);
        ",
    )?;

    // Migration: add metadata columns to playlist_tracks (safe to run multiple times)
    let has_album: bool = conn
        .prepare("SELECT album FROM playlist_tracks LIMIT 0")
        .is_ok();
    if !has_album {
        conn.execute_batch(
            "
            ALTER TABLE playlist_tracks ADD COLUMN album TEXT NOT NULL DEFAULT '';
            ALTER TABLE playlist_tracks ADD COLUMN original_title TEXT NOT NULL DEFAULT '';
            ALTER TABLE playlist_tracks ADD COLUMN original_artist TEXT NOT NULL DEFAULT '';
            ALTER TABLE playlist_tracks ADD COLUMN cover TEXT NOT NULL DEFAULT '';
            ",
        )?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_migration_creates_tables() {
        let db = test_db();
        let conn = db.0.lock().unwrap();

        // Verify all tables exist
        let tables: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        assert!(tables.contains(&"playlists".to_string()));
        assert!(tables.contains(&"playlist_tracks".to_string()));
        assert!(tables.contains(&"settings".to_string()));
        assert!(tables.contains(&"scrobble_queue".to_string()));
        assert!(tables.contains(&"feature_flags".to_string()));
    }

    #[test]
    fn test_default_feature_flags() {
        let db = test_db();
        let conn = db.0.lock().unwrap();

        let count: i32 = conn
            .query_row("SELECT COUNT(*) FROM feature_flags", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 9);

        // All default flags should be enabled
        let disabled: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM feature_flags WHERE enabled = 0",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(disabled, 0);
    }

    #[test]
    fn test_last_session_playlist_created() {
        let db = test_db();
        let conn = db.0.lock().unwrap();

        let name: String = conn
            .query_row(
                "SELECT name FROM playlists WHERE id = '__last_session__'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(name, "Last Session");
    }

    #[test]
    fn test_migration_is_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        migrate(&conn).unwrap(); // should not fail

        let count: i32 = conn
            .query_row("SELECT COUNT(*) FROM feature_flags", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 9); // INSERT OR IGNORE — no duplicates
    }

    #[test]
    fn test_settings_crud() {
        let db = test_db();
        let conn = db.0.lock().unwrap();

        // Insert
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('test_key', 'test_value')",
            [],
        )
        .unwrap();

        let val: String = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'test_key'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(val, "test_value");

        // Update
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('test_key', 'updated')",
            [],
        )
        .unwrap();

        let val: String = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'test_key'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(val, "updated");
    }

    #[test]
    fn test_scrobble_queue_operations() {
        let db = test_db();
        let conn = db.0.lock().unwrap();

        // Insert items
        conn.execute(
            "INSERT INTO scrobble_queue (artist, track, timestamp, duration, service) VALUES ('Artist1', 'Track1', 1000, 300, 'lastfm')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO scrobble_queue (artist, track, timestamp, duration, service) VALUES ('Artist2', 'Track2', 2000, 200, 'listenbrainz')",
            [],
        )
        .unwrap();

        // Count pending
        let count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM scrobble_queue WHERE status = 'pending'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 2);

        // Increment attempts
        conn.execute(
            "UPDATE scrobble_queue SET attempts = attempts + 1 WHERE artist = 'Artist1'",
            [],
        )
        .unwrap();

        let attempts: i32 = conn
            .query_row(
                "SELECT attempts FROM scrobble_queue WHERE artist = 'Artist1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(attempts, 1);

        // Items with attempts >= 10 should be excluded by flush query
        conn.execute(
            "UPDATE scrobble_queue SET attempts = 10 WHERE artist = 'Artist1'",
            [],
        )
        .unwrap();

        let pending: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM scrobble_queue WHERE status = 'pending' AND attempts < 10",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(pending, 1); // only Artist2
    }

    #[test]
    fn test_feature_flag_toggle() {
        let db = test_db();
        let conn = db.0.lock().unwrap();

        // Disable a flag
        conn.execute(
            "UPDATE feature_flags SET enabled = 0 WHERE key = 'youtube_search'",
            [],
        )
        .unwrap();

        let enabled: i32 = conn
            .query_row(
                "SELECT enabled FROM feature_flags WHERE key = 'youtube_search'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(enabled, 0);

        // Re-enable
        conn.execute(
            "UPDATE feature_flags SET enabled = 1 WHERE key = 'youtube_search'",
            [],
        )
        .unwrap();

        let enabled: i32 = conn
            .query_row(
                "SELECT enabled FROM feature_flags WHERE key = 'youtube_search'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(enabled, 1);
    }

    #[test]
    fn test_playlist_cascade_delete() {
        let db = test_db();
        let conn = db.0.lock().unwrap();

        // Enable foreign keys
        conn.execute("PRAGMA foreign_keys = ON", []).unwrap();

        conn.execute(
            "INSERT INTO playlists (id, name) VALUES ('pl1', 'Test Playlist')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO playlist_tracks (id, playlist_id, title, source, source_id) VALUES ('t1', 'pl1', 'Track 1', 'local', '/path')",
            [],
        )
        .unwrap();

        // Delete playlist
        conn.execute("DELETE FROM playlists WHERE id = 'pl1'", [])
            .unwrap();

        // Tracks should be cascade deleted
        let count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM playlist_tracks WHERE playlist_id = 'pl1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
    }
}
