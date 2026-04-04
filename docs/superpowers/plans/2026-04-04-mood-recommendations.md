# Mood-Based Recommendations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build mood-aware recommendation radio (calm / energetic / focus / discovery + custom) with three-stage scoring (cold start → context learning → centroid), explicit ↑/✕ signals with scope, and P2P centroid sharing.

**Architecture:** Mood tabs in the Winamp main player window. Each mood is an infinite-stream radio channel. Track scoring uses a shared global taste pool re-ranked by per-mood completion rates and Last.fm tag vectors. Centroid activates at 50+ tracks. Settings merged into Feature Flags panel.

**Tech Stack:** Rust (mood_engine.rs, track_features.rs), SQLite (6 new tables), reqwest (Last.fm), TypeScript (mood-service.ts, bridge.ts, goamp-menu.ts), protobuf (goamp-node P2P).

**Prerequisite:** Recommendation System Phase 1 (listen_history, track_identity tables) must be complete before this plan runs.

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Modify | `src-tauri/src/db/mod.rs` | New migration block: 6 mood tables + source_mood column |
| Create | `src-tauri/src/commands/mood.rs` | Tauri commands: mood CRUD, record play, signals, tag weights |
| Create | `src-tauri/src/track_features.rs` | Last.fm tag fetch, TAG_VOCAB, feature vector, cosine similarity |
| Create | `src-tauri/src/mood_engine.rs` | Stage detection, queue generation, centroid computation |
| Modify | `src-tauri/src/lib.rs` | Register modules + commands |
| Create | `src/recommendations/mood-service.ts` | Frontend: active mood state, queue fetch, play recording, signals |
| Modify | `src/webamp/bridge.ts` | Mood tabs UI below player, wire play events with source_mood |
| Modify | `src/webamp/goamp-menu.ts` | Add ↑/✕ context menu items with scope submenu |
| Modify | `src/settings/FeatureFlagsPanel.ts` | Add Rec Settings section: tag chips + sliders |
| Modify | `goamp-node/proto/goamp.proto` | Add MoodCentroid message + mood_centroids to TasteProfile |

---

## Phase 1 — Data Layer

### Task 1: DB Migration — Mood Tables

**Files:**
- Modify: `src-tauri/src/db/mod.rs:136-165` (after radio tables migration)

- [ ] **Step 1: Write the failing tests**

```rust
// Add to #[cfg(test)] mod tests in src-tauri/src/db/mod.rs:

#[test]
fn test_mood_channels_table_exists() {
    let db = test_db();
    let conn = db.0.lock().unwrap();
    let count: i32 = conn
        .query_row("SELECT COUNT(*) FROM mood_channels WHERE is_preset = 1", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count, 4); // calm, energetic, focus, discovery
}

#[test]
fn test_mood_track_scores_table_exists() {
    let db = test_db();
    let conn = db.0.lock().unwrap();
    conn.execute(
        "INSERT INTO mood_track_scores (mood_id, canonical_id, play_count, completion_rate, skip_rate)
         VALUES ('calm', 'hash_abc', 3, 0.85, 0.1)",
        [],
    ).unwrap();
    let rate: f64 = conn
        .query_row("SELECT completion_rate FROM mood_track_scores WHERE mood_id='calm' AND canonical_id='hash_abc'", [], |r| r.get(0))
        .unwrap();
    assert!((rate - 0.85).abs() < 0.001);
}

#[test]
fn test_track_features_table_exists() {
    let db = test_db();
    let conn = db.0.lock().unwrap();
    conn.execute(
        "INSERT INTO track_features (canonical_id, tags_json, feature_vec) VALUES ('h1', '{\"chill\":0.8}', '[0.1,0.2]')",
        [],
    ).unwrap();
    let vec_str: String = conn
        .query_row("SELECT feature_vec FROM track_features WHERE canonical_id='h1'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(vec_str, "[0.1,0.2]");
}

#[test]
fn test_track_signals_table_exists() {
    let db = test_db();
    let conn = db.0.lock().unwrap();
    conn.execute(
        "INSERT INTO track_signals (canonical_id, signal, scope) VALUES ('hash_abc', -1, 'global')",
        [],
    ).unwrap();
    let sig: i32 = conn
        .query_row("SELECT signal FROM track_signals WHERE canonical_id='hash_abc'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(sig, -1);
}

#[test]
fn test_tag_weights_table_exists() {
    let db = test_db();
    let conn = db.0.lock().unwrap();
    conn.execute(
        "INSERT INTO tag_weights (tag, scope, weight) VALUES ('ambient', 'global', 0.2)",
        [],
    ).unwrap();
    let w: f64 = conn
        .query_row("SELECT weight FROM tag_weights WHERE tag='ambient' AND scope='global'", [], |r| r.get(0))
        .unwrap();
    assert!((w - 0.2).abs() < 0.001);
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test test_mood_channels_table_exists test_mood_track_scores_table_exists test_track_features_table_exists test_track_signals_table_exists test_tag_weights_table_exists -- --nocapture 2>&1`
Expected: FAIL — tables don't exist yet

- [ ] **Step 3: Add migration block in `src-tauri/src/db/mod.rs`**

Add after the radio tables migration block (after line 152, before `Ok(())`):

```rust
    // Migration: mood recommendation tables
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS mood_channels (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            is_preset INTEGER NOT NULL DEFAULT 0,
            seed_tags TEXT NOT NULL DEFAULT '[]',
            created_at INTEGER DEFAULT (unixepoch())
        );

        CREATE TABLE IF NOT EXISTS mood_track_scores (
            mood_id TEXT NOT NULL,
            canonical_id TEXT NOT NULL,
            play_count INTEGER DEFAULT 0,
            completion_rate REAL DEFAULT 0.0,
            skip_rate REAL DEFAULT 0.0,
            last_played_at INTEGER,
            PRIMARY KEY (mood_id, canonical_id)
        );

        CREATE TABLE IF NOT EXISTS track_features (
            canonical_id TEXT PRIMARY KEY,
            tags_json TEXT NOT NULL DEFAULT '{}',
            feature_vec TEXT NOT NULL DEFAULT '[]',
            fetched_at INTEGER DEFAULT (unixepoch())
        );

        CREATE TABLE IF NOT EXISTS mood_centroids (
            mood_id TEXT PRIMARY KEY,
            centroid_vec TEXT NOT NULL DEFAULT '[]',
            track_count INTEGER DEFAULT 0,
            updated_at INTEGER DEFAULT (unixepoch())
        );

        CREATE TABLE IF NOT EXISTS track_signals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            canonical_id TEXT NOT NULL,
            signal INTEGER NOT NULL,
            scope TEXT NOT NULL,
            tag_penalty_applied INTEGER DEFAULT 0,
            created_at INTEGER DEFAULT (unixepoch())
        );

        CREATE TABLE IF NOT EXISTS tag_weights (
            tag TEXT NOT NULL,
            scope TEXT NOT NULL,
            weight REAL NOT NULL DEFAULT 1.0,
            PRIMARY KEY (tag, scope)
        );

        INSERT OR IGNORE INTO mood_channels (id, name, is_preset, seed_tags) VALUES
            ('calm', 'Calm', 1, '[\"chill\",\"ambient\",\"acoustic\",\"sleep\",\"relaxing\",\"meditation\"]'),
            ('energetic', 'Energetic', 1, '[\"energetic\",\"workout\",\"upbeat\",\"dance\",\"hype\",\"party\"]'),
            ('focus', 'Focus', 1, '[\"focus\",\"concentration\",\"study\",\"instrumental\"]'),
            ('discovery', 'Discovery', 1, '[\"obscure\",\"underground\",\"experimental\",\"rare\"]');
        ",
    )?;

    // Migration: add source_mood to listen_history (safe — only if table exists and column missing)
    let has_listen_history = conn.prepare("SELECT 1 FROM listen_history LIMIT 0").is_ok();
    if has_listen_history {
        let has_source_mood = conn.prepare("SELECT source_mood FROM listen_history LIMIT 0").is_ok();
        if !has_source_mood {
            conn.execute_batch("ALTER TABLE listen_history ADD COLUMN source_mood TEXT NULL;")?;
        }
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri && cargo test test_mood_channels_table_exists test_mood_track_scores_table_exists test_track_features_table_exists test_track_signals_table_exists test_tag_weights_table_exists -- --nocapture 2>&1`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/db/mod.rs
git commit -m "feat: mood recommendation tables migration"
```

---

### Task 2: Rust Mood CRUD Commands

**Files:**
- Create: `src-tauri/src/commands/mood.rs`
- Modify: `src-tauri/src/commands/mod.rs` (add `pub mod mood;`)
- Modify: `src-tauri/src/lib.rs` (register commands)

- [ ] **Step 1: Write the failing test**

```rust
// Create src-tauri/src/commands/mood.rs with just the test module first:
#[cfg(test)]
mod tests {
    use crate::db::test_db;

    #[test]
    fn test_record_mood_play_creates_and_updates_score() {
        let db = test_db();
        {
            let conn = db.0.lock().unwrap();
            // Insert a track into listen_history so canonical_id exists
            conn.execute(
                "CREATE TABLE IF NOT EXISTS listen_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    canonical_id TEXT NOT NULL,
                    source TEXT NOT NULL DEFAULT '',
                    started_at INTEGER NOT NULL DEFAULT 0,
                    duration_secs INTEGER NOT NULL DEFAULT 0,
                    listened_secs INTEGER NOT NULL DEFAULT 0,
                    completed INTEGER NOT NULL DEFAULT 0,
                    skipped_early INTEGER NOT NULL DEFAULT 0,
                    context_hour INTEGER NOT NULL DEFAULT 0,
                    context_weekday INTEGER NOT NULL DEFAULT 0,
                    source_mood TEXT NULL
                )", [],
            ).unwrap();
        }

        // First play — creates row
        super::record_mood_play_internal(&db, "calm", "hash_abc", 0.9, false).unwrap();
        let conn = db.0.lock().unwrap();
        let (play_count, completion_rate): (i32, f64) = conn
            .query_row(
                "SELECT play_count, completion_rate FROM mood_track_scores WHERE mood_id='calm' AND canonical_id='hash_abc'",
                [], |r| Ok((r.get(0)?, r.get(1)?)),
            ).unwrap();
        assert_eq!(play_count, 1);
        assert!((completion_rate - 0.9).abs() < 0.01);
    }

    #[test]
    fn test_list_moods_returns_presets() {
        let db = test_db();
        let moods = super::list_moods_internal(&db).unwrap();
        assert_eq!(moods.len(), 4);
        assert!(moods.iter().any(|m| m.id == "calm"));
        assert!(moods.iter().any(|m| m.id == "energetic"));
    }

    #[test]
    fn test_create_and_delete_custom_mood() {
        let db = test_db();
        super::create_mood_internal(&db, "my_mood", "My Mood", r#"["indie","folk"]"#).unwrap();
        let moods = super::list_moods_internal(&db).unwrap();
        assert_eq!(moods.len(), 5);
        let custom = moods.iter().find(|m| m.id == "my_mood").unwrap();
        assert_eq!(custom.name, "My Mood");
        assert_eq!(custom.is_preset, false);
        super::delete_mood_internal(&db, "my_mood").unwrap();
        let moods = super::list_moods_internal(&db).unwrap();
        assert_eq!(moods.len(), 4);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test test_record_mood_play test_list_moods test_create_and_delete -- --nocapture 2>&1`
Expected: FAIL — functions not defined

- [ ] **Step 3: Implement `src-tauri/src/commands/mood.rs`**

```rust
use crate::db::Db;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Serialize, Deserialize, Clone)]
pub struct MoodChannel {
    pub id: String,
    pub name: String,
    pub is_preset: bool,
    pub seed_tags: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct MoodTrackScore {
    pub mood_id: String,
    pub canonical_id: String,
    pub play_count: i32,
    pub completion_rate: f64,
    pub skip_rate: f64,
}

// ── Internal helpers (used by tests and engine) ──────────────────────────────

pub fn list_moods_internal(db: &Db) -> Result<Vec<MoodChannel>, String> {
    let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
    let mut stmt = conn
        .prepare("SELECT id, name, is_preset, seed_tags FROM mood_channels ORDER BY is_preset DESC, name")
        .map_err(|e| e.to_string())?;
    let moods = stmt
        .query_map([], |row| {
            let tags_json: String = row.get(3)?;
            let seed_tags: Vec<String> =
                serde_json::from_str(&tags_json).unwrap_or_default();
            Ok(MoodChannel {
                id: row.get(0)?,
                name: row.get(1)?,
                is_preset: row.get::<_, i32>(2)? != 0,
                seed_tags,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(moods)
}

pub fn create_mood_internal(db: &Db, id: &str, name: &str, seed_tags_json: &str) -> Result<(), String> {
    let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
    conn.execute(
        "INSERT OR IGNORE INTO mood_channels (id, name, is_preset, seed_tags) VALUES (?1, ?2, 0, ?3)",
        rusqlite::params![id, name, seed_tags_json],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn delete_mood_internal(db: &Db, id: &str) -> Result<(), String> {
    let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
    conn.execute(
        "DELETE FROM mood_channels WHERE id = ?1 AND is_preset = 0",
        rusqlite::params![id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn record_mood_play_internal(
    db: &Db,
    mood_id: &str,
    canonical_id: &str,
    completion_rate: f64,
    skipped: bool,
) -> Result<(), String> {
    let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
    let skip_val = if skipped { 1.0_f64 } else { 0.0_f64 };
    // UPSERT: running average for completion_rate and skip_rate
    conn.execute(
        "INSERT INTO mood_track_scores (mood_id, canonical_id, play_count, completion_rate, skip_rate, last_played_at)
         VALUES (?1, ?2, 1, ?3, ?4, unixepoch())
         ON CONFLICT(mood_id, canonical_id) DO UPDATE SET
           play_count = play_count + 1,
           completion_rate = (completion_rate * play_count + ?3) / (play_count + 1),
           skip_rate = (skip_rate * play_count + ?4) / (play_count + 1),
           last_played_at = unixepoch()",
        rusqlite::params![mood_id, canonical_id, completion_rate, skip_val],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_mood_track_scores_internal(db: &Db, mood_id: &str) -> Result<Vec<MoodTrackScore>, String> {
    let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
    let mut stmt = conn
        .prepare("SELECT mood_id, canonical_id, play_count, completion_rate, skip_rate FROM mood_track_scores WHERE mood_id = ?1")
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

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn list_moods(db: State<Db>) -> Result<Vec<MoodChannel>, String> {
    list_moods_internal(&db)
}

#[tauri::command]
pub fn create_mood(db: State<Db>, id: String, name: String, seed_tags_json: String) -> Result<(), String> {
    create_mood_internal(&db, &id, &name, &seed_tags_json)
}

#[tauri::command]
pub fn delete_mood(db: State<Db>, id: String) -> Result<(), String> {
    delete_mood_internal(&db, &id)
}

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
pub fn get_mood_track_scores(db: State<Db>, mood_id: String) -> Result<Vec<MoodTrackScore>, String> {
    get_mood_track_scores_internal(&db, &mood_id)
}

#[cfg(test)]
mod tests {
    // (tests from Step 1 go here)
    use crate::db::test_db;

    #[test]
    fn test_record_mood_play_creates_and_updates_score() {
        let db = test_db();
        {
            let conn = db.0.lock().unwrap();
            conn.execute_batch(
                "CREATE TABLE IF NOT EXISTS listen_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    canonical_id TEXT NOT NULL,
                    source TEXT NOT NULL DEFAULT '',
                    started_at INTEGER NOT NULL DEFAULT 0,
                    duration_secs INTEGER NOT NULL DEFAULT 0,
                    listened_secs INTEGER NOT NULL DEFAULT 0,
                    completed INTEGER NOT NULL DEFAULT 0,
                    skipped_early INTEGER NOT NULL DEFAULT 0,
                    context_hour INTEGER NOT NULL DEFAULT 0,
                    context_weekday INTEGER NOT NULL DEFAULT 0,
                    source_mood TEXT NULL
                )",
            ).unwrap();
        }
        super::record_mood_play_internal(&db, "calm", "hash_abc", 0.9, false).unwrap();
        let conn = db.0.lock().unwrap();
        let (play_count, completion_rate): (i32, f64) = conn
            .query_row(
                "SELECT play_count, completion_rate FROM mood_track_scores WHERE mood_id='calm' AND canonical_id='hash_abc'",
                [], |r| Ok((r.get(0)?, r.get(1)?)),
            ).unwrap();
        assert_eq!(play_count, 1);
        assert!((completion_rate - 0.9).abs() < 0.01);
    }

    #[test]
    fn test_list_moods_returns_presets() {
        let db = test_db();
        let moods = super::list_moods_internal(&db).unwrap();
        assert_eq!(moods.len(), 4);
        assert!(moods.iter().any(|m| m.id == "calm"));
    }

    #[test]
    fn test_create_and_delete_custom_mood() {
        let db = test_db();
        super::create_mood_internal(&db, "my_mood", "My Mood", r#"["indie","folk"]"#).unwrap();
        let moods = super::list_moods_internal(&db).unwrap();
        assert_eq!(moods.len(), 5);
        super::delete_mood_internal(&db, "my_mood").unwrap();
        let moods = super::list_moods_internal(&db).unwrap();
        assert_eq!(moods.len(), 4);
    }
}
```

- [ ] **Step 4: Add module to `src-tauri/src/commands/mod.rs`**

Add line: `pub mod mood;`

- [ ] **Step 5: Register commands in `src-tauri/src/lib.rs`**

Add to `invoke_handler` list:
```rust
commands::mood::list_moods,
commands::mood::create_mood,
commands::mood::delete_mood,
commands::mood::record_mood_play,
commands::mood::get_mood_track_scores,
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd src-tauri && cargo test test_record_mood_play test_list_moods test_create_and_delete -- --nocapture 2>&1`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/commands/mood.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat: mood CRUD + play recording commands"
```

---

## Phase 2 — Feature Extraction

### Task 3: Track Features Module

**Files:**
- Create: `src-tauri/src/track_features.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod track_features;`, register command)

- [ ] **Step 1: Write the failing tests**

```rust
// Will go in src-tauri/src/track_features.rs #[cfg(test)] block:

#[test]
fn test_tags_to_vec_normalizes() {
    let mut tags = std::collections::HashMap::new();
    tags.insert("chill".to_string(), 1.0_f32);
    let vec = tags_to_vec(&tags);
    assert_eq!(vec.len(), 30);
    // With only one non-zero entry, the normalized value should be 1.0
    let chill_idx = TAG_VOCAB.iter().position(|&t| t == "chill").unwrap();
    assert!((vec[chill_idx] - 1.0).abs() < 0.001);
}

#[test]
fn test_cosine_similarity_identical_vectors() {
    let v = vec![1.0_f32, 0.0, 0.0];
    assert!((cosine_similarity(&v, &v) - 1.0).abs() < 0.001);
}

#[test]
fn test_cosine_similarity_orthogonal_vectors() {
    let a = vec![1.0_f32, 0.0];
    let b = vec![0.0_f32, 1.0];
    assert!((cosine_similarity(&a, &b)).abs() < 0.001);
}

#[test]
fn test_seed_tags_to_vec_for_calm() {
    let seed_tags = vec!["chill", "ambient", "acoustic", "sleep", "relaxing", "meditation"];
    let mut tags = std::collections::HashMap::new();
    for t in &seed_tags {
        tags.insert(t.to_string(), 1.0_f32);
    }
    let v = tags_to_vec(&tags);
    assert_eq!(v.len(), 30);
    // All seed indices should be equal and > 0
    for t in &seed_tags {
        let idx = TAG_VOCAB.iter().position(|&x| x == *t).unwrap();
        assert!(v[idx] > 0.0);
    }
}

#[test]
fn test_store_and_load_features(db: &crate::db::Db) {
    // helper: store feature vec then read it back
    use crate::db::test_db;
    let db = test_db();
    let vec = vec![0.1_f32; 30];
    store_track_features_internal(&db, "h1", "{}", &vec).unwrap();
    let loaded = load_track_features_internal(&db, "h1").unwrap();
    assert!(loaded.is_some());
    let loaded = loaded.unwrap();
    assert_eq!(loaded.len(), 30);
    assert!((loaded[0] - 0.1).abs() < 0.001);
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test test_tags_to_vec test_cosine_similarity test_seed_tags test_store_and_load -- --nocapture 2>&1`
Expected: FAIL

- [ ] **Step 3: Implement `src-tauri/src/track_features.rs`**

```rust
use crate::db::Db;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::State;

pub const TAG_VOCAB: [&str; 30] = [
    "chill", "ambient", "acoustic", "sleep", "relaxing", "meditation",
    "energetic", "workout", "upbeat", "dance", "hype", "party",
    "focus", "concentration", "study", "instrumental",
    "electronic", "rock", "pop", "jazz", "classical", "hip-hop",
    "melancholic", "happy", "dark", "experimental", "indie", "folk",
    "discovery", "underground",
];

pub fn tags_to_vec(tags: &HashMap<String, f32>) -> Vec<f32> {
    let raw: Vec<f32> = TAG_VOCAB.iter().map(|&t| tags.get(t).copied().unwrap_or(0.0)).collect();
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
    if na > 0.0 && nb > 0.0 { dot / (na * nb) } else { 0.0 }
}

pub fn seed_tags_vec(seed_tags: &[String]) -> Vec<f32> {
    let mut map = HashMap::new();
    for t in seed_tags {
        map.insert(t.clone(), 1.0_f32);
    }
    tags_to_vec(&map)
}

// ── Storage helpers ───────────────────────────────────────────────────────────

pub fn store_track_features_internal(db: &Db, canonical_id: &str, tags_json: &str, vec: &[f32]) -> Result<(), String> {
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

pub fn load_track_features_internal(db: &Db, canonical_id: &str) -> Result<Option<Vec<f32>>, String> {
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
    count: serde_json::Value, // Last.fm returns count as string or number
}

pub async fn fetch_track_tags(
    api_key: &str,
    artist: &str,
    title: &str,
) -> Result<HashMap<String, f32>, String> {
    let client = Client::new();
    let resp = client
        .get("https://ws.audioscrobbler.com/2.0/")
        .query(&[
            ("method", "track.getTopTags"),
            ("api_key", api_key),
            ("artist", artist),
            ("track", title),
            ("format", "json"),
            ("autocorrect", "1"),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json::<LastFmTagsResponse>()
        .await
        .map_err(|e| e.to_string())?;

    let mut map = HashMap::new();
    for tag in resp.toptags.tag {
        let count = match &tag.count {
            serde_json::Value::Number(n) => n.as_f64().unwrap_or(0.0) as f32,
            serde_json::Value::String(s) => s.parse::<f32>().unwrap_or(0.0),
            _ => 0.0,
        };
        map.insert(tag.name.to_lowercase(), count / 100.0);
    }
    Ok(map)
}

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
    let tags = fetch_track_tags(api_key, artist, title).await?;
    let tags_json = serde_json::to_string(&tags).map_err(|e| e.to_string())?;
    let vec = tags_to_vec(&tags);
    store_track_features_internal(db, canonical_id, &tags_json, &vec)?;
    Ok(vec)
}

// ── Tauri command ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_track_features(
    db: State<'_, Db>,
    canonical_id: String,
    artist: String,
    title: String,
) -> Result<Vec<f32>, String> {
    let api_key = db
        .get_setting("lastfm_api_key")
        .ok_or("Last.fm API key not configured")?;
    ensure_track_features(&db, &api_key, &canonical_id, &artist, &title).await
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
        let idx = TAG_VOCAB.iter().position(|&t| t == "chill").unwrap();
        assert!((vec[idx] - 1.0).abs() < 0.001);
    }

    #[test]
    fn test_cosine_similarity_identical_vectors() {
        let v = vec![1.0_f32, 0.0, 0.0];
        assert!((cosine_similarity(&v, &v) - 1.0).abs() < 0.001);
    }

    #[test]
    fn test_cosine_similarity_orthogonal_vectors() {
        let a = vec![1.0_f32, 0.0];
        let b = vec![0.0_f32, 1.0];
        assert!(cosine_similarity(&a, &b).abs() < 0.001);
    }

    #[test]
    fn test_seed_tags_to_vec_for_calm() {
        let seed_tags = vec!["chill".to_string(), "ambient".to_string(), "acoustic".to_string()];
        let vec = seed_tags_vec(&seed_tags);
        assert_eq!(vec.len(), 30);
        let idx = TAG_VOCAB.iter().position(|&t| t == "chill").unwrap();
        assert!(vec[idx] > 0.0);
    }

    #[test]
    fn test_store_and_load_features() {
        let db = test_db();
        let vec: Vec<f32> = vec![0.1_f32; 30];
        store_track_features_internal(&db, "h1", "{}", &vec).unwrap();
        let loaded = load_track_features_internal(&db, "h1").unwrap().unwrap();
        assert_eq!(loaded.len(), 30);
        assert!((loaded[0] - 0.1).abs() < 0.001);
    }
}
```

- [ ] **Step 4: Register in `src-tauri/src/lib.rs`**

Add before `use tauri::Manager;`:
```rust
mod track_features;
```

Add to invoke_handler:
```rust
track_features::get_track_features,
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd src-tauri && cargo test test_tags_to_vec test_cosine_similarity test_seed_tags test_store_and_load -- --nocapture 2>&1`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/track_features.rs src-tauri/src/lib.rs
git commit -m "feat: track feature vectors + Last.fm tag fetching"
```

---

## Phase 3 — Mood Engine

### Task 4: Mood Engine — Queue Generation

**Files:**
- Create: `src-tauri/src/mood_engine.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod mood_engine;`, register command)

- [ ] **Step 1: Write the failing tests**

```rust
// Will go in src-tauri/src/mood_engine.rs #[cfg(test)] block:

#[test]
fn test_determine_stage_cold_start() {
    use crate::db::test_db;
    let db = test_db();
    let stage = determine_stage(&db, "calm");
    assert!(matches!(stage, ScoringStage::ColdStart));
}

#[test]
fn test_determine_stage_context_learning() {
    use crate::db::test_db;
    use crate::commands::mood::record_mood_play_internal;
    let db = test_db();
    // Insert 50 plays for calm
    for i in 0..50 {
        record_mood_play_internal(&db, "calm", &format!("hash_{}", i), 0.8, false).unwrap();
    }
    let stage = determine_stage(&db, "calm");
    assert!(matches!(stage, ScoringStage::ContextLearning));
}

#[test]
fn test_apply_signal_multipliers_block() {
    use crate::db::test_db;
    let db = test_db();
    let conn = db.0.lock().unwrap();
    conn.execute(
        "INSERT INTO track_signals (canonical_id, signal, scope) VALUES ('h1', -1, 'global')",
        [],
    ).unwrap();
    drop(conn);
    let score = apply_signal_multipliers(&db, "h1", "calm", 0.8);
    assert!((score - 0.0).abs() < 0.001); // blocked = 0
}

#[test]
fn test_apply_signal_multipliers_boost() {
    use crate::db::test_db;
    let db = test_db();
    let conn = db.0.lock().unwrap();
    conn.execute(
        "INSERT INTO track_signals (canonical_id, signal, scope) VALUES ('h1', 1, 'global')",
        [],
    ).unwrap();
    drop(conn);
    let score = apply_signal_multipliers(&db, "h1", "calm", 0.8);
    assert!(score > 0.8); // boosted
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test test_determine_stage test_apply_signal -- --nocapture 2>&1`
Expected: FAIL

- [ ] **Step 3: Implement `src-tauri/src/mood_engine.rs`**

```rust
use crate::commands::mood::{MoodChannel, MoodTrackScore};
use crate::db::Db;
use crate::track_features::{cosine_similarity, load_track_features_internal, seed_tags_vec, ensure_track_features};
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

/// Returns signal multiplier for a track given mood scope.
/// -1 signal (block) → 0.0 (excluded), +1 signal (boost) → 1.5
pub fn apply_signal_multipliers(db: &Db, canonical_id: &str, mood_id: &str, base_score: f32) -> f32 {
    let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
    let mood_scope = format!("mood:{}", mood_id);

    // Check for block in global or mood scope
    let blocked: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM track_signals WHERE canonical_id = ?1 AND signal = -1 AND (scope = 'global' OR scope = ?2)",
            rusqlite::params![canonical_id, &mood_scope],
            |r| r.get::<_, i32>(0),
        )
        .unwrap_or(0)
        > 0;

    if blocked {
        return 0.0;
    }

    // Check for boost
    let boosted: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM track_signals WHERE canonical_id = ?1 AND signal = 1 AND (scope = 'global' OR scope = ?2)",
            rusqlite::params![canonical_id, &mood_scope],
            |r| r.get::<_, i32>(0),
        )
        .unwrap_or(0)
        > 0;

    if boosted { base_score * 1.5 } else { base_score }
}

/// Load candidate tracks from listen_history + track_likes (global pool, top-200).
fn load_global_candidates(db: &Db) -> Vec<QueueTrack> {
    let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
    // Try track_likes first; fall back gracefully if table doesn't exist
    let tracks: Vec<QueueTrack> = conn
        .prepare(
            "SELECT DISTINCT canonical_id, artist, title, source, source_id
             FROM listen_history
             WHERE canonical_id IS NOT NULL
             GROUP BY canonical_id
             ORDER BY COUNT(*) DESC
             LIMIT 200",
        )
        .and_then(|mut stmt| {
            stmt.query_map([], |row| {
                Ok(QueueTrack {
                    canonical_id: row.get(0)?,
                    artist: row.get(1).unwrap_or_default(),
                    title: row.get(2).unwrap_or_default(),
                    source: row.get(3).unwrap_or_default(),
                    source_id: row.get(4).unwrap_or_default(),
                    score: 0.5,
                    is_discovery: false,
                })
            })
            .map(|rows| rows.filter_map(|r| r.ok()).collect())
        })
        .unwrap_or_default();
    tracks
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

fn load_context_scores(db: &Db, mood_id: &str) -> std::collections::HashMap<String, MoodTrackScore> {
    crate::commands::mood::get_mood_track_scores_internal(db, mood_id)
        .unwrap_or_default()
        .into_iter()
        .map(|s| (s.canonical_id.clone(), s))
        .collect()
}

/// Score a single candidate. Returns (score, is_discovery).
fn score_track(
    canonical_id: &str,
    stage: &ScoringStage,
    seed_vec: &[f32],
    centroid_vec: Option<&Vec<f32>>,
    context_scores: &std::collections::HashMap<String, MoodTrackScore>,
    feature_vec: Option<&Vec<f32>>,
    global_rank_norm: f32,
) -> f32 {
    let audio_fit = feature_vec
        .map(|fv| {
            let reference = centroid_vec.unwrap_or(seed_vec);
            cosine_similarity(fv, reference)
        })
        .unwrap_or(0.3); // neutral score if no features

    let base = match stage {
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
    };

    base
}

/// Generate a mood queue of `limit` tracks (15 scored + 5 discovery).
/// Feature fetching is sync here — features must already be cached via get_track_features.
pub fn generate_mood_queue_internal(db: &Db, mood_id: &str, limit: usize) -> Vec<QueueTrack> {
    let stage = determine_stage(db, mood_id);
    let seed_vec = load_mood_seed_vec(db, mood_id);
    let centroid = load_mood_centroid(db, mood_id);
    let context_scores = load_context_scores(db, mood_id);
    let mut candidates = load_global_candidates(db);
    let total = candidates.len();

    // Normalize global rank (position in list = rank)
    for (i, track) in candidates.iter_mut().enumerate() {
        let feature_vec = load_track_features_internal(db, &track.canonical_id).ok().flatten();
        let global_rank_norm = 1.0 - (i as f32 / total.max(1) as f32);

        let raw_score = score_track(
            &track.canonical_id,
            &stage,
            &seed_vec,
            centroid.as_ref(),
            &context_scores,
            feature_vec.as_deref(),
            global_rank_norm,
        );
        track.score = apply_signal_multipliers(db, &track.canonical_id, mood_id, raw_score);
    }

    // Split: scored (non-zero) vs excluded
    let mut scored: Vec<QueueTrack> = candidates.into_iter().filter(|t| t.score > 0.0).collect();
    scored.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));

    let main_count = (limit.saturating_sub(5)).min(scored.len());
    let mut queue: Vec<QueueTrack> = scored.drain(..main_count).collect();

    // Discovery: lowest-scored tracks with score > 0.2, not played in last 30 days
    let discovery_candidates: Vec<QueueTrack> = scored
        .into_iter()
        .filter(|t| t.score > 0.2 && !context_scores.contains_key(&t.canonical_id))
        .take(5)
        .map(|mut t| { t.is_discovery = true; t })
        .collect();
    queue.extend(discovery_candidates);

    queue
}

#[tauri::command]
pub fn generate_mood_queue(
    db: State<Db>,
    mood_id: String,
    limit: Option<usize>,
) -> Result<Vec<QueueTrack>, String> {
    Ok(generate_mood_queue_internal(&db, &mood_id, limit.unwrap_or(20)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_db;
    use crate::commands::mood::record_mood_play_internal;

    #[test]
    fn test_determine_stage_cold_start() {
        let db = test_db();
        let stage = determine_stage(&db, "calm");
        assert!(matches!(stage, ScoringStage::ColdStart));
    }

    #[test]
    fn test_determine_stage_context_learning() {
        let db = test_db();
        // Need listen_history to exist for global candidates
        db.0.lock().unwrap().execute_batch(
            "CREATE TABLE IF NOT EXISTS listen_history (
                id INTEGER PRIMARY KEY, canonical_id TEXT, artist TEXT DEFAULT '', title TEXT DEFAULT '',
                source TEXT DEFAULT '', source_id TEXT DEFAULT '', source_mood TEXT NULL
            )",
        ).unwrap();
        for i in 0..50 {
            record_mood_play_internal(&db, "calm", &format!("hash_{}", i), 0.8, false).unwrap();
        }
        let stage = determine_stage(&db, "calm");
        assert!(matches!(stage, ScoringStage::ContextLearning));
    }

    #[test]
    fn test_apply_signal_multipliers_block() {
        let db = test_db();
        db.0.lock().unwrap().execute(
            "INSERT INTO track_signals (canonical_id, signal, scope) VALUES ('h1', -1, 'global')",
            [],
        ).unwrap();
        let score = apply_signal_multipliers(&db, "h1", "calm", 0.8);
        assert!((score - 0.0).abs() < 0.001);
    }

    #[test]
    fn test_apply_signal_multipliers_boost() {
        let db = test_db();
        db.0.lock().unwrap().execute(
            "INSERT INTO track_signals (canonical_id, signal, scope) VALUES ('h1', 1, 'global')",
            [],
        ).unwrap();
        let score = apply_signal_multipliers(&db, "h1", "calm", 0.8);
        assert!(score > 0.8);
    }
}
```

- [ ] **Step 4: Register in `src-tauri/src/lib.rs`**

Add: `mod mood_engine;`

Add to invoke_handler: `mood_engine::generate_mood_queue,`

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd src-tauri && cargo test test_determine_stage test_apply_signal -- --nocapture 2>&1`
Expected: PASS

- [ ] **Step 6: Verify it compiles**

Run: `cd src-tauri && cargo check 2>&1`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/mood_engine.rs src-tauri/src/lib.rs
git commit -m "feat: mood scoring engine + queue generation"
```

---

### Task 5: Centroid Computation

**Files:**
- Modify: `src-tauri/src/mood_engine.rs` (add centroid functions)
- Modify: `src-tauri/src/lib.rs` (register new command)

- [ ] **Step 1: Write the failing test**

```rust
// Add to mood_engine.rs tests block:

#[test]
fn test_update_centroid_averages_vectors() {
    use crate::track_features::store_track_features_internal;
    let db = test_db();
    db.0.lock().unwrap().execute_batch(
        "CREATE TABLE IF NOT EXISTS listen_history (
            id INTEGER PRIMARY KEY, canonical_id TEXT, artist TEXT DEFAULT '', title TEXT DEFAULT '',
            source TEXT DEFAULT '', source_id TEXT DEFAULT '', source_mood TEXT NULL
        )",
    ).unwrap();

    // Two tracks with known feature vecs
    let v1: Vec<f32> = (0..30).map(|i| if i == 0 { 1.0 } else { 0.0 }).collect();
    let v2: Vec<f32> = (0..30).map(|i| if i == 1 { 1.0 } else { 0.0 }).collect();
    store_track_features_internal(&db, "h1", "{}", &v1).unwrap();
    store_track_features_internal(&db, "h2", "{}", &v2).unwrap();

    // Both played in calm
    record_mood_play_internal(&db, "calm", "h1", 1.0, false).unwrap();
    record_mood_play_internal(&db, "calm", "h2", 1.0, false).unwrap();

    update_centroid(&db, "calm").unwrap();

    let centroid = load_mood_centroid(&db, "calm").unwrap();
    // Centroid should be average of v1 and v2, then normalized
    assert_eq!(centroid.len(), 30);
    assert!(centroid[0] > 0.0);
    assert!(centroid[1] > 0.0);
    // Other dims should be 0
    assert!((centroid[2]).abs() < 0.001);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test test_update_centroid -- --nocapture 2>&1`
Expected: FAIL

- [ ] **Step 3: Add `update_centroid` to `src-tauri/src/mood_engine.rs`**

Add these functions after `generate_mood_queue_internal`:

```rust
pub fn update_centroid(db: &Db, mood_id: &str) -> Result<(), String> {
    // Get all tracks played in this mood that have feature vectors
    let scored_canonical_ids: Vec<String> = {
        let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
        conn.prepare(
            "SELECT canonical_id FROM mood_track_scores WHERE mood_id = ?1 ORDER BY play_count DESC",
        )
        .map_err(|e| e.to_string())?
        .query_map(rusqlite::params![mood_id], |r| r.get(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect()
    };

    let mut vecs: Vec<Vec<f32>> = Vec::new();
    for id in &scored_canonical_ids {
        if let Ok(Some(v)) = load_track_features_internal(db, id) {
            vecs.push(v);
        }
    }

    if vecs.is_empty() {
        return Ok(());
    }

    let dim = vecs[0].len();
    let mut centroid = vec![0.0_f32; dim];
    for v in &vecs {
        for (i, x) in v.iter().enumerate() {
            centroid[i] += x;
        }
    }
    let n = vecs.len() as f32;
    let mut avg: Vec<f32> = centroid.iter().map(|x| x / n).collect();

    // Normalize
    let norm = (avg.iter().map(|x| x * x).sum::<f32>()).sqrt();
    if norm > 0.0 {
        avg = avg.iter().map(|x| x / norm).collect();
    }

    let centroid_json = serde_json::to_string(&avg).map_err(|e| e.to_string())?;
    let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
    conn.execute(
        "INSERT OR REPLACE INTO mood_centroids (mood_id, centroid_vec, track_count, updated_at)
         VALUES (?1, ?2, ?3, unixepoch())",
        rusqlite::params![mood_id, centroid_json, vecs.len() as i32],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn update_mood_centroid(db: State<Db>, mood_id: String) -> Result<(), String> {
    update_centroid(&db, &mood_id)
}
```

- [ ] **Step 4: Register command in `src-tauri/src/lib.rs`**

Add to invoke_handler: `mood_engine::update_mood_centroid,`

- [ ] **Step 5: Run test to verify it passes**

Run: `cd src-tauri && cargo test test_update_centroid -- --nocapture 2>&1`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/mood_engine.rs src-tauri/src/lib.rs
git commit -m "feat: mood centroid computation"
```

---

## Phase 4 — Explicit Signals

### Task 6: Signal Commands

**Files:**
- Modify: `src-tauri/src/commands/mood.rs` (add signal functions)
- Modify: `src-tauri/src/lib.rs` (register new commands)

- [ ] **Step 1: Write the failing tests**

```rust
// Add to commands/mood.rs tests block:

#[test]
fn test_record_global_block_signal() {
    let db = test_db();
    record_signal_internal(&db, "h1", -1, "global").unwrap();
    let conn = db.0.lock().unwrap();
    let sig: i32 = conn
        .query_row("SELECT signal FROM track_signals WHERE canonical_id='h1' AND scope='global'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(sig, -1);
}

#[test]
fn test_delete_signal() {
    let db = test_db();
    record_signal_internal(&db, "h1", -1, "global").unwrap();
    delete_signal_internal(&db, "h1", "global").unwrap();
    let conn = db.0.lock().unwrap();
    let count: i32 = conn
        .query_row("SELECT COUNT(*) FROM track_signals WHERE canonical_id='h1'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count, 0);
}

#[test]
fn test_upsert_tag_weight() {
    let db = test_db();
    upsert_tag_weight_internal(&db, "ambient", "global", 0.2).unwrap();
    let conn = db.0.lock().unwrap();
    let w: f64 = conn
        .query_row("SELECT weight FROM tag_weights WHERE tag='ambient' AND scope='global'", [], |r| r.get(0))
        .unwrap();
    assert!((w - 0.2).abs() < 0.001);
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test test_record_global_block test_delete_signal test_upsert_tag -- --nocapture 2>&1`
Expected: FAIL

- [ ] **Step 3: Add signal functions to `src-tauri/src/commands/mood.rs`**

Add these internal helpers and Tauri commands:

```rust
// ── Internal helpers ──────────────────────────────────────────────────────────

pub fn record_signal_internal(db: &Db, canonical_id: &str, signal: i32, scope: &str) -> Result<(), String> {
    let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
    conn.execute(
        "INSERT INTO track_signals (canonical_id, signal, scope) VALUES (?1, ?2, ?3)",
        rusqlite::params![canonical_id, signal, scope],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn delete_signal_internal(db: &Db, canonical_id: &str, scope: &str) -> Result<(), String> {
    let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
    conn.execute(
        "DELETE FROM track_signals WHERE canonical_id = ?1 AND scope = ?2",
        rusqlite::params![canonical_id, scope],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn upsert_tag_weight_internal(db: &Db, tag: &str, scope: &str, weight: f64) -> Result<(), String> {
    let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
    conn.execute(
        "INSERT OR REPLACE INTO tag_weights (tag, scope, weight) VALUES (?1, ?2, ?3)",
        rusqlite::params![tag, scope, weight],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn delete_tag_weight_internal(db: &Db, tag: &str, scope: &str) -> Result<(), String> {
    let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
    conn.execute(
        "DELETE FROM tag_weights WHERE tag = ?1 AND scope = ?2",
        rusqlite::params![tag, scope],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Serialize, Deserialize, Clone)]
pub struct TagWeight {
    pub tag: String,
    pub scope: String,
    pub weight: f64,
}

pub fn list_tag_weights_internal(db: &Db, scope: &str) -> Result<Vec<TagWeight>, String> {
    let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
    let mut stmt = conn
        .prepare("SELECT tag, scope, weight FROM tag_weights WHERE scope = ?1 OR scope LIKE ?2 ORDER BY weight ASC")
        .map_err(|e| e.to_string())?;
    let mood_scope_pattern = format!("mood:%");
    let weights = stmt
        .query_map(rusqlite::params![scope, mood_scope_pattern], |row| {
            Ok(TagWeight { tag: row.get(0)?, scope: row.get(1)?, weight: row.get(2)? })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(weights)
}

// ── Tauri commands ────────────────────────────────────────────────────────────

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
pub fn delete_track_signal(db: State<Db>, canonical_id: String, scope: String) -> Result<(), String> {
    delete_signal_internal(&db, &canonical_id, &scope)
}

#[tauri::command]
pub fn list_tag_weights(db: State<Db>, scope: String) -> Result<Vec<TagWeight>, String> {
    list_tag_weights_internal(&db, &scope)
}

#[tauri::command]
pub fn delete_tag_weight(db: State<Db>, tag: String, scope: String) -> Result<(), String> {
    delete_tag_weight_internal(&db, &tag, &scope)
}

#[tauri::command]
pub fn upsert_tag_weight(db: State<Db>, tag: String, scope: String, weight: f64) -> Result<(), String> {
    upsert_tag_weight_internal(&db, &tag, &scope, weight)
}
```

- [ ] **Step 4: Register in `src-tauri/src/lib.rs`**

Add to invoke_handler:
```rust
commands::mood::record_track_signal,
commands::mood::delete_track_signal,
commands::mood::list_tag_weights,
commands::mood::delete_tag_weight,
commands::mood::upsert_tag_weight,
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd src-tauri && cargo test test_record_global_block test_delete_signal test_upsert_tag -- --nocapture 2>&1`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands/mood.rs src-tauri/src/lib.rs
git commit -m "feat: explicit signal commands (boost/block + tag weights)"
```

---

## Phase 5 — Frontend

### Task 7: mood-service.ts

**Files:**
- Create: `src/recommendations/mood-service.ts`
- Create: `src/recommendations/mood-service.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/recommendations/mood-service.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { MoodService } from "./mood-service";

describe("MoodService", () => {
  let svc: MoodService;

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    svc = new MoodService();
  });

  it("starts with no active mood", () => {
    expect(svc.activeMood).toBeNull();
  });

  it("setMood persists to localStorage", () => {
    svc.setMood("calm");
    expect(svc.activeMood).toBe("calm");
    expect(localStorage.getItem("goamp_active_mood")).toBe("calm");
  });

  it("setMood(null) clears mood", () => {
    svc.setMood("calm");
    svc.setMood(null);
    expect(svc.activeMood).toBeNull();
    expect(localStorage.getItem("goamp_active_mood")).toBeNull();
  });

  it("restores activeMood from localStorage on construction", () => {
    localStorage.setItem("goamp_active_mood", "focus");
    const svc2 = new MoodService();
    expect(svc2.activeMood).toBe("focus");
  });

  it("generateQueue calls invoke with mood_id", async () => {
    vi.mocked(invoke).mockResolvedValue([]);
    await svc.generateQueue("calm", 20);
    expect(invoke).toHaveBeenCalledWith("generate_mood_queue", { moodId: "calm", limit: 20 });
  });

  it("recordPlay calls invoke with correct args", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await svc.recordPlay("hash_abc", "calm", 0.85, false);
    expect(invoke).toHaveBeenCalledWith("record_mood_play", {
      moodId: "calm",
      canonicalId: "hash_abc",
      completionRate: 0.85,
      skipped: false,
    });
  });

  it("recordSignal calls invoke with scope", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await svc.recordSignal("hash_abc", 1, "global");
    expect(invoke).toHaveBeenCalledWith("record_track_signal", {
      canonicalId: "hash_abc",
      signal: 1,
      scope: "global",
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/recommendations/mood-service.test.ts 2>&1`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `src/recommendations/mood-service.ts`**

```typescript
import { invoke } from "@tauri-apps/api/core";

export interface MoodChannel {
  id: string;
  name: string;
  is_preset: boolean;
  seed_tags: string[];
}

export interface QueueTrack {
  canonical_id: string;
  title: string;
  artist: string;
  source: string;
  source_id: string;
  score: number;
  is_discovery: boolean;
}

export interface TagWeight {
  tag: string;
  scope: string;
  weight: number;
}

const ACTIVE_MOOD_KEY = "goamp_active_mood";

export class MoodService {
  private _activeMood: string | null;
  private _listeners: Array<(mood: string | null) => void> = [];

  constructor() {
    this._activeMood = localStorage.getItem(ACTIVE_MOOD_KEY);
  }

  get activeMood(): string | null {
    return this._activeMood;
  }

  setMood(id: string | null): void {
    this._activeMood = id;
    if (id === null) {
      localStorage.removeItem(ACTIVE_MOOD_KEY);
    } else {
      localStorage.setItem(ACTIVE_MOOD_KEY, id);
    }
    this._listeners.forEach((fn) => fn(id));
  }

  onMoodChange(fn: (mood: string | null) => void): () => void {
    this._listeners.push(fn);
    return () => {
      this._listeners = this._listeners.filter((l) => l !== fn);
    };
  }

  async listMoods(): Promise<MoodChannel[]> {
    return invoke("list_moods");
  }

  async createMood(id: string, name: string, seedTags: string[]): Promise<void> {
    return invoke("create_mood", {
      id,
      name,
      seedTagsJson: JSON.stringify(seedTags),
    });
  }

  async deleteMood(id: string): Promise<void> {
    return invoke("delete_mood", { id });
  }

  async generateQueue(moodId: string, limit = 20): Promise<QueueTrack[]> {
    return invoke("generate_mood_queue", { moodId, limit });
  }

  async recordPlay(
    canonicalId: string,
    moodId: string,
    completionRate: number,
    skipped: boolean
  ): Promise<void> {
    return invoke("record_mood_play", { moodId, canonicalId, completionRate, skipped });
  }

  async recordSignal(canonicalId: string, signal: 1 | -1, scope: string): Promise<void> {
    return invoke("record_track_signal", { canonicalId, signal, scope });
  }

  async listTagWeights(scope = "global"): Promise<TagWeight[]> {
    return invoke("list_tag_weights", { scope });
  }

  async deleteTagWeight(tag: string, scope: string): Promise<void> {
    return invoke("delete_tag_weight", { tag, scope });
  }

  async prefetchFeatures(canonicalId: string, artist: string, title: string): Promise<void> {
    return invoke("get_track_features", { canonicalId, artist, title }).catch(() => {
      // Non-fatal: features are optional for cold start fallback
    });
  }
}

export const moodService = new MoodService();
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/recommendations/mood-service.test.ts 2>&1`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/recommendations/mood-service.ts src/recommendations/mood-service.test.ts
git commit -m "feat: MoodService frontend — mood state, queue, signals"
```

---

### Task 8: Mood Tabs in Player

**Files:**
- Modify: `src/webamp/bridge.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// Add to src/webamp/goamp-menu.test.ts or create src/webamp/bridge.test.ts:
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../recommendations/mood-service", () => ({
  moodService: {
    activeMood: null,
    setMood: vi.fn(),
    listMoods: vi.fn().mockResolvedValue([
      { id: "calm", name: "Calm", is_preset: true, seed_tags: [] },
      { id: "energetic", name: "Energetic", is_preset: true, seed_tags: [] },
    ]),
    onMoodChange: vi.fn().mockReturnValue(() => {}),
  },
}));

import { renderMoodTabs } from "./bridge";

describe("renderMoodTabs", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="webamp"><div id="main-window"></div></div>';
  });

  it("injects mood-tabs div into the DOM", async () => {
    await renderMoodTabs();
    expect(document.getElementById("mood-tabs")).not.toBeNull();
  });

  it("renders a tab for each mood", async () => {
    await renderMoodTabs();
    const tabs = document.querySelectorAll(".mood-tab");
    expect(tabs.length).toBe(2);
  });

  it("renders add-mood button", async () => {
    await renderMoodTabs();
    expect(document.getElementById("mood-tab-add")).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/webamp/bridge.test.ts 2>&1`
Expected: FAIL — `renderMoodTabs` not exported

- [ ] **Step 3: Add `renderMoodTabs` to `src/webamp/bridge.ts`**

Add at the end of bridge.ts:

```typescript
import { moodService } from "../recommendations/mood-service";

let moodTabsEl: HTMLDivElement | null = null;

export async function renderMoodTabs(): Promise<void> {
  if (moodTabsEl) {
    moodTabsEl.remove();
    moodTabsEl = null;
  }

  const moods = await moodService.listMoods();
  const webampEl = document.getElementById("webamp");
  if (!webampEl) return;

  moodTabsEl = document.createElement("div");
  moodTabsEl.id = "mood-tabs";
  moodTabsEl.style.cssText = `
    display: flex; gap: 3px; padding: 2px 4px; background: #000;
    border-top: 1px solid #333; align-items: center; flex-wrap: wrap;
    font-family: 'MS Sans Serif', Tahoma, sans-serif; font-size: 10px;
  `;

  const render = () => {
    moodTabsEl!.innerHTML = "";
    moods.forEach((m) => {
      const tab = document.createElement("span");
      tab.className = "mood-tab";
      tab.dataset.moodId = m.id;
      const isActive = moodService.activeMood === m.id;
      tab.style.cssText = `
        padding: 1px 6px; cursor: pointer; border: 1px solid;
        border-color: ${isActive ? "#0f0" : "#444"};
        background: ${isActive ? "#1a3a1a" : "#111"};
        color: ${isActive ? "#0f0" : "#666"};
        user-select: none;
      `;
      tab.textContent = (isActive ? "● " : "") + m.name;
      tab.addEventListener("click", () => {
        moodService.setMood(moodService.activeMood === m.id ? null : m.id);
      });
      moodTabsEl!.appendChild(tab);
    });

    // + add custom mood button
    const addBtn = document.createElement("span");
    addBtn.id = "mood-tab-add";
    addBtn.style.cssText = "padding: 1px 6px; cursor: pointer; color: #444; border: 1px solid #222; background: #111;";
    addBtn.textContent = "+ add";
    addBtn.addEventListener("click", () => promptCreateMood());
    moodTabsEl!.appendChild(addBtn);
  };

  render();
  moodService.onMoodChange(() => render());

  // Insert after main-window inside webamp
  const mainWindow = webampEl.querySelector("#main-window") ?? webampEl.firstElementChild;
  if (mainWindow && mainWindow.parentNode) {
    mainWindow.parentNode.insertBefore(moodTabsEl, mainWindow.nextSibling);
  } else {
    webampEl.appendChild(moodTabsEl);
  }
}

function promptCreateMood(): void {
  const name = window.prompt("Mood name:");
  if (!name?.trim()) return;
  const id = name.trim().toLowerCase().replace(/\s+/g, "_");
  moodService.createMood(id, name.trim(), []).then(() => renderMoodTabs());
}
```

Also update the `initBridge` call (or wherever bridge initializes) to call `renderMoodTabs()` after Webamp is ready. Find the Webamp `ready` event in bridge.ts and add:

```typescript
webamp.onReady(() => {
  // existing code...
  renderMoodTabs();
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/webamp/bridge.test.ts 2>&1`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/webamp/bridge.ts
git commit -m "feat: mood tabs in Winamp player window"
```

---

### Task 9: Context Menu + Rec Settings Panel

**Files:**
- Modify: `src/webamp/goamp-menu.ts`
- Modify: `src/settings/FeatureFlagsPanel.ts`

- [ ] **Step 1: Write the failing test for context menu**

```typescript
// Add to src/webamp/goamp-menu.test.ts:
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../recommendations/mood-service", () => ({
  moodService: { activeMood: "calm" },
}));

import { buildSignalMenuItems } from "./goamp-menu";

describe("buildSignalMenuItems", () => {
  it("returns boost and block items", () => {
    const items = buildSignalMenuItems("hash_abc", "Rick Astley", "Never Gonna Give You Up");
    const labels = items.map((i) => i.label);
    expect(labels).toContain("↑ Recommend similar");
    expect(labels).toContain("✕ Don't recommend");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/webamp/goamp-menu.test.ts 2>&1`
Expected: FAIL — `buildSignalMenuItems` not exported

- [ ] **Step 3: Add signal menu items to `src/webamp/goamp-menu.ts`**

Add these functions and update `showGoampMenu`:

```typescript
import { moodService } from "../recommendations/mood-service";
import { invoke } from "@tauri-apps/api/core";

interface SubMenuItem {
  label: string;
  action: () => void;
}

// Add this interface extension to MenuItem:
// submenu?: SubMenuItem[];

export function buildSignalMenuItems(
  canonicalId: string,
  _artist: string,
  _title: string
): MenuItem[] {
  const activeMood = moodService.activeMood;

  const boost = (scope: string) => {
    invoke("record_track_signal", { canonicalId, signal: 1, scope }).catch(console.error);
  };
  const block = (scope: string) => {
    invoke("record_track_signal", { canonicalId, signal: -1, scope }).catch(console.error);
  };

  if (activeMood) {
    return [
      {
        label: "↑ Recommend similar",
        action: () => showScopeSubmenu(
          [
            { label: `In ${activeMood} only`, action: () => boost(`mood:${activeMood}`) },
            { label: "Globally (all moods)", action: () => boost("global") },
          ]
        ),
      },
      {
        label: "✕ Don't recommend",
        action: () => showScopeSubmenu(
          [
            { label: `In ${activeMood} only`, action: () => block(`mood:${activeMood}`) },
            { label: "Globally (all moods)", action: () => block("global") },
          ]
        ),
      },
    ];
  }

  return [
    { label: "↑ Recommend similar", action: () => boost("global") },
    { label: "✕ Don't recommend", action: () => block("global") },
  ];
}

let scopeSubmenu: HTMLDivElement | null = null;

function showScopeSubmenu(items: SubMenuItem[]): void {
  if (scopeSubmenu) scopeSubmenu.remove();
  scopeSubmenu = document.createElement("div");
  scopeSubmenu.style.cssText = `
    position: fixed; background: #1a1a2e; border: 1px solid #444; z-index: 10002;
    font-family: 'MS Sans Serif', Tahoma, sans-serif; font-size: 11px; color: #0f0;
    min-width: 160px;
  `;
  items.forEach((item) => {
    const row = document.createElement("div");
    row.style.cssText = "padding: 4px 12px; cursor: pointer;";
    row.textContent = item.label;
    row.addEventListener("mouseenter", () => (row.style.background = "#2a2a4a"));
    row.addEventListener("mouseleave", () => (row.style.background = ""));
    row.addEventListener("click", () => {
      item.action();
      scopeSubmenu?.remove();
      scopeSubmenu = null;
      closeGoampMenu();
    });
    scopeSubmenu!.appendChild(row);
  });
  // Position near current menu
  const menuEl = document.getElementById("goamp-context-menu");
  if (menuEl) {
    const rect = menuEl.getBoundingClientRect();
    scopeSubmenu.style.left = `${rect.right + 2}px`;
    scopeSubmenu.style.top = `${rect.top}px`;
  }
  document.body.appendChild(scopeSubmenu);
  setTimeout(() => {
    document.addEventListener("mousedown", () => { scopeSubmenu?.remove(); scopeSubmenu = null; }, { once: true });
  }, 0);
}
```

In `showGoampMenu`, after the existing items array, add the signal items (with separator):

```typescript
  // After existing items, before rendering:
  // Get current playing track's canonical_id from Webamp store if available
  const currentTrack = webampRef ? (webampRef as any).store?.getState()?.tracks?.currentTrack : null;
  if (currentTrack) {
    const canonicalId = `${currentTrack.defaultName ?? ""}:${currentTrack.url ?? ""}`;
    items.push({ label: "", action: () => {}, separator: true });
    items.push(...buildSignalMenuItems(canonicalId, currentTrack.artist ?? "", currentTrack.defaultName ?? ""));
  }
```

- [ ] **Step 4: Add Rec Settings section to `src/settings/FeatureFlagsPanel.ts`**

Find `renderFlags` function and add after the existing flags rendering:

```typescript
import { invoke } from "@tauri-apps/api/core";
import type { TagWeight } from "../recommendations/mood-service";

// Add to the bottom of renderFlags():
async function renderRecSettings(container: HTMLDivElement): Promise<void> {
  const section = document.createElement("div");
  section.style.cssText = "padding: 8px 4px; border-top: 1px solid #333; margin-top: 8px;";
  section.innerHTML = `
    <div style="color:#fc0; font-weight:bold; margin-bottom:6px;">Recommendations</div>
    <div id="rec-boosted-section" style="margin-bottom:6px;">
      <div style="color:#888; font-size:10px; margin-bottom:3px;">BOOSTED TAGS</div>
      <div id="rec-boosted-tags" style="display:flex; flex-wrap:wrap; gap:3px;"></div>
    </div>
    <div id="rec-blocked-section" style="margin-bottom:8px;">
      <div style="color:#888; font-size:10px; margin-bottom:3px;">BLOCKED TAGS</div>
      <div id="rec-blocked-tags" style="display:flex; flex-wrap:wrap; gap:3px;"></div>
    </div>
    <div style="margin-bottom:6px;">
      <div style="color:#888; font-size:10px; margin-bottom:3px;">MOOD INFLUENCE</div>
      <div style="display:flex; align-items:center; gap:6px;">
        <span style="color:#555; font-size:9px;">weak</span>
        <input type="range" id="rec-mood-influence" min="1" max="7" step="1" value="4" style="flex:1; accent-color:#0f0;" />
        <span style="color:#555; font-size:9px;">strong</span>
      </div>
    </div>
    <div style="margin-bottom:6px;">
      <div style="color:#888; font-size:10px; margin-bottom:3px;">DISCOVERY RATIO (tracks per batch)</div>
      <div style="display:flex; align-items:center; gap:6px;">
        <span style="color:#555; font-size:9px;">0</span>
        <input type="range" id="rec-discovery" min="0" max="10" step="1" value="5" style="flex:1; accent-color:#0f0;" />
        <span style="color:#555; font-size:9px;">10</span>
      </div>
    </div>
  `;
  container.appendChild(section);

  // Load tag weights
  try {
    const weights: TagWeight[] = await invoke("list_tag_weights", { scope: "global" });
    const boostedEl = section.querySelector("#rec-boosted-tags") as HTMLDivElement;
    const blockedEl = section.querySelector("#rec-blocked-tags") as HTMLDivElement;

    const renderChip = (tw: TagWeight, container: HTMLDivElement) => {
      const chip = document.createElement("span");
      const isBoost = tw.weight > 1.0;
      chip.style.cssText = `
        padding: 1px 6px; border: 1px solid; cursor: pointer; font-size: 10px;
        border-color: ${isBoost ? "#0f0" : "#f44"};
        background: ${isBoost ? "#1a3a1a" : "#3a1a1a"};
        color: ${isBoost ? "#0f0" : "#f44"};
      `;
      chip.textContent = `${tw.tag} ×`;
      chip.title = "Click to remove";
      chip.addEventListener("click", async () => {
        await invoke("delete_tag_weight", { tag: tw.tag, scope: tw.scope });
        chip.remove();
      });
      container.appendChild(chip);
    };

    weights.filter((w) => w.weight > 1.0).forEach((w) => renderChip(w, boostedEl));
    weights.filter((w) => w.weight < 1.0).forEach((w) => renderChip(w, blockedEl));
  } catch {
    // Non-fatal if rec tables not ready
  }

  // Wire sliders to settings
  const moodSlider = section.querySelector("#rec-mood-influence") as HTMLInputElement;
  const discoverySlider = section.querySelector("#rec-discovery") as HTMLInputElement;

  const saved_mood = await invoke("get_setting", { key: "rec_mood_influence" }).catch(() => "4");
  const saved_disc = await invoke("get_setting", { key: "rec_discovery_count" }).catch(() => "5");
  moodSlider.value = String(saved_mood ?? "4");
  discoverySlider.value = String(saved_disc ?? "5");

  moodSlider.addEventListener("change", () =>
    invoke("set_setting", { key: "rec_mood_influence", value: moodSlider.value }).catch(() => {})
  );
  discoverySlider.addEventListener("change", () =>
    invoke("set_setting", { key: "rec_discovery_count", value: discoverySlider.value }).catch(() => {})
  );
}
```

In `loadFlags()`, after `renderFlags(list, flags)`, add:
```typescript
    await renderRecSettings(list);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test src/webamp/goamp-menu.test.ts 2>&1`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/webamp/goamp-menu.ts src/settings/FeatureFlagsPanel.ts
git commit -m "feat: signal context menu + rec settings in feature flags panel"
```

---

## Phase 6 — P2P

### Task 10: Mood Centroids in TasteProfile Proto

**Files:**
- Modify: `goamp-node/proto/goamp.proto`
- Modify: `goamp-node/proto/goamp.pb.go` (regenerate or edit manually)
- Modify: `goamp-node/api/profile_handlers.go`

- [ ] **Step 1: Write the failing test**

```go
// Add to goamp-node/sdk/profiles/profiles_test.go:

func TestMoodCentroidsInProfile(t *testing.T) {
    profile := &proto.TasteProfile{
        MoodCentroids: map[string]*proto.MoodCentroid{
            "calm": {
                Vec:        []float32{0.1, 0.2, 0.3},
                TrackCount: 55,
                UpdatedAt:  time.Now().Unix(),
            },
        },
    }
    require.NotNil(t, profile.MoodCentroids["calm"])
    require.Equal(t, int32(55), profile.MoodCentroids["calm"].TrackCount)
    require.Equal(t, 3, len(profile.MoodCentroids["calm"].Vec))
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd goamp-node && go test ./sdk/profiles/... 2>&1`
Expected: FAIL — MoodCentroid not defined

- [ ] **Step 3: Update `goamp-node/proto/goamp.proto`**

Add after the existing `TasteProfile` message:

```protobuf
message MoodCentroid {
  repeated float vec = 1;     // ~30-dim normalized tag vector
  int32 track_count = 2;      // number of tracks that contributed
  int64 updated_at = 3;
}
```

Update `TasteProfile` to add:

```protobuf
message TasteProfile {
  // existing fields...
  map<string, MoodCentroid> mood_centroids = 5;
}
```

- [ ] **Step 4: Update generated `goamp-node/proto/goamp.pb.go`**

Add the `MoodCentroid` struct and update `TasteProfile`. Since we commit generated files, add manually:

```go
type MoodCentroid struct {
    Vec        []float32 `protobuf:"..."`
    TrackCount int32     `protobuf:"..."`
    UpdatedAt  int64     `protobuf:"..."`
    // standard protobuf embedded fields
    state         protoimpl.MessageState
    sizeCache     protoimpl.SizeCache
    unknownFields protoimpl.UnknownFields
}

func (x *MoodCentroid) GetVec() []float32        { return x.Vec }
func (x *MoodCentroid) GetTrackCount() int32      { return x.TrackCount }
func (x *MoodCentroid) GetUpdatedAt() int64       { return x.UpdatedAt }
```

Add to `TasteProfile` struct:
```go
MoodCentroids map[string]*MoodCentroid `protobuf:"bytes,5,rep,name=mood_centroids,json=moodCentroids,proto3" json:"mood_centroids,omitempty" protobuf_key:"bytes,1,opt,name=key,proto3" protobuf_val:"bytes,2,opt,name=value,proto3"`
```

Add getter:
```go
func (x *TasteProfile) GetMoodCentroids() map[string]*MoodCentroid {
    if x != nil {
        return x.MoodCentroids
    }
    return nil
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd goamp-node && go test ./sdk/profiles/... 2>&1`
Expected: PASS

- [ ] **Step 6: Update `goamp-node/api/profile_handlers.go`**

In the `POST /profiles/sync` handler body, when building the profile response, include mood centroids filter (only include moods with track_count >= 10):

```go
// In the sync handler, after building TasteProfile from store:
filteredCentroids := make(map[string]*proto.MoodCentroid)
for moodID, centroid := range profile.MoodCentroids {
    if centroid.TrackCount >= 10 {
        filteredCentroids[moodID] = centroid
    }
}
profile.MoodCentroids = filteredCentroids
```

- [ ] **Step 7: Verify goamp-node compiles**

Run: `cd goamp-node && go build ./... 2>&1`
Expected: no errors

- [ ] **Step 8: Commit**

```bash
git add goamp-node/proto/ goamp-node/api/profile_handlers.go
git commit -m "feat: mood centroids in TasteProfile proto + P2P sync filter"
```

---

## Integration Smoke Test

After all tasks complete:

- [ ] **Run all Rust tests**

```bash
cd src-tauri && cargo test 2>&1
```
Expected: all pass

- [ ] **Run all TypeScript tests**

```bash
pnpm test 2>&1
```
Expected: all pass

- [ ] **Manual smoke test (dev mode)**

```bash
GDK_BACKEND=x11 LIBGL_ALWAYS_SOFTWARE=1 pnpm tauri dev
```

1. Mood tabs appear below Winamp player window
2. Click "Calm" — tab highlights green
3. Right-click a track → `↑ Recommend similar` and `✕ Don't recommend` appear with scope submenu
4. Open Feature Flags panel (`Ctrl+Shift+\``) → "Recommendations" section at bottom with sliders
5. Invoke `generate_mood_queue` from browser console: `window.__TAURI__.core.invoke("generate_mood_queue", {moodId: "calm", limit: 5})` → returns array

- [ ] **Final commit**

```bash
git add .
git commit -m "feat: mood-based recommendation system — radio channels, scoring, signals, P2P centroids"
```
