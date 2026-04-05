// src-tauri/src/recommend.rs

use rusqlite::Connection;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use tauri::Manager;

/// Collaborative filtering: tracks liked by similar peers but not yet liked by user.
pub fn collaborative_recommend(
    conn: &Connection,
    my_likes: &[String],
    limit: usize,
) -> Vec<(String, f64, String)> {
    let my_set: HashSet<&str> = my_likes.iter().map(|s| s.as_str()).collect();
    if my_set.is_empty() {
        return vec![];
    }

    let mut stmt = conn
        .prepare("SELECT profile_data FROM peer_profiles ORDER BY received_at DESC LIMIT 500")
        .unwrap();
    let peers: Vec<String> = stmt
        .query_map([], |row| row.get(0))
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    let mut track_scores: HashMap<String, f64> = HashMap::new();

    for peer_json in &peers {
        let peer: serde_json::Value = match serde_json::from_str(peer_json) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let peer_likes: Vec<&str> = peer
            .get("liked_hashes")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|v| v.as_str()).collect())
            .unwrap_or_default();

        let peer_set: HashSet<&str> = peer_likes.iter().copied().collect();
        let intersection = my_set.intersection(&peer_set).count();
        if intersection == 0 {
            continue;
        }
        let similarity = intersection as f64 / my_set.union(&peer_set).count() as f64;

        for track in peer_likes {
            if !my_set.contains(track) {
                *track_scores.entry(track.to_string()).or_insert(0.0) += similarity;
            }
        }
    }

    let mut sorted: Vec<(String, f64, String)> = track_scores
        .into_iter()
        .map(|(id, score)| (id, score.min(1.0), "collaborative".to_string()))
        .collect();
    sorted.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
    sorted.truncate(limit);
    sorted
}

/// Content-based: tracks with high completion rate not yet explicitly liked/disliked.
pub fn content_recommend(conn: &Connection, limit: usize) -> Vec<(String, f64, String)> {
    let mut stmt = conn
        .prepare(
            "SELECT lh.canonical_id,
                COUNT(*) as total,
                SUM(CASE WHEN lh.completed = 1 THEN 1 ELSE 0 END) as completed,
                AVG(CAST(lh.listened_secs AS REAL) / NULLIF(lh.duration_secs, 0)) as avg_completion
         FROM listen_history lh
         LEFT JOIN track_likes tl ON tl.canonical_id = lh.canonical_id
         WHERE tl.canonical_id IS NULL
         GROUP BY lh.canonical_id
         HAVING total >= 2 AND avg_completion > 0.7
         ORDER BY avg_completion DESC, total DESC
         LIMIT ?1",
        )
        .unwrap();
    stmt.query_map([limit as i64], |row| {
        let cid: String = row.get(0)?;
        let avg_completion: f64 = row.get(3)?;
        Ok((cid, avg_completion.min(1.0), "content".to_string()))
    })
    .unwrap()
    .filter_map(|r| r.ok())
    .collect()
}

/// Hybrid: merge collaborative (0.4) + content (0.3) + server cache (0.3).
pub fn hybrid_recommend(conn: &Connection, limit: usize) -> Vec<(String, f64, String)> {
    let my_likes = crate::history::get_liked_canonical_ids(conn);
    let collab = collaborative_recommend(conn, &my_likes, limit * 2);
    let content = content_recommend(conn, limit * 2);
    let cached = crate::aggregator::get_cached_recommendations(conn, limit * 2);

    let mut merged: HashMap<String, (f64, String)> = HashMap::new();
    for (id, score, source) in &collab {
        merged.entry(id.clone()).or_insert((0.0, source.clone())).0 += score * 0.4;
    }
    for (id, score, source) in &content {
        merged.entry(id.clone()).or_insert((0.0, source.clone())).0 += score * 0.3;
    }
    for (id, score, source, _artist, _title) in &cached {
        merged.entry(id.clone()).or_insert((0.0, source.clone())).0 += score * 0.3;
    }

    let mut result: Vec<(String, f64, String)> = merged
        .into_iter()
        .map(|(id, (score, source))| (id, score.min(1.0), source))
        .collect();
    result.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
    result.truncate(limit);
    result
}

// ─── Last.fm cold-start helpers ───

const LASTFM_API_URL: &str = "https://ws.audioscrobbler.com/2.0/";

pub fn lastfm_similar_url(api_key: &str, artist: &str, track: &str) -> String {
    let enc_artist = urlencoding::encode(artist);
    let enc_track = urlencoding::encode(track);
    format!(
        "{}?method=track.getSimilar&artist={}&track={}&api_key={}&format=json&limit=20",
        LASTFM_API_URL, enc_artist, enc_track, api_key
    )
}

/// Fetch similar tracks from Last.fm for cold start / fallback.
pub async fn lastfm_get_similar(
    client: &reqwest::Client,
    api_key: &str,
    artist: &str,
    track: &str,
) -> Vec<(String, String, f64)> {
    let url = lastfm_similar_url(api_key, artist, track);
    let resp = match client.get(&url).send().await {
        Ok(r) => r,
        Err(_) => return vec![],
    };
    let body: serde_json::Value = match resp.json().await {
        Ok(v) => v,
        Err(_) => return vec![],
    };
    let tracks = match body
        .get("similartracks")
        .and_then(|st| st.get("track"))
        .and_then(|t| t.as_array())
    {
        Some(arr) => arr,
        None => return vec![],
    };
    tracks
        .iter()
        .filter_map(|t| {
            let name = t.get("name")?.as_str()?;
            let artist = t.get("artist")?.get("name")?.as_str()?;
            let match_score = t.get("match")?.as_str()?.parse::<f64>().ok()?;
            Some((artist.to_string(), name.to_string(), match_score))
        })
        .collect()
}

// ─── Tauri commands ───

#[tauri::command]
pub fn get_hybrid_recommendations(
    app: tauri::AppHandle,
    limit: Option<u32>,
) -> Result<Vec<(String, f64, String, String, String)>, String> {
    let db = app.state::<crate::db::Db>();
    let conn =
        db.0.lock()
            .unwrap_or_else(|e: std::sync::PoisonError<_>| e.into_inner());
    let recs = hybrid_recommend(&conn, limit.unwrap_or(30) as usize);
    let resolved: Vec<(String, f64, String, String, String)> = recs
        .into_iter()
        .map(|(cid, score, source)| {
            let (artist, title) = conn
                .query_row(
                    "SELECT artist, title FROM track_identity WHERE canonical_id = ?1 LIMIT 1",
                    [&cid],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
                )
                .unwrap_or_else(|_| ("".to_string(), "".to_string()));
            (cid, score, source, artist, title)
        })
        .collect();
    Ok(resolved)
}

#[tauri::command]
pub async fn get_coldstart_recommendations(
    app: tauri::AppHandle,
    artist: String,
    title: String,
    limit: Option<u32>,
) -> Result<Vec<(String, String, f64)>, String> {
    let db = app.state::<crate::db::Db>();
    let api_key = {
        let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
        conn.query_row(
            "SELECT value FROM settings WHERE key = 'lastfm_api_key'",
            [],
            |row| row.get::<_, String>(0),
        )
        .map_err(|_| "Last.fm API key not set".to_string())?
    };
    let mut similar = lastfm_get_similar(&crate::http::CLIENT, &api_key, &artist, &title).await;
    similar.truncate(limit.unwrap_or(20) as usize);
    Ok(similar)
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct MoodChannel {
    pub id: String,
    pub name: String,
    pub description: String,
    pub seed_tracks: Vec<String>,
    pub is_default: bool,
}

#[tauri::command]
pub fn list_mood_channels(app: tauri::AppHandle) -> Result<Vec<MoodChannel>, String> {
    let db = app.state::<crate::db::Db>();
    let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());

    let mut stmt = conn.prepare(
        "SELECT id, name, description, seed_tracks, is_default FROM mood_channels ORDER BY is_default DESC, name"
    ).map_err(|e| format!("{e}"))?;

    let channels = stmt
        .query_map([], |row| {
            let seeds_json: String = row.get(3)?;
            let seeds: Vec<String> = serde_json::from_str(&seeds_json).unwrap_or_default();
            Ok(MoodChannel {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                seed_tracks: seeds,
                is_default: row.get::<_, i32>(4)? != 0,
            })
        })
        .map_err(|e| format!("{e}"))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(channels)
}

#[tauri::command]
pub fn create_mood_channel(
    app: tauri::AppHandle,
    name: String,
    description: String,
) -> Result<MoodChannel, String> {
    let db = app.state::<crate::db::Db>();
    let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());

    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO mood_channels (id, name, description) VALUES (?1, ?2, ?3)",
        rusqlite::params![id, name, description],
    )
    .map_err(|e| format!("{e}"))?;

    Ok(MoodChannel {
        id,
        name,
        description,
        seed_tracks: vec![],
        is_default: false,
    })
}

#[tauri::command]
pub fn add_seed_track(
    app: tauri::AppHandle,
    channel_id: String,
    canonical_id: String,
) -> Result<(), String> {
    let db = app.state::<crate::db::Db>();
    let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());

    let current: String = conn
        .query_row(
            "SELECT seed_tracks FROM mood_channels WHERE id = ?1",
            [&channel_id],
            |row| row.get(0),
        )
        .map_err(|_| "channel not found".to_string())?;

    let mut seeds: Vec<String> = serde_json::from_str(&current).unwrap_or_default();
    if !seeds.contains(&canonical_id) {
        seeds.push(canonical_id);
    }

    let updated = serde_json::to_string(&seeds).unwrap();
    conn.execute(
        "UPDATE mood_channels SET seed_tracks = ?1 WHERE id = ?2",
        rusqlite::params![updated, channel_id],
    )
    .map_err(|e| format!("{e}"))?;

    Ok(())
}

#[tauri::command]
pub fn delete_mood_channel(app: tauri::AppHandle, channel_id: String) -> Result<(), String> {
    let db = app.state::<crate::db::Db>();
    let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());

    let is_default: i32 = conn
        .query_row(
            "SELECT is_default FROM mood_channels WHERE id = ?1",
            [&channel_id],
            |row| row.get(0),
        )
        .map_err(|_| "channel not found".to_string())?;

    if is_default != 0 {
        return Err("cannot delete default channel".into());
    }

    conn.execute("DELETE FROM mood_channels WHERE id = ?1", [&channel_id])
        .map_err(|e| format!("{e}"))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn test_lastfm_similar_url() {
        let url = super::lastfm_similar_url("abc123", "Boards of Canada", "Dayvan Cowboy");
        assert!(url.contains("method=track.getSimilar"));
        assert!(url.contains("Boards"));
        assert!(url.contains("Dayvan"));
    }

    use super::*;
    use crate::db::test_db;
    use crate::history::*;
    use crate::track_id::*;

    fn seed_rich_data(conn: &rusqlite::Connection) {
        let tracks = vec![
            ("youtube", "v1", "Boards of Canada", "Dayvan Cowboy", 300.0),
            ("youtube", "v2", "Aphex Twin", "Windowlicker", 390.0),
            ("youtube", "v3", "Autechre", "Gantz Graf", 260.0),
            ("soundcloud", "s1", "Four Tet", "She Moves She", 420.0),
            ("youtube", "v4", "Metallica", "Enter Sandman", 331.0),
            ("soundcloud", "s2", "Bonobo", "Kerala", 335.0),
        ];
        for (src, sid, artist, title, dur) in &tracks {
            resolve_or_create(conn, src, sid, artist, title, *dur);
        }
        let cid1 = canonical_hash("Boards of Canada", "Dayvan Cowboy");
        let cid2 = canonical_hash("Aphex Twin", "Windowlicker");
        let cid3 = canonical_hash("Autechre", "Gantz Graf");
        let cid4 = canonical_hash("Four Tet", "She Moves She");
        for i in 0..10i64 {
            record_listen(
                conn,
                &cid1,
                "youtube",
                1000 + i * 400,
                300,
                280,
                true,
                false,
            );
            record_listen(
                conn,
                &cid2,
                "youtube",
                1200 + i * 400,
                390,
                380,
                true,
                false,
            );
        }
        for i in 0..3i64 {
            record_listen(
                conn,
                &cid3,
                "youtube",
                5000 + i * 400,
                260,
                250,
                true,
                false,
            );
        }
        set_like(conn, &cid1, true);
        set_like(conn, &cid2, true);
        set_like(conn, &cid3, true);
        set_like(conn, &cid4, true);
        let peer_profile = serde_json::json!({
            "liked_hashes": [cid1, cid2, cid4, canonical_hash("Bonobo", "Kerala")]
        })
        .to_string();
        crate::aggregator::store_peer_profile(conn, "peer1", &peer_profile);
    }

    #[test]
    fn test_collaborative_recommendations() {
        let db = test_db();
        let conn = db.0.lock().unwrap();
        seed_rich_data(&conn);
        let my_likes = crate::history::get_liked_canonical_ids(&conn);
        let recs = collaborative_recommend(&conn, &my_likes, 10);
        assert!(recs.len() <= 10);
    }

    #[test]
    fn test_content_based_recommendations() {
        let db = test_db();
        let conn = db.0.lock().unwrap();
        seed_rich_data(&conn);
        let recs = content_recommend(&conn, 10);
        assert!(recs.len() <= 10);
    }

    #[test]
    fn test_hybrid_recommendations_merge() {
        let db = test_db();
        let conn = db.0.lock().unwrap();
        seed_rich_data(&conn);
        let recs = hybrid_recommend(&conn, 10);
        assert!(recs.len() <= 10);
        for (_, score, _) in &recs {
            assert!(*score >= 0.0 && *score <= 1.0);
        }
    }
}
