use chrono::Utc;
use rusqlite::Connection;
use serde::Serialize;
use tauri::Manager;

#[derive(Serialize, Debug, PartialEq)]
pub struct ChartEntry {
    pub canonical_id: String,
    pub artist: String,
    pub title: String,
    pub play_count: i32,
}

/// Cutoff (unix secs) for a chart period. "week"/"month" are relative windows;
/// anything else (incl. "all") means no lower bound.
fn period_cutoff(period: &str) -> i64 {
    let now = Utc::now().timestamp();
    match period {
        "week" => now - 7 * 86_400,
        "month" => now - 30 * 86_400,
        _ => 0,
    }
}

/// Top completed-play tracks in a period, most-played first.
///
/// play_count counts rows in `listen_history` ONLY — artist/title come from
/// correlated subqueries against `track_identity` (which can hold several rows
/// per canonical_id). A LEFT JOIN here would multiply listen rows by identity
/// rows and inflate the count, so we deliberately avoid it.
pub fn get_top_tracks(conn: &Connection, period: &str, limit: i32) -> Vec<ChartEntry> {
    let cutoff = period_cutoff(period);
    let mut stmt = match conn.prepare(
        "SELECT h.canonical_id,
                COALESCE((SELECT MAX(artist) FROM track_identity WHERE canonical_id = h.canonical_id), '') AS artist,
                COALESCE((SELECT MAX(title)  FROM track_identity WHERE canonical_id = h.canonical_id), '') AS title,
                COUNT(*) AS play_count
         FROM listen_history h
         WHERE h.completed = 1 AND h.started_at >= ?1
         GROUP BY h.canonical_id
         ORDER BY play_count DESC, h.canonical_id ASC
         LIMIT ?2",
    ) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };

    let rows = stmt.query_map(rusqlite::params![cutoff, limit], |row| {
        Ok(ChartEntry {
            canonical_id: row.get(0)?,
            artist: row.get(1)?,
            title: row.get(2)?,
            play_count: row.get(3)?,
        })
    });

    match rows {
        Ok(mapped) => mapped.filter_map(|r| r.ok()).collect(),
        Err(_) => Vec::new(),
    }
}

// ─── Tauri command ───

#[tauri::command]
pub fn get_top_tracks_cmd(
    app: tauri::AppHandle,
    period: String,
    limit: i32,
) -> Result<Vec<ChartEntry>, String> {
    let db = app.state::<crate::db::Db>();
    let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
    Ok(get_top_tracks(&conn, &period, limit))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_db;
    use crate::history::record_listen;

    fn seed_identity(conn: &Connection, canonical_id: &str, artist: &str, title: &str) {
        conn.execute(
            "INSERT INTO track_identity (canonical_id, source, source_id, artist, title, duration)
             VALUES (?1, 'youtube', ?2, ?3, ?4, 200)",
            rusqlite::params![canonical_id, canonical_id, artist, title],
        )
        .unwrap();
    }

    #[test]
    fn test_top_tracks_ordering() {
        let db = test_db();
        let conn = db.0.lock().unwrap();
        let now = Utc::now().timestamp();

        for (id, plays) in [("aaa", 5), ("bbb", 3), ("ccc", 1)] {
            seed_identity(&conn, id, "Artist", id);
            for _ in 0..plays {
                record_listen(&conn, id, "youtube", now - 3600, 200, 200, true, false);
            }
        }
        // Non-completed listens must be excluded entirely.
        seed_identity(&conn, "ddd", "Artist", "ddd");
        record_listen(&conn, "ddd", "youtube", now - 3600, 200, 20, false, true);
        record_listen(&conn, "ddd", "youtube", now - 3600, 200, 20, false, true);

        let top = get_top_tracks(&conn, "week", 10);
        assert_eq!(top.len(), 3);
        assert_eq!(top[0].canonical_id, "aaa");
        assert_eq!(top[0].play_count, 5);
        assert_eq!(top[0].title, "aaa");
        assert_eq!(top[1].canonical_id, "bbb");
        assert_eq!(top[1].play_count, 3);
        assert_eq!(top[2].canonical_id, "ccc");
        assert_eq!(top[2].play_count, 1);
    }

    #[test]
    fn test_top_tracks_period_filtering() {
        let db = test_db();
        let conn = db.0.lock().unwrap();
        let now = Utc::now().timestamp();

        seed_identity(&conn, "eee", "A", "E");
        for _ in 0..3 {
            record_listen(
                &conn,
                "eee",
                "youtube",
                now - 2 * 86_400,
                200,
                200,
                true,
                false,
            );
        }
        seed_identity(&conn, "fff", "A", "F");
        for _ in 0..4 {
            record_listen(
                &conn,
                "fff",
                "youtube",
                now - 20 * 86_400,
                200,
                200,
                true,
                false,
            );
        }

        let week = get_top_tracks(&conn, "week", 10);
        assert_eq!(week.len(), 1);
        assert_eq!(week[0].canonical_id, "eee");

        let month = get_top_tracks(&conn, "month", 10);
        assert_eq!(month.len(), 2);
        assert_eq!(month[0].canonical_id, "fff"); // 4 > 3

        let all = get_top_tracks(&conn, "all", 10);
        assert_eq!(all.len(), 2);
    }

    #[test]
    fn test_top_tracks_limit() {
        let db = test_db();
        let conn = db.0.lock().unwrap();
        let now = Utc::now().timestamp();
        for (i, id) in ["a", "b", "c", "d", "e"].iter().enumerate() {
            seed_identity(&conn, id, "A", id);
            for _ in 0..(i + 1) {
                record_listen(&conn, id, "youtube", now - 3600, 200, 200, true, false);
            }
        }
        let top = get_top_tracks(&conn, "all", 3);
        assert_eq!(top.len(), 3);
        assert_eq!(top[0].canonical_id, "e"); // 5 plays
    }

    #[test]
    fn test_top_tracks_empty() {
        let db = test_db();
        let conn = db.0.lock().unwrap();
        assert!(get_top_tracks(&conn, "all", 10).is_empty());
    }

    #[test]
    fn test_top_tracks_dedupes_identity() {
        let db = test_db();
        let conn = db.0.lock().unwrap();
        let now = Utc::now().timestamp();

        // Two identity rows for the same canonical_id (different source_id).
        seed_identity(&conn, "dup", "Artist", "Song");
        conn.execute(
            "INSERT INTO track_identity (canonical_id, source, source_id, artist, title, duration)
             VALUES ('dup', 'local', '/x.mp3', 'Artist', 'Song', 200)",
            [],
        )
        .unwrap();

        for _ in 0..4 {
            record_listen(&conn, "dup", "youtube", now - 3600, 200, 200, true, false);
        }

        let top = get_top_tracks(&conn, "all", 10);
        assert_eq!(
            top.len(),
            1,
            "duplicate identity rows must not split the entry"
        );
        assert_eq!(
            top[0].play_count, 4,
            "play_count must not be inflated by the join"
        );
    }
}
