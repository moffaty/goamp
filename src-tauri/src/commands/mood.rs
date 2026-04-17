use crate::db::Db;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MoodTrackScore {
    pub mood_id: String,
    pub canonical_id: String,
    pub play_count: i32,
    pub completion_rate: f64,
    pub skip_rate: f64,
}

// ── Internal helpers ─────────────────────────────────────────────────────────

pub fn record_mood_play_internal(
    db: &Db,
    mood_id: &str,
    canonical_id: &str,
    completion_rate: f64,
    skipped: bool,
) -> Result<(), String> {
    let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
    let skip_val = if skipped { 1.0_f64 } else { 0.0_f64 };
    conn.execute(
        "INSERT INTO mood_track_scores (mood_id, canonical_id, play_count, completion_rate, skip_rate, last_played_at)
         VALUES (?1, ?2, 1, ?3, ?4, unixepoch())
         ON CONFLICT(mood_id, canonical_id) DO UPDATE SET
           play_count = play_count + 1,
           completion_rate = (completion_rate * play_count + ?3) / (play_count + 1),
           skip_rate      = (skip_rate      * play_count + ?4) / (play_count + 1),
           last_played_at = unixepoch()",
        rusqlite::params![mood_id, canonical_id, completion_rate, skip_val],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_mood_track_scores_internal(
    db: &Db,
    mood_id: &str,
) -> Result<Vec<MoodTrackScore>, String> {
    let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
    let mut stmt = conn
        .prepare(
            "SELECT mood_id, canonical_id, play_count, completion_rate, skip_rate
             FROM mood_track_scores WHERE mood_id = ?1
             ORDER BY completion_rate DESC",
        )
        .map_err(|e| e.to_string())?;
    let scores = stmt
        .query_map(rusqlite::params![mood_id], |row| {
            Ok(MoodTrackScore {
                mood_id: row.get(0)?,
                canonical_id: row.get(1)?,
                play_count: row.get(2)?,
                completion_rate: row.get(3)?,
                skip_rate: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(scores)
}

pub fn record_signal_internal(
    db: &Db,
    canonical_id: &str,
    signal: i32,
    scope: &str,
) -> Result<(), String> {
    let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
    conn.execute(
        "INSERT INTO track_signals (canonical_id, signal, scope) VALUES (?1, ?2, ?3)",
        rusqlite::params![canonical_id, signal, scope],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_tag_weight_internal(db: &Db, tag: &str, scope: &str) -> Result<f64, String> {
    let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
    let weight: f64 = conn
        .query_row(
            "SELECT weight FROM tag_weights WHERE tag = ?1 AND scope = ?2",
            rusqlite::params![tag, scope],
            |r| r.get(0),
        )
        .unwrap_or(1.0);
    Ok(weight)
}

pub fn delete_signal_internal(
    db: &Db,
    canonical_id: &str,
    signal: i32,
    scope: &str,
) -> Result<(), String> {
    let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
    conn.execute(
        "DELETE FROM track_signals WHERE canonical_id = ?1 AND signal = ?2 AND scope = ?3",
        rusqlite::params![canonical_id, signal, scope],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn set_tag_weight_internal(db: &Db, tag: &str, scope: &str, weight: f64) -> Result<(), String> {
    let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
    conn.execute(
        "INSERT INTO tag_weights (tag, scope, weight) VALUES (?1, ?2, ?3)
         ON CONFLICT(tag, scope) DO UPDATE SET weight = ?3",
        rusqlite::params![tag, scope, weight],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn record_mood_play(
    db: State<Db>,
    mood_id: String,
    canonical_id: String,
    completion_rate: f64,
    skipped: bool,
) -> Result<(), String> {
    record_mood_play_internal(&db, &mood_id, &canonical_id, completion_rate, skipped)
}

#[tauri::command]
pub fn get_mood_track_scores(
    db: State<Db>,
    mood_id: String,
) -> Result<Vec<MoodTrackScore>, String> {
    get_mood_track_scores_internal(&db, &mood_id)
}

#[tauri::command]
pub fn record_track_signal(
    db: State<Db>,
    canonical_id: String,
    signal: i32,
    scope: String,
) -> Result<(), String> {
    record_signal_internal(&db, &canonical_id, signal, &scope)
}

#[tauri::command]
pub fn delete_track_signal(
    db: State<Db>,
    canonical_id: String,
    signal: i32,
    scope: String,
) -> Result<(), String> {
    delete_signal_internal(&db, &canonical_id, signal, &scope)
}

#[tauri::command]
pub fn set_tag_weight(
    db: State<Db>,
    tag: String,
    scope: String,
    weight: f64,
) -> Result<(), String> {
    set_tag_weight_internal(&db, &tag, &scope, weight)
}

#[tauri::command]
pub fn get_tag_weight(db: State<Db>, tag: String, scope: String) -> Result<f64, String> {
    get_tag_weight_internal(&db, &tag, &scope)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_db;

    #[test]
    fn test_record_mood_play_creates_and_updates_score() {
        let db = test_db();
        record_mood_play_internal(&db, "calm", "hash_abc", 0.9, false).unwrap();
        let conn = db.0.lock().unwrap();
        let (play_count, completion_rate): (i32, f64) = conn
            .query_row(
                "SELECT play_count, completion_rate FROM mood_track_scores WHERE mood_id='calm' AND canonical_id='hash_abc'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(play_count, 1);
        assert!((completion_rate - 0.9).abs() < 0.01);
    }

    #[test]
    fn test_record_mood_play_running_average() {
        let db = test_db();
        record_mood_play_internal(&db, "calm", "track1", 1.0, false).unwrap();
        record_mood_play_internal(&db, "calm", "track1", 0.0, true).unwrap();
        let conn = db.0.lock().unwrap();
        let (play_count, completion_rate, skip_rate): (i32, f64, f64) = conn
            .query_row(
                "SELECT play_count, completion_rate, skip_rate FROM mood_track_scores WHERE mood_id='calm' AND canonical_id='track1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(play_count, 2);
        assert!((completion_rate - 0.5).abs() < 0.01);
        assert!((skip_rate - 0.5).abs() < 0.01);
    }

    #[test]
    fn test_record_signal() {
        let db = test_db();
        record_signal_internal(&db, "hash_abc", -1, "global").unwrap();
        let conn = db.0.lock().unwrap();
        let sig: i32 = conn
            .query_row(
                "SELECT signal FROM track_signals WHERE canonical_id='hash_abc'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(sig, -1);
    }

    #[test]
    fn test_delete_signal() {
        let db = test_db();
        record_signal_internal(&db, "hash_abc", -1, "global").unwrap();
        delete_signal_internal(&db, "hash_abc", -1, "global").unwrap();
        let conn = db.0.lock().unwrap();
        let count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM track_signals WHERE canonical_id='hash_abc'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn test_tag_weight_default_is_one() {
        let db = test_db();
        let w = get_tag_weight_internal(&db, "nonexistent", "global").unwrap();
        assert!((w - 1.0).abs() < 0.001);
    }

    #[test]
    fn test_set_and_get_tag_weight() {
        let db = test_db();
        set_tag_weight_internal(&db, "chill", "global", 0.3).unwrap();
        let w = get_tag_weight_internal(&db, "chill", "global").unwrap();
        assert!((w - 0.3).abs() < 0.001);
    }
}
