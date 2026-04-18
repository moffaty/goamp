// src-tauri/src/aggregator.rs

use rusqlite::Connection;
use serde::Deserialize;
use tauri::Manager;

use crate::taste_profile::TasteProfile;

type RecEntry = (String, f64, String, String, String);

#[allow(dead_code)]
pub fn store_peer_profile(conn: &Connection, profile_hash: &str, profile_data: &str) {
    let _ = conn.execute(
        "INSERT OR REPLACE INTO peer_profiles (profile_hash, profile_data, received_at)
         VALUES (?1, ?2, unixepoch())",
        rusqlite::params![profile_hash, profile_data],
    );
}

pub fn cache_recommendations(conn: &Connection, recs: &[RecEntry]) {
    // tuple: (canonical_id, score, source, artist, title)
    for (canonical_id, score, source, artist, title) in recs {
        let metadata = serde_json::json!({ "artist": artist, "title": title }).to_string();
        let _ = conn.execute(
            "INSERT OR REPLACE INTO recommendation_cache (canonical_id, score, source, metadata, cached_at)
             VALUES (?1, ?2, ?3, ?4, unixepoch())",
            rusqlite::params![canonical_id, score, source, metadata],
        );
    }
}

pub fn get_cached_recommendations(conn: &Connection, limit: usize) -> Vec<RecEntry> {
    let mut stmt = conn.prepare(
        "SELECT canonical_id, score, source, metadata FROM recommendation_cache ORDER BY score DESC LIMIT ?1"
    ).unwrap();
    stmt.query_map([limit as i64], |row| {
        let metadata_json: String = row.get(3).unwrap_or_default();
        let meta: serde_json::Value = serde_json::from_str(&metadata_json).unwrap_or_default();
        let artist = meta
            .get("artist")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let title = meta
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        Ok((row.get(0)?, row.get(1)?, row.get(2)?, artist, title))
    })
    .unwrap()
    .filter_map(|r| r.ok())
    .collect()
}

/// POST the local taste profile to the goamp-node sidecar for GossipSub broadcast.
pub async fn sync_to_node(profile: &TasteProfile, port: u16) -> Result<(), String> {
    let resp = crate::http::CLIENT
        .post(format!("http://localhost:{port}/profiles/sync"))
        .json(profile)
        .header("User-Agent", "GOAMP/1.0")
        .send()
        .await
        .map_err(|e| format!("node sync failed: {e}"))?;

    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("node error: {body}"));
    }
    Ok(())
}

#[derive(Deserialize)]
struct PeerProfileEntry {
    hash: String,
    data: serde_json::Value,
}

#[derive(Deserialize)]
struct PeersResponse {
    profiles: Vec<PeerProfileEntry>,
}

/// Fetch peer taste profiles from the goamp-node sidecar.
/// Returns (profile_hash, profile_data_json) ready to insert into Tauri SQLite.
pub async fn fetch_peer_profiles(port: u16) -> Result<Vec<(String, String)>, String> {
    let resp = crate::http::CLIENT
        .get(format!("http://localhost:{port}/profiles/peers?limit=100"))
        .send()
        .await
        .map_err(|e| format!("fetch peers failed: {e}"))?;

    if !resp.status().is_success() {
        return Ok(vec![]);
    }

    let body: PeersResponse = resp.json().await.map_err(|e| format!("parse error: {e}"))?;
    Ok(body
        .profiles
        .into_iter()
        .filter_map(|e| {
            serde_json::to_string(&e.data)
                .ok()
                .map(|data| (e.hash, data))
        })
        .collect())
}

// ─── Tauri commands ───

#[tauri::command]
pub async fn sync_profile(app: tauri::AppHandle) -> Result<u32, String> {
    let db = app.state::<crate::db::Db>();
    let profile = {
        let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
        crate::taste_profile::build_taste_profile(&conn, 200)
    };

    let count = profile.liked_hashes.len() as u32;
    sync_to_node(&profile, 7472).await?;
    eprintln!("[GOAMP] Profile synced to node ({count} liked tracks)");
    Ok(count)
}

#[tauri::command]
pub fn get_recommendations(
    app: tauri::AppHandle,
    limit: Option<u32>,
) -> Result<Vec<RecEntry>, String> {
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
            (
                "hash_1".to_string(),
                0.95,
                "collaborative".to_string(),
                "Artist A".to_string(),
                "Track 1".to_string(),
            ),
            (
                "hash_2".to_string(),
                0.80,
                "content".to_string(),
                "Artist B".to_string(),
                "Track 2".to_string(),
            ),
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
            (
                "hash_1".to_string(),
                0.95,
                "collaborative".to_string(),
                "Artist A".to_string(),
                "Track 1".to_string(),
            ),
            (
                "hash_2".to_string(),
                0.80,
                "content".to_string(),
                "Artist B".to_string(),
                "Track 2".to_string(),
            ),
        ];
        cache_recommendations(&conn, &recs);
        let cached = get_cached_recommendations(&conn, 10);
        assert_eq!(cached.len(), 2);
        assert_eq!(cached[0].0, "hash_1");
        assert_eq!(cached[0].3, "Artist A");
        assert_eq!(cached[0].4, "Track 1");
    }
}
