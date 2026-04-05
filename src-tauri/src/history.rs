use chrono::{Datelike, Timelike, Utc};
use rusqlite::Connection;
use serde::Serialize;
use tauri::Manager;

/// Record a listening event.
#[allow(clippy::too_many_arguments)]
pub fn record_listen(
    conn: &Connection,
    canonical_id: &str,
    source: &str,
    started_at: i64,
    duration_secs: i32,
    listened_secs: i32,
    completed: bool,
    skipped_early: bool,
) {
    let now = Utc::now();
    let hour = now.hour() as i32;
    let weekday = now.weekday().num_days_from_monday() as i32;

    let _ = conn.execute(
        "INSERT INTO listen_history (canonical_id, source, started_at, duration_secs, listened_secs, completed, skipped_early, context_hour, context_weekday)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        rusqlite::params![
            canonical_id, source, started_at, duration_secs, listened_secs,
            completed as i32, skipped_early as i32, hour, weekday
        ],
    );
}

/// Set like/dislike for a track (upsert).
pub fn set_like(conn: &Connection, canonical_id: &str, liked: bool) {
    let _ = conn.execute(
        "INSERT INTO track_likes (canonical_id, liked, created_at, updated_at)
         VALUES (?1, ?2, unixepoch(), unixepoch())
         ON CONFLICT(canonical_id) DO UPDATE SET liked = ?2, updated_at = unixepoch()",
        rusqlite::params![canonical_id, liked as i32],
    );
}

/// Get like status: Some(true) = liked, Some(false) = disliked, None = no opinion.
pub fn get_like(conn: &Connection, canonical_id: &str) -> Option<bool> {
    conn.query_row(
        "SELECT liked FROM track_likes WHERE canonical_id = ?1",
        [canonical_id],
        |row| {
            let val: i32 = row.get(0)?;
            Ok(val != 0)
        },
    )
    .ok()
}

/// Remove like/dislike entry entirely.
pub fn remove_like(conn: &Connection, canonical_id: &str) {
    let _ = conn.execute(
        "DELETE FROM track_likes WHERE canonical_id = ?1",
        [canonical_id],
    );
}

/// Total listen count for a track.
pub fn get_listen_count(conn: &Connection, canonical_id: &str) -> i32 {
    conn.query_row(
        "SELECT COUNT(*) FROM listen_history WHERE canonical_id = ?1",
        [canonical_id],
        |row| row.get(0),
    )
    .unwrap_or(0)
}

/// Count of completed listens (>80% or explicit completion).
pub fn get_completed_count(conn: &Connection, canonical_id: &str) -> i32 {
    conn.query_row(
        "SELECT COUNT(*) FROM listen_history WHERE canonical_id = ?1 AND completed = 1",
        [canonical_id],
        |row| row.get(0),
    )
    .unwrap_or(0)
}

/// Get all liked track canonical IDs.
pub fn get_liked_canonical_ids(conn: &Connection) -> Vec<String> {
    let mut stmt = conn
        .prepare("SELECT canonical_id FROM track_likes WHERE liked = 1 ORDER BY updated_at DESC")
        .unwrap();
    stmt.query_map([], |row| row.get(0))
        .unwrap()
        .filter_map(|r| r.ok())
        .collect()
}

/// Check if listen duration qualifies as implicit like (>=80% completion).
#[allow(dead_code)]
pub fn is_implicit_like(duration_secs: i32, listened_secs: i32) -> bool {
    if duration_secs <= 0 {
        return false;
    }
    (listened_secs as f64 / duration_secs as f64) >= 0.80
}

// ─── Tauri commands ───

#[derive(Serialize)]
pub struct ListenStats {
    pub canonical_id: String,
    pub listen_count: i32,
    pub completed_count: i32,
    pub liked: Option<bool>,
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn record_track_listen(
    app: tauri::AppHandle,
    canonical_id: String,
    source: String,
    started_at: i64,
    duration_secs: i32,
    listened_secs: i32,
    completed: bool,
    skipped_early: bool,
) -> Result<(), String> {
    let db = app.state::<crate::db::Db>();
    let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
    record_listen(
        &conn,
        &canonical_id,
        &source,
        started_at,
        duration_secs,
        listened_secs,
        completed,
        skipped_early,
    );
    Ok(())
}

#[tauri::command]
pub fn set_track_like(
    app: tauri::AppHandle,
    canonical_id: String,
    liked: bool,
) -> Result<(), String> {
    let db = app.state::<crate::db::Db>();
    let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
    set_like(&conn, &canonical_id, liked);
    Ok(())
}

#[tauri::command]
pub fn remove_track_like(app: tauri::AppHandle, canonical_id: String) -> Result<(), String> {
    let db = app.state::<crate::db::Db>();
    let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
    remove_like(&conn, &canonical_id);
    Ok(())
}

#[tauri::command]
pub fn get_track_stats(app: tauri::AppHandle, canonical_id: String) -> Result<ListenStats, String> {
    let db = app.state::<crate::db::Db>();
    let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
    Ok(ListenStats {
        canonical_id: canonical_id.clone(),
        listen_count: get_listen_count(&conn, &canonical_id),
        completed_count: get_completed_count(&conn, &canonical_id),
        liked: get_like(&conn, &canonical_id),
    })
}

#[tauri::command]
pub fn get_liked_tracks(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let db = app.state::<crate::db::Db>();
    let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
    Ok(get_liked_canonical_ids(&conn))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_db;

    #[test]
    fn test_record_listen() {
        let db = test_db();
        let conn = db.0.lock().unwrap();
        record_listen(
            &conn, "hash_abc", "youtube", 1712200000, 213, 200, true, false,
        );
        let count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM listen_history WHERE canonical_id = 'hash_abc'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
        let completed: i32 = conn
            .query_row(
                "SELECT completed FROM listen_history WHERE canonical_id = 'hash_abc'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(completed, 1);
    }

    #[test]
    fn test_record_like_and_dislike() {
        let db = test_db();
        let conn = db.0.lock().unwrap();
        set_like(&conn, "hash_abc", true);
        assert_eq!(get_like(&conn, "hash_abc"), Some(true));
        set_like(&conn, "hash_abc", false);
        assert_eq!(get_like(&conn, "hash_abc"), Some(false));
    }

    #[test]
    fn test_remove_like() {
        let db = test_db();
        let conn = db.0.lock().unwrap();
        set_like(&conn, "hash_abc", true);
        remove_like(&conn, "hash_abc");
        assert_eq!(get_like(&conn, "hash_abc"), None);
    }

    #[test]
    fn test_get_listen_count() {
        let db = test_db();
        let conn = db.0.lock().unwrap();
        record_listen(&conn, "hash_abc", "youtube", 1000, 200, 200, true, false);
        record_listen(&conn, "hash_abc", "youtube", 2000, 200, 200, true, false);
        record_listen(&conn, "hash_abc", "youtube", 3000, 200, 50, false, true);
        assert_eq!(get_listen_count(&conn, "hash_abc"), 3);
        assert_eq!(get_completed_count(&conn, "hash_abc"), 2);
    }

    #[test]
    fn test_get_liked_tracks() {
        let db = test_db();
        let conn = db.0.lock().unwrap();
        set_like(&conn, "hash_1", true);
        set_like(&conn, "hash_2", true);
        set_like(&conn, "hash_3", false);
        let liked = get_liked_canonical_ids(&conn);
        assert_eq!(liked.len(), 2);
        assert!(liked.contains(&"hash_1".to_string()));
        assert!(liked.contains(&"hash_2".to_string()));
    }

    #[test]
    fn test_implicit_like_from_completion() {
        assert!(is_implicit_like(200, 170));
        assert!(!is_implicit_like(200, 50));
        assert!(is_implicit_like(200, 160));
        assert!(!is_implicit_like(0, 0));
    }
}
