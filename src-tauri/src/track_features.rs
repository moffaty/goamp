#![allow(dead_code)]

use crate::db::Db;
use serde::Deserialize;
use std::collections::HashMap;

pub const TAG_VOCAB: [&str; 30] = [
    "chill",
    "ambient",
    "acoustic",
    "sleep",
    "relaxing",
    "meditation",
    "energetic",
    "workout",
    "upbeat",
    "dance",
    "hype",
    "party",
    "focus",
    "concentration",
    "study",
    "instrumental",
    "electronic",
    "rock",
    "pop",
    "jazz",
    "classical",
    "hip-hop",
    "melancholic",
    "happy",
    "dark",
    "experimental",
    "indie",
    "folk",
    "discovery",
    "underground",
];

/// Convert a tag→weight map into a normalised 30-dim feature vector.
pub fn tags_to_vec(tags: &HashMap<String, f32>) -> Vec<f32> {
    let raw: Vec<f32> = TAG_VOCAB
        .iter()
        .map(|&t| tags.get(t).copied().unwrap_or(0.0))
        .collect();
    let norm = (raw.iter().map(|x| x * x).sum::<f32>()).sqrt();
    if norm > 0.0 {
        raw.iter().map(|x| x / norm).collect()
    } else {
        raw
    }
}

pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    let dot: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    let na = (a.iter().map(|x| x * x).sum::<f32>()).sqrt();
    let nb = (b.iter().map(|x| x * x).sum::<f32>()).sqrt();
    if na > 0.0 && nb > 0.0 {
        dot / (na * nb)
    } else {
        0.0
    }
}

/// Build a unit feature vector from a mood's seed tag list.
pub fn seed_tags_vec(seed_tags: &[String]) -> Vec<f32> {
    let mut map = HashMap::new();
    for t in seed_tags {
        map.insert(t.clone(), 1.0_f32);
    }
    tags_to_vec(&map)
}

// ── DB storage ────────────────────────────────────────────────────────────────

pub fn store_track_features_internal(
    db: &Db,
    canonical_id: &str,
    tags_json: &str,
    vec: &[f32],
) -> Result<(), String> {
    let vec_json = serde_json::to_string(vec).map_err(|e| e.to_string())?;
    let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
    conn.execute(
        "INSERT OR REPLACE INTO track_features (canonical_id, tags_json, feature_vec, fetched_at)
         VALUES (?1, ?2, ?3, unixepoch())",
        rusqlite::params![canonical_id, tags_json, vec_json],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn load_track_features_internal(
    db: &Db,
    canonical_id: &str,
) -> Result<Option<Vec<f32>>, String> {
    let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
    let result: Option<String> = conn
        .query_row(
            "SELECT feature_vec FROM track_features WHERE canonical_id = ?1",
            rusqlite::params![canonical_id],
            |r| r.get(0),
        )
        .ok();
    match result {
        None => Ok(None),
        Some(json) => {
            let vec: Vec<f32> = serde_json::from_str(&json).map_err(|e| e.to_string())?;
            Ok(Some(vec))
        }
    }
}

// ── Last.fm tag fetching ──────────────────────────────────────────────────────

#[derive(Deserialize)]
struct LastFmTagsResponse {
    toptags: TopTags,
}

#[derive(Deserialize)]
struct TopTags {
    #[serde(default)]
    tag: Vec<TagItem>,
}

#[derive(Deserialize)]
struct TagItem {
    name: String,
    count: serde_json::Value,
}

pub async fn fetch_track_tags(
    api_key: &str,
    artist: &str,
    title: &str,
) -> Result<HashMap<String, f32>, String> {
    let resp = crate::http::CLIENT
        .get("https://ws.audioscrobbler.com/2.0/")
        .query(&[
            ("method", "track.getTopTags"),
            ("api_key", api_key),
            ("artist", artist),
            ("track", title),
            ("format", "json"),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json::<LastFmTagsResponse>()
        .await
        .map_err(|e| e.to_string())?;

    let max_count = resp
        .toptags
        .tag
        .iter()
        .map(|t| {
            t.count
                .as_f64()
                .or_else(|| t.count.as_str().and_then(|s| s.parse().ok()))
                .unwrap_or(0.0)
        })
        .fold(0.0_f64, f64::max);

    let mut tags: HashMap<String, f32> = HashMap::new();
    for t in &resp.toptags.tag {
        let count = t
            .count
            .as_f64()
            .or_else(|| t.count.as_str().and_then(|s| s.parse().ok()))
            .unwrap_or(0.0);
        if max_count > 0.0 {
            tags.insert(t.name.to_lowercase(), (count / max_count) as f32);
        }
    }
    Ok(tags)
}

/// Fetch tags from Last.fm, build feature vector, and store in DB.
pub async fn ensure_track_features(
    db: &Db,
    api_key: &str,
    canonical_id: &str,
    artist: &str,
    title: &str,
) -> Result<Vec<f32>, String> {
    if let Some(vec) = load_track_features_internal(db, canonical_id)? {
        return Ok(vec);
    }
    let tags = fetch_track_tags(api_key, artist, title)
        .await
        .unwrap_or_default();
    let tags_json = serde_json::to_string(&tags).unwrap_or_else(|_| "{}".into());
    let vec = tags_to_vec(&tags);
    store_track_features_internal(db, canonical_id, &tags_json, &vec)?;
    Ok(vec)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_db;

    #[test]
    fn test_tags_to_vec_normalizes() {
        let mut tags = HashMap::new();
        tags.insert("chill".to_string(), 1.0_f32);
        let vec = tags_to_vec(&tags);
        assert_eq!(vec.len(), 30);
        let chill_idx = TAG_VOCAB.iter().position(|&t| t == "chill").unwrap();
        assert!((vec[chill_idx] - 1.0).abs() < 0.001);
    }

    #[test]
    fn test_cosine_similarity_identical() {
        let v = vec![1.0_f32, 0.0, 0.0];
        assert!((cosine_similarity(&v, &v) - 1.0).abs() < 0.001);
    }

    #[test]
    fn test_cosine_similarity_orthogonal() {
        let a = vec![1.0_f32, 0.0];
        let b = vec![0.0_f32, 1.0];
        assert!(cosine_similarity(&a, &b).abs() < 0.001);
    }

    #[test]
    fn test_seed_tags_vec_calm() {
        let seed_tags: Vec<String> = vec![
            "chill",
            "ambient",
            "acoustic",
            "sleep",
            "relaxing",
            "meditation",
        ]
        .into_iter()
        .map(String::from)
        .collect();
        let v = seed_tags_vec(&seed_tags);
        assert_eq!(v.len(), 30);
        for t in &seed_tags {
            let idx = TAG_VOCAB.iter().position(|&x| x == t.as_str()).unwrap();
            assert!(v[idx] > 0.0);
        }
    }

    #[test]
    fn test_store_and_load_features() {
        let db = test_db();
        let vec: Vec<f32> = vec![0.1; 30];
        store_track_features_internal(&db, "h1", "{}", &vec).unwrap();
        let loaded = load_track_features_internal(&db, "h1").unwrap().unwrap();
        assert_eq!(loaded.len(), 30);
        assert!((loaded[0] - 0.1).abs() < 0.001);
    }

    #[test]
    fn test_load_features_missing_returns_none() {
        let db = test_db();
        let result = load_track_features_internal(&db, "nonexistent").unwrap();
        assert!(result.is_none());
    }
}
