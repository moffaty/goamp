use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;

pub struct Db(pub Mutex<Connection>);

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

        -- Special system playlist for last session
        INSERT OR IGNORE INTO playlists (id, name, position)
            VALUES ('__last_session__', 'Last Session', -1);
        ",
    )?;
    Ok(())
}
