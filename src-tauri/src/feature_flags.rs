use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::db::Db;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FeatureFlag {
    pub key: String,
    pub enabled: bool,
    pub description: String,
}

#[tauri::command]
pub fn feature_flags_list(app: tauri::AppHandle) -> Result<Vec<FeatureFlag>, String> {
    let db = app.state::<Db>();
    let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
    let mut stmt = conn
        .prepare("SELECT key, enabled, description FROM feature_flags ORDER BY key")
        .map_err(|e| format!("query failed: {e}"))?;
    let result = stmt
        .query_map([], |row| {
            Ok(FeatureFlag {
                key: row.get(0)?,
                enabled: row.get::<_, i32>(1)? != 0,
                description: row.get(2)?,
            })
        })
        .map_err(|e| format!("query failed: {e}"))?
        .filter_map(|r| r.ok())
        .collect();
    Ok(result)
}

#[tauri::command]
pub fn feature_flags_set(app: tauri::AppHandle, key: String, enabled: bool) -> Result<(), String> {
    let db = app.state::<Db>();
    let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
    conn.execute(
        "UPDATE feature_flags SET enabled = ?1 WHERE key = ?2",
        rusqlite::params![enabled as i32, key],
    )
    .map_err(|e| format!("update failed: {e}"))?;
    eprintln!("[GOAMP] Feature flag '{}' = {}", key, enabled);
    Ok(())
}

#[tauri::command]
pub fn feature_flag_get(app: tauri::AppHandle, key: String) -> Result<bool, String> {
    let db = app.state::<Db>();
    let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
    let enabled: i32 = conn
        .query_row(
            "SELECT enabled FROM feature_flags WHERE key = ?1",
            [&key],
            |row| row.get(0),
        )
        .unwrap_or(1); // default: enabled
    Ok(enabled != 0)
}
