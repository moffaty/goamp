use crate::db::Db;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Playlist {
    pub id: String,
    pub name: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub track_count: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PlaylistTrack {
    pub id: String,
    pub position: i32,
    pub title: String,
    pub artist: String,
    pub duration: f64,
    pub source: String,
    pub source_id: String,
    pub album: String,
    pub original_title: String,
    pub original_artist: String,
    pub cover: String,
}

#[derive(Debug, Deserialize)]
pub struct TrackInput {
    pub title: String,
    pub artist: String,
    pub duration: f64,
    pub source: String,
    pub source_id: String,
    #[serde(default)]
    pub album: String,
    #[serde(default)]
    pub original_title: String,
    #[serde(default)]
    pub original_artist: String,
    #[serde(default)]
    pub cover: String,
}

#[tauri::command]
pub fn create_playlist(db: State<'_, Db>, name: String) -> Result<Playlist, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;

    let max_pos: i32 = conn
        .query_row(
            "SELECT COALESCE(MAX(position), 0) FROM playlists WHERE id != '__last_session__'",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);

    conn.execute(
        "INSERT INTO playlists (id, name, created_at, updated_at, position) VALUES (?1, ?2, ?3, ?3, ?4)",
        params![id, name, now, max_pos + 1],
    )
    .map_err(|e| e.to_string())?;

    Ok(Playlist {
        id,
        name,
        created_at: now,
        updated_at: now,
        track_count: 0,
    })
}

#[tauri::command]
pub fn list_playlists(db: State<'_, Db>) -> Result<Vec<Playlist>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT p.id, p.name, p.created_at, p.updated_at,
                    (SELECT COUNT(*) FROM playlist_tracks WHERE playlist_id = p.id)
             FROM playlists p
             WHERE p.id != '__last_session__'
             ORDER BY p.position",
        )
        .map_err(|e| e.to_string())?;

    let playlists = stmt
        .query_map([], |row| {
            Ok(Playlist {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: row.get(2)?,
                updated_at: row.get(3)?,
                track_count: row.get::<_, i32>(4)? as usize,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(playlists)
}

#[tauri::command]
pub fn get_playlist_tracks(
    db: State<'_, Db>,
    playlist_id: String,
) -> Result<Vec<PlaylistTrack>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, position, title, artist, duration, source, source_id, album, original_title, original_artist, cover
             FROM playlist_tracks
             WHERE playlist_id = ?1
             ORDER BY position",
        )
        .map_err(|e| e.to_string())?;

    let tracks = stmt
        .query_map(params![playlist_id], |row| {
            Ok(PlaylistTrack {
                id: row.get(0)?,
                position: row.get(1)?,
                title: row.get(2)?,
                artist: row.get(3)?,
                duration: row.get(4)?,
                source: row.get(5)?,
                source_id: row.get(6)?,
                album: row.get(7)?,
                original_title: row.get(8)?,
                original_artist: row.get(9)?,
                cover: row.get(10)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(tracks)
}

#[tauri::command]
pub fn add_track_to_playlist(
    db: State<'_, Db>,
    playlist_id: String,
    track: TrackInput,
) -> Result<PlaylistTrack, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();

    let max_pos: i32 = conn
        .query_row(
            "SELECT COALESCE(MAX(position), -1) FROM playlist_tracks WHERE playlist_id = ?1",
            params![playlist_id],
            |r| r.get(0),
        )
        .unwrap_or(-1);

    let position = max_pos + 1;

    conn.execute(
        "INSERT INTO playlist_tracks (id, playlist_id, position, title, artist, duration, source, source_id, album, original_title, original_artist, cover)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        params![
            id,
            playlist_id,
            position,
            track.title,
            track.artist,
            track.duration,
            track.source,
            track.source_id,
            track.album,
            track.original_title,
            track.original_artist,
            track.cover
        ],
    )
    .map_err(|e| e.to_string())?;

    // Update playlist timestamp
    conn.execute(
        "UPDATE playlists SET updated_at = unixepoch() WHERE id = ?1",
        params![playlist_id],
    )
    .ok();

    Ok(PlaylistTrack {
        id,
        position,
        title: track.title,
        artist: track.artist,
        duration: track.duration,
        source: track.source,
        source_id: track.source_id,
        album: track.album,
        original_title: track.original_title,
        original_artist: track.original_artist,
        cover: track.cover,
    })
}

#[tauri::command]
pub fn remove_track_from_playlist(db: State<'_, Db>, track_id: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM playlist_tracks WHERE id = ?1",
        params![track_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_playlist(db: State<'_, Db>, playlist_id: String) -> Result<(), String> {
    if playlist_id == "__last_session__" {
        return Err("Cannot delete system playlist".into());
    }
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM playlist_tracks WHERE playlist_id = ?1",
        params![playlist_id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM playlists WHERE id = ?1", params![playlist_id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn save_session(db: State<'_, Db>, tracks: Vec<TrackInput>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    // Clear old session
    conn.execute(
        "DELETE FROM playlist_tracks WHERE playlist_id = '__last_session__'",
        [],
    )
    .map_err(|e| e.to_string())?;

    for (i, track) in tracks.iter().enumerate() {
        let id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO playlist_tracks (id, playlist_id, position, title, artist, duration, source, source_id, album, original_title, original_artist, cover)
             VALUES (?1, '__last_session__', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                id,
                i as i32,
                track.title,
                track.artist,
                track.duration,
                track.source,
                track.source_id,
                track.album,
                track.original_title,
                track.original_artist,
                track.cover
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub fn load_session(db: State<'_, Db>) -> Result<Vec<PlaylistTrack>, String> {
    get_playlist_tracks(db, "__last_session__".to_string())
}

#[tauri::command]
pub fn rename_track(
    db: State<'_, Db>,
    track_id: String,
    title: Option<String>,
    artist: Option<String>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    // Save original values before first rename
    if let Some(ref new_title) = title {
        conn.execute(
            "UPDATE playlist_tracks SET original_title = CASE WHEN original_title = '' THEN title ELSE original_title END, title = ?1 WHERE id = ?2",
            params![new_title, track_id],
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(ref new_artist) = artist {
        conn.execute(
            "UPDATE playlist_tracks SET original_artist = CASE WHEN original_artist = '' THEN artist ELSE original_artist END, artist = ?1 WHERE id = ?2",
            params![new_artist, track_id],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}
