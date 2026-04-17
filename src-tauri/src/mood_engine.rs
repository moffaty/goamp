use crate::commands::mood::{
    get_mood_track_scores_internal, record_mood_play_internal, MoodTrackScore,
};
use crate::db::Db;
use crate::track_features::{cosine_similarity, load_track_features_internal, seed_tags_vec};
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, PartialEq)]
pub enum ScoringStage {
    ColdStart,
    ContextLearning,
    CentroidActive,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct QueueTrack {
    pub canonical_id: String,
    pub title: String,
    pub artist: String,
    pub source: String,
    pub source_id: String,
    pub score: f32,
    pub is_discovery: bool,
}

pub fn determine_stage(db: &Db, mood_id: &str) -> ScoringStage {
    let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
    let play_count: i32 = conn
        .query_row(
            "SELECT COALESCE(SUM(play_count), 0) FROM mood_track_scores WHERE mood_id = ?1",
            rusqlite::params![mood_id],
            |r| r.get(0),
        )
        .unwrap_or(0);

    if play_count < 50 {
        return ScoringStage::ColdStart;
    }

    let centroid_tracks: i32 = conn
        .query_row(
            "SELECT COALESCE(track_count, 0) FROM mood_centroids WHERE mood_id = ?1",
            rusqlite::params![mood_id],
            |r| r.get(0),
        )
        .unwrap_or(0);

    if centroid_tracks >= 50 {
        ScoringStage::CentroidActive
    } else {
        ScoringStage::ContextLearning
    }
}

/// Returns a signal-adjusted score. -1 (block) → 0.0; +1 (boost) → score * 1.5.
pub fn apply_signal_multipliers(
    db: &Db,
    canonical_id: &str,
    mood_id: &str,
    base_score: f32,
) -> f32 {
    let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
    let mood_scope = format!("mood:{}", mood_id);

    let blocked: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM track_signals WHERE canonical_id = ?1 AND signal = -1
             AND (scope = 'global' OR scope = ?2)",
            rusqlite::params![canonical_id, &mood_scope],
            |r| r.get::<_, i32>(0),
        )
        .unwrap_or(0)
        > 0;

    if blocked {
        return 0.0;
    }

    let boosted: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM track_signals WHERE canonical_id = ?1 AND signal = 1
             AND (scope = 'global' OR scope = ?2)",
            rusqlite::params![canonical_id, &mood_scope],
            |r| r.get::<_, i32>(0),
        )
        .unwrap_or(0)
        > 0;

    if boosted {
        base_score * 1.5
    } else {
        base_score
    }
}

fn load_global_candidates(db: &Db) -> Vec<QueueTrack> {
    let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
    conn.prepare(
        "SELECT lh.canonical_id,
                COALESCE(ti.artist, ''),
                COALESCE(ti.title, ''),
                COALESCE(ti.source, ''),
                COALESCE(ti.source_id, '')
         FROM listen_history lh
         LEFT JOIN track_identity ti ON ti.canonical_id = lh.canonical_id
         WHERE lh.canonical_id IS NOT NULL
         GROUP BY lh.canonical_id
         ORDER BY COUNT(*) DESC
         LIMIT 200",
    )
    .and_then(|mut stmt| {
        stmt.query_map([], |row| {
            Ok(QueueTrack {
                canonical_id: row.get(0)?,
                artist: row.get(1)?,
                title: row.get(2)?,
                source: row.get(3)?,
                source_id: row.get(4)?,
                score: 0.5,
                is_discovery: false,
            })
        })
        .map(|rows| rows.filter_map(|r| r.ok()).collect())
    })
    .unwrap_or_default()
}

fn load_mood_seed_vec(db: &Db, mood_id: &str) -> Vec<f32> {
    let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
    let seed_json: Option<String> = conn
        .query_row(
            "SELECT seed_tags FROM mood_channels WHERE id = ?1",
            rusqlite::params![mood_id],
            |r| r.get(0),
        )
        .ok();
    let seed_tags: Vec<String> = seed_json
        .and_then(|j| serde_json::from_str(&j).ok())
        .unwrap_or_default();
    seed_tags_vec(&seed_tags)
}

fn load_mood_centroid(db: &Db, mood_id: &str) -> Option<Vec<f32>> {
    let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
    let json: Option<String> = conn
        .query_row(
            "SELECT centroid_vec FROM mood_centroids WHERE mood_id = ?1",
            rusqlite::params![mood_id],
            |r| r.get(0),
        )
        .ok();
    json.and_then(|j| serde_json::from_str(&j).ok())
}

fn load_context_scores(
    db: &Db,
    mood_id: &str,
) -> std::collections::HashMap<String, MoodTrackScore> {
    get_mood_track_scores_internal(db, mood_id)
        .unwrap_or_default()
        .into_iter()
        .map(|s| (s.canonical_id.clone(), s))
        .collect()
}

fn score_track(
    canonical_id: &str,
    stage: &ScoringStage,
    seed_vec: &[f32],
    centroid_vec: Option<&Vec<f32>>,
    context_scores: &std::collections::HashMap<String, MoodTrackScore>,
    feature_vec: Option<&[f32]>,
    global_rank_norm: f32,
) -> f32 {
    let reference = centroid_vec.map(|v| v.as_slice()).unwrap_or(seed_vec);
    let audio_fit = feature_vec
        .map(|fv| cosine_similarity(fv, reference))
        .unwrap_or(0.3);

    match stage {
        ScoringStage::ColdStart => audio_fit,
        ScoringStage::ContextLearning | ScoringStage::CentroidActive => {
            let completion = context_scores
                .get(canonical_id)
                .map(|s| s.completion_rate as f32)
                .unwrap_or(0.5);
            let skip_penalty = context_scores
                .get(canonical_id)
                .map(|s| s.skip_rate as f32)
                .unwrap_or(0.0);
            0.4 * global_rank_norm + 0.4 * completion * (1.0 - skip_penalty) + 0.2 * audio_fit
        }
    }
}

/// Generate a mood queue of `limit` tracks (up to limit-5 scored + up to 5 discovery).
pub fn generate_mood_queue_internal(db: &Db, mood_id: &str, limit: usize) -> Vec<QueueTrack> {
    let stage = determine_stage(db, mood_id);
    let seed_vec = load_mood_seed_vec(db, mood_id);
    let centroid = load_mood_centroid(db, mood_id);
    let context_scores = load_context_scores(db, mood_id);
    let mut candidates = load_global_candidates(db);
    let total = candidates.len();

    for (i, track) in candidates.iter_mut().enumerate() {
        let feature_vec = load_track_features_internal(db, &track.canonical_id)
            .ok()
            .flatten();
        let global_rank_norm = 1.0 - (i as f32 / total.max(1) as f32);
        let raw = score_track(
            &track.canonical_id,
            &stage,
            &seed_vec,
            centroid.as_ref(),
            &context_scores,
            feature_vec.as_deref(),
            global_rank_norm,
        );
        track.score = apply_signal_multipliers(db, &track.canonical_id, mood_id, raw);
    }

    let mut scored: Vec<QueueTrack> = candidates.into_iter().filter(|t| t.score > 0.0).collect();
    scored.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let main_count = limit.saturating_sub(5).min(scored.len());
    let mut queue: Vec<QueueTrack> = scored.drain(..main_count).collect();

    let discovery: Vec<QueueTrack> = scored
        .into_iter()
        .filter(|t| t.score > 0.2 && !context_scores.contains_key(&t.canonical_id))
        .take(5)
        .map(|mut t| {
            t.is_discovery = true;
            t
        })
        .collect();
    queue.extend(discovery);
    queue
}

pub fn update_centroid(db: &Db, mood_id: &str) -> Result<(), String> {
    let ids: Vec<String> = {
        let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
        conn.prepare(
            "SELECT canonical_id FROM mood_track_scores WHERE mood_id = ?1 ORDER BY play_count DESC",
        )
        .and_then(|mut stmt| {
            let rows = stmt.query_map(rusqlite::params![mood_id], |r| r.get(0))?;
            Ok(rows.filter_map(|r| r.ok()).collect::<Vec<String>>())
        })
        .unwrap_or_default()
    };

    let mut vecs: Vec<Vec<f32>> = Vec::new();
    for id in &ids {
        if let Ok(Some(v)) = load_track_features_internal(db, id) {
            vecs.push(v);
        }
    }

    if vecs.is_empty() {
        return Ok(());
    }

    let dim = vecs[0].len();
    let mut sum = vec![0.0_f32; dim];
    for v in &vecs {
        for (i, x) in v.iter().enumerate() {
            sum[i] += x;
        }
    }
    let n = vecs.len() as f32;
    let mut avg: Vec<f32> = sum.iter().map(|x| x / n).collect();
    let norm = (avg.iter().map(|x| x * x).sum::<f32>()).sqrt();
    if norm > 0.0 {
        avg = avg.iter().map(|x| x / norm).collect();
    }

    let json = serde_json::to_string(&avg).map_err(|e| e.to_string())?;
    let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
    conn.execute(
        "INSERT OR REPLACE INTO mood_centroids (mood_id, centroid_vec, track_count, updated_at)
         VALUES (?1, ?2, ?3, unixepoch())",
        rusqlite::params![mood_id, json, vecs.len() as i32],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn generate_mood_queue(
    db: State<Db>,
    mood_id: String,
    limit: Option<usize>,
) -> Result<Vec<QueueTrack>, String> {
    Ok(generate_mood_queue_internal(
        &db,
        &mood_id,
        limit.unwrap_or(20),
    ))
}

#[tauri::command]
pub fn update_mood_centroid(db: State<Db>, mood_id: String) -> Result<(), String> {
    update_centroid(&db, &mood_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::mood::record_mood_play_internal;
    use crate::db::test_db;
    use crate::track_features::store_track_features_internal;

    #[test]
    fn test_determine_stage_cold_start() {
        let db = test_db();
        assert!(matches!(
            determine_stage(&db, "calm"),
            ScoringStage::ColdStart
        ));
    }

    #[test]
    fn test_determine_stage_context_learning() {
        let db = test_db();
        for i in 0..50 {
            record_mood_play_internal(&db, "calm", &format!("hash_{}", i), 0.8, false).unwrap();
        }
        assert!(matches!(
            determine_stage(&db, "calm"),
            ScoringStage::ContextLearning
        ));
    }

    #[test]
    fn test_apply_signal_multipliers_block() {
        let db = test_db();
        db.0.lock()
            .unwrap()
            .execute(
                "INSERT INTO track_signals (canonical_id, signal, scope) VALUES ('h1', -1, 'global')",
                [],
            )
            .unwrap();
        let score = apply_signal_multipliers(&db, "h1", "calm", 0.8);
        assert!((score - 0.0).abs() < 0.001);
    }

    #[test]
    fn test_apply_signal_multipliers_boost() {
        let db = test_db();
        db.0.lock()
            .unwrap()
            .execute(
                "INSERT INTO track_signals (canonical_id, signal, scope) VALUES ('h1', 1, 'global')",
                [],
            )
            .unwrap();
        let score = apply_signal_multipliers(&db, "h1", "calm", 0.8);
        assert!(score > 0.8);
    }

    #[test]
    fn test_update_centroid_averages_vectors() {
        let db = test_db();
        let v1: Vec<f32> = (0..30)
            .map(|i| if i == 0 { 1.0_f32 } else { 0.0 })
            .collect();
        let v2: Vec<f32> = (0..30)
            .map(|i| if i == 1 { 1.0_f32 } else { 0.0 })
            .collect();
        store_track_features_internal(&db, "h1", "{}", &v1).unwrap();
        store_track_features_internal(&db, "h2", "{}", &v2).unwrap();
        record_mood_play_internal(&db, "calm", "h1", 1.0, false).unwrap();
        record_mood_play_internal(&db, "calm", "h2", 1.0, false).unwrap();
        update_centroid(&db, "calm").unwrap();
        let centroid = load_mood_centroid(&db, "calm").unwrap();
        assert_eq!(centroid.len(), 30);
        assert!(centroid[0] > 0.0);
        assert!(centroid[1] > 0.0);
        assert!((centroid[2]).abs() < 0.001);
    }
}
