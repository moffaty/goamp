use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::Manager;

#[derive(Debug, Serialize, Deserialize)]
pub struct Survey {
    pub id: i64,
    pub survey_type: String,
    pub payload: String,
    pub created_at: i64,
}

pub fn create_similarity_survey(
    conn: &Connection,
    track_a: &str,
    track_b: &str,
    track_c: &str,
) -> Result<Survey, rusqlite::Error> {
    let payload = serde_json::json!({ "tracks": [track_a, track_b, track_c] }).to_string();
    conn.execute(
        "INSERT INTO surveys (survey_type, payload) VALUES ('similarity', ?1)",
        [&payload],
    )?;
    let id = conn.last_insert_rowid();
    Ok(Survey {
        id,
        survey_type: "similarity".to_string(),
        payload,
        created_at: 0,
    })
}

pub fn create_genre_survey(
    conn: &Connection,
    track: &str,
    options: &[&str],
) -> Result<Survey, rusqlite::Error> {
    let payload = serde_json::json!({ "track": track, "options": options }).to_string();
    conn.execute(
        "INSERT INTO surveys (survey_type, payload) VALUES ('genre', ?1)",
        [&payload],
    )?;
    let id = conn.last_insert_rowid();
    Ok(Survey {
        id,
        survey_type: "genre".to_string(),
        payload,
        created_at: 0,
    })
}

pub fn create_mood_survey(conn: &Connection, track: &str) -> Result<Survey, rusqlite::Error> {
    let payload =
        serde_json::json!({ "track": track, "choices": ["energetic", "calm"] }).to_string();
    conn.execute(
        "INSERT INTO surveys (survey_type, payload) VALUES ('mood', ?1)",
        [&payload],
    )?;
    let id = conn.last_insert_rowid();
    Ok(Survey {
        id,
        survey_type: "mood".to_string(),
        payload,
        created_at: 0,
    })
}

pub fn respond_to_survey(conn: &Connection, survey_id: i64, response: &str) {
    let _ = conn.execute(
        "INSERT INTO survey_responses (survey_id, response) VALUES (?1, ?2)",
        rusqlite::params![survey_id, response],
    );
    let _ = conn.execute("UPDATE surveys SET answered = 1 WHERE id = ?1", [survey_id]);
}

pub fn get_pending_survey(conn: &Connection) -> Option<Survey> {
    conn.query_row(
        "SELECT id, survey_type, payload, created_at FROM surveys WHERE shown = 0 AND answered = 0 ORDER BY id LIMIT 1",
        [],
        |row| Ok(Survey {
            id: row.get(0)?,
            survey_type: row.get(1)?,
            payload: row.get(2)?,
            created_at: row.get(3)?,
        }),
    ).ok()
}

pub fn mark_shown(conn: &Connection, survey_id: i64) {
    let _ = conn.execute("UPDATE surveys SET shown = 1 WHERE id = ?1", [survey_id]);
}

pub fn skip_survey(conn: &Connection, survey_id: i64) {
    mark_shown(conn, survey_id);
}

// ─── Tauri commands ───

#[tauri::command]
pub fn survey_get_pending(app: tauri::AppHandle) -> Result<Option<Survey>, String> {
    let db = app.state::<crate::db::Db>();
    let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
    Ok(get_pending_survey(&conn))
}

#[tauri::command]
pub fn survey_respond(
    app: tauri::AppHandle,
    survey_id: i64,
    response: String,
) -> Result<(), String> {
    let db = app.state::<crate::db::Db>();
    let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
    respond_to_survey(&conn, survey_id, &response);
    Ok(())
}

#[tauri::command]
pub fn survey_skip(app: tauri::AppHandle, survey_id: i64) -> Result<(), String> {
    let db = app.state::<crate::db::Db>();
    let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
    skip_survey(&conn, survey_id);
    Ok(())
}

#[tauri::command]
pub fn survey_mark_shown(app: tauri::AppHandle, survey_id: i64) -> Result<(), String> {
    let db = app.state::<crate::db::Db>();
    let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
    mark_shown(&conn, survey_id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_db;

    #[test]
    fn test_create_similarity_survey() {
        let db = test_db();
        let conn = db.0.lock().unwrap();
        let survey = create_similarity_survey(&conn, "hash_a", "hash_b", "hash_c").unwrap();
        assert!(survey.id > 0);
        assert_eq!(survey.survey_type, "similarity");
    }

    #[test]
    fn test_create_genre_survey() {
        let db = test_db();
        let conn = db.0.lock().unwrap();
        let survey =
            create_genre_survey(&conn, "hash_a", &["electronic", "ambient", "rock", "jazz"])
                .unwrap();
        assert!(survey.id > 0);
        assert_eq!(survey.survey_type, "genre");
    }

    #[test]
    fn test_create_mood_survey() {
        let db = test_db();
        let conn = db.0.lock().unwrap();
        let survey = create_mood_survey(&conn, "hash_a").unwrap();
        assert!(survey.id > 0);
        assert_eq!(survey.survey_type, "mood");
    }

    #[test]
    fn test_respond_to_survey() {
        let db = test_db();
        let conn = db.0.lock().unwrap();
        let survey = create_mood_survey(&conn, "hash_a").unwrap();
        respond_to_survey(&conn, survey.id, "energetic");
        let answered: i32 = conn
            .query_row(
                "SELECT answered FROM surveys WHERE id = ?1",
                [survey.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(answered, 1);
    }

    #[test]
    fn test_get_pending_survey_respects_cooldown() {
        let db = test_db();
        let conn = db.0.lock().unwrap();
        create_mood_survey(&conn, "hash_a").unwrap();
        let pending = get_pending_survey(&conn);
        assert!(pending.is_some());
        if let Some(s) = pending {
            mark_shown(&conn, s.id);
        }
        let pending2 = get_pending_survey(&conn);
        assert!(pending2.is_none());
    }

    #[test]
    fn test_skip_survey() {
        let db = test_db();
        let conn = db.0.lock().unwrap();
        let survey = create_mood_survey(&conn, "hash_a").unwrap();
        skip_survey(&conn, survey.id);
        let shown: i32 = conn
            .query_row(
                "SELECT shown FROM surveys WHERE id = ?1",
                [survey.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(shown, 1);
    }
}
