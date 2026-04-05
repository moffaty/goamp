// src-tauri/src/aggregator.rs

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::sybil::ListeningProof;
use crate::taste_profile::TasteProfile;

const DEFAULT_AGGREGATOR: &str = "https://api.goamp.app/v1";

pub fn store_peer_profile(conn: &Connection, profile_hash: &str, profile_data: &str) {
    let _ = conn.execute(
        "INSERT OR REPLACE INTO peer_profiles (profile_hash, profile_data, received_at)
         VALUES (?1, ?2, unixepoch())",
        rusqlite::params![profile_hash, profile_data],
    );
}

pub fn cache_recommendations(conn: &Connection, recs: &[(String, f64, String)]) {
    for (canonical_id, score, source) in recs {
        let _ = conn.execute(
            "INSERT OR REPLACE INTO recommendation_cache (canonical_id, score, source, cached_at)
             VALUES (?1, ?2, ?3, unixepoch())",
            rusqlite::params![canonical_id, score, source],
        );
    }
}

pub fn get_cached_recommendations(conn: &Connection, limit: usize) -> Vec<(String, f64, String)> {
    let mut stmt = conn.prepare(
        "SELECT canonical_id, score, source FROM recommendation_cache ORDER BY score DESC LIMIT ?1"
    ).unwrap();
    stmt.query_map([limit as i64], |row| {
        Ok((row.get(0)?, row.get(1)?, row.get(2)?))
    })
    .unwrap()
    .filter_map(|r| r.ok())
    .collect()
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProfileSubmission {
    pub profile: TasteProfile,
    pub proofs: Vec<ListeningProof>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AggregatorResponse {
    pub recommendations: Vec<RecommendedTrack>,
    pub peer_count: u32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RecommendedTrack {
    pub canonical_id: String,
    pub score: f64,
    pub source: String,
    pub artist: String,
    pub title: String,
}

pub async fn submit_to_aggregator(
    client: &reqwest::Client,
    base_url: &str,
    submission: &ProfileSubmission,
) -> Result<AggregatorResponse, String> {
    let resp = client
        .post(format!("{}/profiles/submit", base_url))
        .json(submission)
        .header("User-Agent", "GOAMP/1.0")
        .send()
        .await
        .map_err(|e| format!("aggregator request failed: {e}"))?;

    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("aggregator error: {body}"));
    }

    resp.json().await.map_err(|e| format!("parse error: {e}"))
}

// ─── Tauri commands ───

#[tauri::command]
pub async fn sync_profile(app: tauri::AppHandle) -> Result<u32, String> {
    let db = app.state::<crate::db::Db>();
    let (base_url, profile, proofs) = {
        let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
        let base_url = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'aggregator_url'",
                [],
                |row| row.get::<_, String>(0),
            )
            .unwrap_or_else(|_| DEFAULT_AGGREGATOR.to_string());
        let profile = crate::taste_profile::build_taste_profile(&conn, 200);
        let proofs = crate::sybil::generate_proofs(&conn, 200);
        (base_url, profile, proofs)
    };

    let submission = ProfileSubmission { profile, proofs };
    let response = submit_to_aggregator(&crate::http::CLIENT, &base_url, &submission).await?;

    let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
    let recs: Vec<(String, f64, String)> = response
        .recommendations
        .iter()
        .map(|r| (r.canonical_id.clone(), r.score, r.source.clone()))
        .collect();
    cache_recommendations(&conn, &recs);

    eprintln!(
        "[GOAMP] Synced profile, received {} recommendations from {} peers",
        response.recommendations.len(),
        response.peer_count
    );
    Ok(response.recommendations.len() as u32)
}

#[tauri::command]
pub fn get_recommendations(
    app: tauri::AppHandle,
    limit: Option<u32>,
) -> Result<Vec<(String, f64, String)>, String> {
    let db = app.state::<crate::db::Db>();
    let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
    Ok(get_cached_recommendations(
        &conn,
        limit.unwrap_or(50) as usize,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_db;

    #[test]
    fn test_store_peer_profile() {
        let db = test_db();
        let conn = db.0.lock().unwrap();
        let profile_data = r#"{"liked_hashes":["a","b"],"total_listens":50}"#;
        store_peer_profile(&conn, "peer_hash_1", profile_data);
        let stored: String = conn
            .query_row(
                "SELECT profile_data FROM peer_profiles WHERE profile_hash = 'peer_hash_1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(stored, profile_data);
    }

    #[test]
    fn test_cache_recommendations() {
        let db = test_db();
        let conn = db.0.lock().unwrap();
        let recs = vec![
            ("hash_1".to_string(), 0.95, "collaborative".to_string()),
            ("hash_2".to_string(), 0.80, "content".to_string()),
        ];
        cache_recommendations(&conn, &recs);
        let count: i32 = conn
            .query_row("SELECT COUNT(*) FROM recommendation_cache", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 2);
    }

    #[test]
    fn test_get_cached_recommendations() {
        let db = test_db();
        let conn = db.0.lock().unwrap();
        let recs = vec![
            ("hash_1".to_string(), 0.95, "collaborative".to_string()),
            ("hash_2".to_string(), 0.80, "content".to_string()),
        ];
        cache_recommendations(&conn, &recs);
        let cached = get_cached_recommendations(&conn, 10);
        assert_eq!(cached.len(), 2);
        assert_eq!(cached[0].0, "hash_1");
    }
}
