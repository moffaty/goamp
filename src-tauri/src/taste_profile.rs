use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TasteProfile {
    pub version: u32,
    pub liked_hashes: Vec<String>,
    pub listen_pairs: Vec<(String, String)>,
    pub genre_weights: std::collections::HashMap<String, f64>,
    pub total_listens: u32,
    pub generated_at: i64,
}

pub fn build_taste_profile(conn: &Connection, max_items: usize) -> TasteProfile {
    TasteProfile {
        version: 1,
        liked_hashes: get_top_liked(conn, max_items),
        listen_pairs: get_listen_pairs(conn, max_items),
        genre_weights: get_genre_weights(conn),
        total_listens: get_total_completed(conn),
        generated_at: chrono::Utc::now().timestamp(),
    }
}

fn get_top_liked(conn: &Connection, limit: usize) -> Vec<String> {
    let mut stmt = conn
        .prepare(
            "SELECT tl.canonical_id, COUNT(lh.id) as cnt
         FROM track_likes tl
         LEFT JOIN listen_history lh ON lh.canonical_id = tl.canonical_id
         WHERE tl.liked = 1
         GROUP BY tl.canonical_id
         ORDER BY cnt DESC
         LIMIT ?1",
        )
        .unwrap();
    stmt.query_map([limit as i64], |row| row.get(0))
        .unwrap()
        .filter_map(|r| r.ok())
        .collect()
}

fn get_listen_pairs(conn: &Connection, limit: usize) -> Vec<(String, String)> {
    let mut stmt = conn
        .prepare(
            "WITH ordered AS (
                SELECT
                    canonical_id,
                    LAG(canonical_id) OVER (ORDER BY started_at) AS prev_canonical_id
                FROM listen_history
                WHERE completed = 1
            )
            SELECT prev_canonical_id, canonical_id
            FROM ordered
            WHERE prev_canonical_id IS NOT NULL
            GROUP BY prev_canonical_id, canonical_id
            ORDER BY COUNT(*) DESC
            LIMIT ?1",
        )
        .unwrap();
    stmt.query_map([limit as i64], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })
    .unwrap()
    .filter_map(|r| r.ok())
    .collect()
}

fn get_genre_weights(conn: &Connection) -> std::collections::HashMap<String, f64> {
    let mut weights = std::collections::HashMap::new();
    let mut stmt = match conn.prepare(
        "SELECT ti.canonical_id, pt.genre, COUNT(lh.id) as cnt
         FROM track_identity ti
         JOIN playlist_tracks pt ON pt.source = ti.source AND pt.source_id = ti.source_id AND pt.genre != ''
         JOIN listen_history lh ON lh.canonical_id = ti.canonical_id AND lh.completed = 1
         GROUP BY ti.canonical_id, pt.genre"
    ) {
        Ok(s) => s,
        Err(_) => return weights,
    };

    let rows: Vec<(String, i64)> = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(1)?, row.get::<_, i64>(2)?))
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    let mut total = 0.0f64;
    for (genre, cnt) in &rows {
        let c = *cnt as f64;
        *weights.entry(genre.to_lowercase()).or_insert(0.0) += c;
        total += c;
    }
    if total > 0.0 {
        for val in weights.values_mut() {
            *val /= total;
        }
    }
    weights
}

fn get_total_completed(conn: &Connection) -> u32 {
    conn.query_row(
        "SELECT COUNT(*) FROM listen_history WHERE completed = 1",
        [],
        |row| row.get(0),
    )
    .unwrap_or(0)
}

// ─── Tauri commands ───

#[tauri::command]
pub fn build_profile(app: tauri::AppHandle) -> Result<TasteProfile, String> {
    let db = app.state::<crate::db::Db>();
    let conn =
        db.0.lock()
            .unwrap_or_else(|e: std::sync::PoisonError<_>| e.into_inner());
    Ok(build_taste_profile(&conn, 200))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_db;
    use crate::history::*;
    use crate::track_id::*;

    fn seed_data(conn: &rusqlite::Connection) {
        resolve_or_create(
            conn,
            "youtube",
            "vid1",
            "Boards of Canada",
            "Dayvan Cowboy",
            300.0,
        );
        resolve_or_create(conn, "youtube", "vid2", "Aphex Twin", "Windowlicker", 390.0);
        resolve_or_create(conn, "youtube", "vid3", "Metallica", "Enter Sandman", 331.0);

        let cid1 = canonical_hash("Boards of Canada", "Dayvan Cowboy");
        let cid2 = canonical_hash("Aphex Twin", "Windowlicker");
        let cid3 = canonical_hash("Metallica", "Enter Sandman");

        for _ in 0..10 {
            record_listen(conn, &cid1, "youtube", 1000, 300, 280, true, false);
        }
        for _ in 0..5 {
            record_listen(conn, &cid2, "youtube", 2000, 390, 390, true, false);
        }
        record_listen(conn, &cid3, "youtube", 3000, 331, 30, false, true);

        set_like(conn, &cid1, true);
        set_like(conn, &cid2, true);
        set_like(conn, &cid3, false);
    }

    #[test]
    fn test_build_taste_profile() {
        let db = test_db();
        let conn = db.0.lock().unwrap();
        seed_data(&conn);
        let profile = build_taste_profile(&conn, 100);
        assert!(!profile.liked_hashes.is_empty());
        assert!(profile.liked_hashes.len() <= 100);
        assert!(profile.total_listens > 0);
    }

    #[test]
    fn test_profile_excludes_disliked() {
        let db = test_db();
        let conn = db.0.lock().unwrap();
        seed_data(&conn);
        let cid3 = canonical_hash("Metallica", "Enter Sandman");
        let profile = build_taste_profile(&conn, 100);
        assert!(!profile.liked_hashes.contains(&cid3));
    }

    #[test]
    fn test_profile_serialization() {
        let db = test_db();
        let conn = db.0.lock().unwrap();
        seed_data(&conn);
        let profile = build_taste_profile(&conn, 100);
        let json = serde_json::to_string(&profile).unwrap();
        let deserialized: TasteProfile = serde_json::from_str(&json).unwrap();
        assert_eq!(profile.liked_hashes, deserialized.liked_hashes);
    }

    #[test]
    fn test_profile_respects_max_items() {
        let db = test_db();
        let conn = db.0.lock().unwrap();
        seed_data(&conn);
        let profile = build_taste_profile(&conn, 1);
        assert!(profile.liked_hashes.len() <= 1);
    }
}
