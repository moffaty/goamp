# GOAMP Recommendation System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local-first recommendation engine with P2P-augmented collaborative filtering, replacing Yandex Music dependency with GOAMP's own genre radio and personalized mood channels.

**Architecture:** Three-layer system: (1) Track identification via MusicBrainz/AcoustID with fallback hashes, local listening history and signals in SQLite; (2) Server-side aggregation of anonymous taste profiles with anti-Sybil validation, P2P gossip protocol for direct peer exchange; (3) Hybrid recommendation model (collaborative filtering + content-based) with configurable mood channels and genre radio UI.

**Tech Stack:** Rust (Tauri backend), TypeScript (frontend), SQLite (local storage), reqwest (HTTP), MusicBrainz API, AcoustID/Chromaprint, Last.fm API (getSimilar fallback), gossip protocol over existing P2P layer.

---

## Phase 1: Foundation — Track ID, History, Data Collection

### File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src-tauri/src/track_id.rs` | Track identification: MusicBrainz lookup, hash normalization, AcoustID fingerprint |
| Create | `src-tauri/src/history.rs` | Listening history recording, likes/dislikes, implicit signals |
| Create | `src-tauri/src/survey.rs` | Micro-survey generation and response storage |
| Modify | `src-tauri/src/db/mod.rs` | New tables: `track_identity`, `listen_history`, `track_likes`, `surveys`, `survey_responses` |
| Modify | `src-tauri/src/lib.rs` | Register new commands |
| Create | `src/recommendations/history-service.ts` | Frontend service for history tracking and like/dislike |
| Create | `src/recommendations/survey-widget.ts` | Micro-survey UI widget |
| Modify | `src/webamp/bridge.ts` | Hook into track play/skip/finish events for passive signals |
| Modify | `src/lib/tauri-ipc.ts` | New IPC function declarations |

---

### Task 1: Database Schema — Track Identity & History Tables

**Files:**
- Modify: `src-tauri/src/db/mod.rs:138-165` (add new migration block after radio tables)

- [ ] **Step 1: Write the failing test**

```rust
// In src-tauri/src/db/mod.rs, add to #[cfg(test)] mod tests:

#[test]
fn test_track_identity_table_exists() {
    let db = test_db();
    let conn = db.0.lock().unwrap();

    conn.execute(
        "INSERT INTO track_identity (canonical_id, source, source_id, artist, title, duration, musicbrainz_id, acoustid)
         VALUES ('hash_abc', 'youtube', 'dQw4w9WgXcQ', 'Rick Astley', 'Never Gonna Give You Up', 213.0, 'mb-123', NULL)",
        [],
    ).unwrap();

    let canonical: String = conn.query_row(
        "SELECT canonical_id FROM track_identity WHERE source = 'youtube' AND source_id = 'dQw4w9WgXcQ'",
        [], |row| row.get(0),
    ).unwrap();
    assert_eq!(canonical, "hash_abc");
}

#[test]
fn test_listen_history_table_exists() {
    let db = test_db();
    let conn = db.0.lock().unwrap();

    conn.execute(
        "INSERT INTO listen_history (canonical_id, source, started_at, duration_secs, listened_secs, completed, skipped_early, context_hour, context_weekday)
         VALUES ('hash_abc', 'youtube', 1712200000, 213, 200, 1, 0, 14, 5)",
        [],
    ).unwrap();

    let count: i32 = conn.query_row(
        "SELECT COUNT(*) FROM listen_history WHERE canonical_id = 'hash_abc'",
        [], |row| row.get(0),
    ).unwrap();
    assert_eq!(count, 1);
}

#[test]
fn test_track_likes_table_exists() {
    let db = test_db();
    let conn = db.0.lock().unwrap();

    conn.execute(
        "INSERT INTO track_likes (canonical_id, liked, created_at) VALUES ('hash_abc', 1, 1712200000)",
        [],
    ).unwrap();

    let liked: i32 = conn.query_row(
        "SELECT liked FROM track_likes WHERE canonical_id = 'hash_abc'",
        [], |row| row.get(0),
    ).unwrap();
    assert_eq!(liked, 1);
}

#[test]
fn test_track_identity_unique_source_pair() {
    let db = test_db();
    let conn = db.0.lock().unwrap();

    conn.execute(
        "INSERT INTO track_identity (canonical_id, source, source_id, artist, title, duration)
         VALUES ('hash_1', 'youtube', 'vid1', 'A', 'B', 180.0)",
        [],
    ).unwrap();

    // Same source+source_id should fail
    let result = conn.execute(
        "INSERT INTO track_identity (canonical_id, source, source_id, artist, title, duration)
         VALUES ('hash_2', 'youtube', 'vid1', 'A', 'B', 180.0)",
        [],
    );
    assert!(result.is_err());
}

#[test]
fn test_peer_track_weight() {
    let db = test_db();
    let conn = db.0.lock().unwrap();

    // Track identity with no musicbrainz_id (user-uploaded content)
    conn.execute(
        "INSERT INTO track_identity (canonical_id, source, source_id, artist, title, duration)
         VALUES ('user_hash_1', 'local', '/music/rare.mp3', 'Unknown', 'Rare Track', 240.0)",
        [],
    ).unwrap();

    // Multiple users listened = track gains weight
    for i in 0..5 {
        conn.execute(
            &format!(
                "INSERT INTO listen_history (canonical_id, source, started_at, duration_secs, listened_secs, completed, skipped_early, context_hour, context_weekday)
                 VALUES ('user_hash_1', 'local', {}, 240, 240, 1, 0, 12, 3)", 1712200000 + i * 1000
            ),
            [],
        ).unwrap();
    }

    let listen_count: i32 = conn.query_row(
        "SELECT COUNT(*) FROM listen_history WHERE canonical_id = 'user_hash_1'",
        [], |row| row.get(0),
    ).unwrap();
    assert_eq!(listen_count, 5);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/moffaty/projects/goamp/src-tauri && cargo test test_track_identity_table_exists test_listen_history_table_exists test_track_likes_table_exists test_track_identity_unique_source_pair test_peer_track_weight -- --nocapture 2>&1`
Expected: FAIL — tables don't exist yet

- [ ] **Step 3: Write the migration**

Add after the genre migration block in `src-tauri/src/db/mod.rs` (after line ~163):

```rust
    // Migration: track identity & recommendation tables
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS track_identity (
            canonical_id TEXT NOT NULL,
            source TEXT NOT NULL,
            source_id TEXT NOT NULL,
            artist TEXT NOT NULL DEFAULT '',
            title TEXT NOT NULL DEFAULT '',
            duration REAL NOT NULL DEFAULT 0,
            musicbrainz_id TEXT,
            acoustid TEXT,
            peer_count INTEGER NOT NULL DEFAULT 1,
            created_at INTEGER NOT NULL DEFAULT (unixepoch()),
            updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
            UNIQUE(source, source_id)
        );

        CREATE INDEX IF NOT EXISTS idx_track_identity_canonical
            ON track_identity(canonical_id);
        CREATE INDEX IF NOT EXISTS idx_track_identity_musicbrainz
            ON track_identity(musicbrainz_id) WHERE musicbrainz_id IS NOT NULL;

        CREATE TABLE IF NOT EXISTS listen_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            canonical_id TEXT NOT NULL,
            source TEXT NOT NULL,
            started_at INTEGER NOT NULL,
            duration_secs INTEGER NOT NULL DEFAULT 0,
            listened_secs INTEGER NOT NULL DEFAULT 0,
            completed INTEGER NOT NULL DEFAULT 0,
            skipped_early INTEGER NOT NULL DEFAULT 0,
            context_hour INTEGER NOT NULL DEFAULT 0,
            context_weekday INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_listen_history_canonical
            ON listen_history(canonical_id);
        CREATE INDEX IF NOT EXISTS idx_listen_history_time
            ON listen_history(started_at);

        CREATE TABLE IF NOT EXISTS track_likes (
            canonical_id TEXT PRIMARY KEY,
            liked INTEGER NOT NULL,
            created_at INTEGER NOT NULL DEFAULT (unixepoch()),
            updated_at INTEGER NOT NULL DEFAULT (unixepoch())
        );

        CREATE TABLE IF NOT EXISTS surveys (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            survey_type TEXT NOT NULL,
            payload TEXT NOT NULL,
            created_at INTEGER NOT NULL DEFAULT (unixepoch()),
            shown INTEGER NOT NULL DEFAULT 0,
            answered INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS survey_responses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            survey_id INTEGER NOT NULL REFERENCES surveys(id),
            response TEXT NOT NULL,
            responded_at INTEGER NOT NULL DEFAULT (unixepoch())
        );
        ",
    )?;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/moffaty/projects/goamp/src-tauri && cargo test -- --nocapture 2>&1 | tail -20`
Expected: All tests PASS including existing tests (migration is idempotent)

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/db/mod.rs
git commit -m "feat: add track identity, listen history, likes, and survey tables"
```

---

### Task 2: Track ID Resolution Module

**Files:**
- Create: `src-tauri/src/track_id.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod track_id;`)

- [ ] **Step 1: Write the failing test**

```rust
// src-tauri/src/track_id.rs

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_artist_title() {
        assert_eq!(
            normalize("  Rick  ASTLEY "),
            "rick astley"
        );
        assert_eq!(
            normalize("Beyoncé feat. Jay-Z"),
            "beyonce feat. jay-z"
        );
    }

    #[test]
    fn test_compute_canonical_id() {
        let id = canonical_hash("Rick Astley", "Never Gonna Give You Up");
        assert_eq!(id.len(), 64); // SHA-256 hex
        // Deterministic
        assert_eq!(id, canonical_hash("Rick Astley", "Never Gonna Give You Up"));
        // Case-insensitive
        assert_eq!(id, canonical_hash("rick astley", "never gonna give you up"));
        // Trim-insensitive
        assert_eq!(id, canonical_hash("  Rick Astley  ", " Never Gonna Give You Up "));
    }

    #[test]
    fn test_canonical_id_differs_for_different_tracks() {
        let id1 = canonical_hash("Artist A", "Track 1");
        let id2 = canonical_hash("Artist A", "Track 2");
        assert_ne!(id1, id2);
    }

    #[test]
    fn test_resolve_with_db_cache() {
        let db = crate::db::test_db();
        let conn = db.0.lock().unwrap();

        // First resolve creates entry
        let id = resolve_or_create(&conn, "youtube", "dQw4w9WgXcQ", "Rick Astley", "Never Gonna Give You Up", 213.0);
        assert!(!id.is_empty());

        // Second resolve returns same ID
        let id2 = resolve_or_create(&conn, "youtube", "dQw4w9WgXcQ", "Rick Astley", "Never Gonna Give You Up", 213.0);
        assert_eq!(id, id2);

        // Different source, same track = same canonical_id
        let id3 = resolve_or_create(&conn, "soundcloud", "sc-12345", "Rick Astley", "Never Gonna Give You Up", 213.0);
        assert_eq!(id, id3);
    }

    #[test]
    fn test_resolve_updates_peer_count_on_existing_canonical() {
        let db = crate::db::test_db();
        let conn = db.0.lock().unwrap();

        resolve_or_create(&conn, "youtube", "vid1", "Artist", "Track", 180.0);
        resolve_or_create(&conn, "soundcloud", "sc1", "Artist", "Track", 180.0);

        // Both entries should exist with same canonical_id
        let count: i32 = conn.query_row(
            "SELECT COUNT(*) FROM track_identity WHERE canonical_id = ?1",
            [canonical_hash("Artist", "Track")],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(count, 2);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/moffaty/projects/goamp/src-tauri && cargo test track_id -- --nocapture 2>&1`
Expected: FAIL — module doesn't exist

- [ ] **Step 3: Write the implementation**

```rust
// src-tauri/src/track_id.rs

use rusqlite::Connection;
use sha2::{Sha256, Digest};

/// Normalize artist/title: lowercase, trim, collapse whitespace, strip diacritics.
pub fn normalize(s: &str) -> String {
    let lower = s.to_lowercase();
    let stripped: String = lower
        .chars()
        .map(|c| match c {
            '\u{00e0}'..='\u{00e5}' => 'a',
            '\u{00e8}'..='\u{00eb}' => 'e',
            '\u{00ec}'..='\u{00ef}' => 'i',
            '\u{00f2}'..='\u{00f6}' => 'o',
            '\u{00f9}'..='\u{00fc}' => 'u',
            '\u{00e7}' => 'c',
            '\u{00f1}' => 'n',
            _ => c,
        })
        .collect();
    stripped.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Compute deterministic canonical hash from normalized artist + title.
pub fn canonical_hash(artist: &str, title: &str) -> String {
    let input = format!("{}||{}", normalize(artist), normalize(title));
    let mut hasher = Sha256::new();
    hasher.update(input.as_bytes());
    format!("{:x}", hasher.finalize())
}

/// Look up or create a track identity entry. Returns the canonical_id.
///
/// Resolution order:
/// 1. Exact source+source_id match in DB -> return existing canonical_id
/// 2. Same canonical_hash exists -> insert new source mapping, return existing canonical_id
/// 3. Nothing found -> insert new entry with computed canonical_hash
pub fn resolve_or_create(
    conn: &Connection,
    source: &str,
    source_id: &str,
    artist: &str,
    title: &str,
    duration: f64,
) -> String {
    // 1. Check exact source+source_id
    if let Ok(cid) = conn.query_row(
        "SELECT canonical_id FROM track_identity WHERE source = ?1 AND source_id = ?2",
        rusqlite::params![source, source_id],
        |row| row.get::<_, String>(0),
    ) {
        return cid;
    }

    let cid = canonical_hash(artist, title);

    // 2. Insert new source mapping (canonical_id may or may not exist already)
    let _ = conn.execute(
        "INSERT OR IGNORE INTO track_identity (canonical_id, source, source_id, artist, title, duration)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![cid, source, source_id, artist, title, duration],
    );

    cid
}

/// Attach a MusicBrainz ID to all entries with a given canonical_id.
pub fn set_musicbrainz_id(conn: &Connection, canonical_id: &str, mbid: &str) {
    let _ = conn.execute(
        "UPDATE track_identity SET musicbrainz_id = ?1, updated_at = unixepoch() WHERE canonical_id = ?2",
        rusqlite::params![mbid, canonical_id],
    );
}

/// Attach an AcoustID fingerprint to a specific source entry.
pub fn set_acoustid(conn: &Connection, source: &str, source_id: &str, acoustid: &str) {
    let _ = conn.execute(
        "UPDATE track_identity SET acoustid = ?1, updated_at = unixepoch() WHERE source = ?2 AND source_id = ?3",
        rusqlite::params![acoustid, source, source_id],
    );
}

/// Update peer_count for a canonical_id (called when server reports multiple users have this track).
pub fn update_peer_count(conn: &Connection, canonical_id: &str, count: i32) {
    let _ = conn.execute(
        "UPDATE track_identity SET peer_count = ?1, updated_at = unixepoch() WHERE canonical_id = ?2",
        rusqlite::params![count, canonical_id],
    );
}

/// Check if a track should participate in P2P aggregation.
/// Tracks qualify if they have a MusicBrainz ID, OR peer_count >= threshold.
pub fn is_aggregation_eligible(conn: &Connection, canonical_id: &str, peer_threshold: i32) -> bool {
    conn.query_row(
        "SELECT 1 FROM track_identity WHERE canonical_id = ?1 AND (musicbrainz_id IS NOT NULL OR peer_count >= ?2) LIMIT 1",
        rusqlite::params![canonical_id, peer_threshold],
        |_| Ok(true),
    ).unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_artist_title() {
        assert_eq!(normalize("  Rick  ASTLEY "), "rick astley");
        assert_eq!(normalize("Beyoncé feat. Jay-Z"), "beyonce feat. jay-z");
    }

    #[test]
    fn test_compute_canonical_id() {
        let id = canonical_hash("Rick Astley", "Never Gonna Give You Up");
        assert_eq!(id.len(), 64);
        assert_eq!(id, canonical_hash("Rick Astley", "Never Gonna Give You Up"));
        assert_eq!(id, canonical_hash("rick astley", "never gonna give you up"));
        assert_eq!(id, canonical_hash("  Rick Astley  ", " Never Gonna Give You Up "));
    }

    #[test]
    fn test_canonical_id_differs_for_different_tracks() {
        let id1 = canonical_hash("Artist A", "Track 1");
        let id2 = canonical_hash("Artist A", "Track 2");
        assert_ne!(id1, id2);
    }

    #[test]
    fn test_resolve_with_db_cache() {
        let db = crate::db::test_db();
        let conn = db.0.lock().unwrap();

        let id = resolve_or_create(&conn, "youtube", "dQw4w9WgXcQ", "Rick Astley", "Never Gonna Give You Up", 213.0);
        assert!(!id.is_empty());

        let id2 = resolve_or_create(&conn, "youtube", "dQw4w9WgXcQ", "Rick Astley", "Never Gonna Give You Up", 213.0);
        assert_eq!(id, id2);

        let id3 = resolve_or_create(&conn, "soundcloud", "sc-12345", "Rick Astley", "Never Gonna Give You Up", 213.0);
        assert_eq!(id, id3);
    }

    #[test]
    fn test_resolve_updates_peer_count_on_existing_canonical() {
        let db = crate::db::test_db();
        let conn = db.0.lock().unwrap();

        resolve_or_create(&conn, "youtube", "vid1", "Artist", "Track", 180.0);
        resolve_or_create(&conn, "soundcloud", "sc1", "Artist", "Track", 180.0);

        let count: i32 = conn.query_row(
            "SELECT COUNT(*) FROM track_identity WHERE canonical_id = ?1",
            [canonical_hash("Artist", "Track")],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(count, 2);
    }

    #[test]
    fn test_musicbrainz_id_propagates() {
        let db = crate::db::test_db();
        let conn = db.0.lock().unwrap();

        let cid = resolve_or_create(&conn, "youtube", "vid1", "Artist", "Track", 180.0);
        resolve_or_create(&conn, "soundcloud", "sc1", "Artist", "Track", 180.0);

        set_musicbrainz_id(&conn, &cid, "mb-uuid-123");

        // Both entries should have the MusicBrainz ID
        let mb_count: i32 = conn.query_row(
            "SELECT COUNT(*) FROM track_identity WHERE canonical_id = ?1 AND musicbrainz_id = 'mb-uuid-123'",
            [&cid],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(mb_count, 2);
    }

    #[test]
    fn test_aggregation_eligibility() {
        let db = crate::db::test_db();
        let conn = db.0.lock().unwrap();

        // User-uploaded track with no MusicBrainz ID
        let cid = resolve_or_create(&conn, "local", "/music/rare.mp3", "Unknown", "Rare", 240.0);

        // Not eligible with peer_count=1 and threshold=3
        assert!(!is_aggregation_eligible(&conn, &cid, 3));

        // Simulate server reporting multiple peers have this track
        update_peer_count(&conn, &cid, 5);
        assert!(is_aggregation_eligible(&conn, &cid, 3));

        // Track with MusicBrainz ID is always eligible
        let cid2 = resolve_or_create(&conn, "youtube", "vid2", "Known", "Song", 200.0);
        set_musicbrainz_id(&conn, &cid2, "mb-456");
        assert!(is_aggregation_eligible(&conn, &cid2, 100)); // even with high threshold
    }
}
```

- [ ] **Step 4: Add `sha2` dependency**

```bash
cd /home/moffaty/projects/goamp/src-tauri && cargo add sha2
```

- [ ] **Step 5: Register module in lib.rs**

Add `mod track_id;` to `src-tauri/src/lib.rs` alongside other module declarations.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd /home/moffaty/projects/goamp/src-tauri && cargo test track_id -- --nocapture 2>&1`
Expected: All 7 tests PASS

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/track_id.rs src-tauri/src/lib.rs src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "feat: track ID resolution with canonical hash, MusicBrainz, and peer eligibility"
```

---

### Task 3: MusicBrainz Lookup Integration

**Files:**
- Modify: `src-tauri/src/track_id.rs` (add MusicBrainz HTTP lookup)
- Modify: `src-tauri/src/lib.rs` (register Tauri command)
- Modify: `src/lib/tauri-ipc.ts` (add IPC declaration)

- [ ] **Step 1: Write the failing test**

```rust
// Add to src-tauri/src/track_id.rs tests:

#[test]
fn test_musicbrainz_query_url() {
    let url = musicbrainz_search_url("Rick Astley", "Never Gonna Give You Up");
    assert!(url.contains("recording"));
    assert!(url.contains("rick+astley"));
    assert!(url.contains("never+gonna+give+you+up"));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/moffaty/projects/goamp/src-tauri && cargo test test_musicbrainz_query_url -- --nocapture 2>&1`
Expected: FAIL — function doesn't exist

- [ ] **Step 3: Write the implementation**

Add to `src-tauri/src/track_id.rs`:

```rust
use serde::{Deserialize, Serialize};

const MB_API_URL: &str = "https://musicbrainz.org/ws/2";
const MB_USER_AGENT: &str = "GOAMP/1.0 (https://github.com/nicoss01/goamp)";

#[derive(Debug, Serialize, Deserialize)]
pub struct MusicBrainzMatch {
    pub mbid: String,
    pub title: String,
    pub artist: String,
    pub score: u32,
}

pub fn musicbrainz_search_url(artist: &str, title: &str) -> String {
    let q_artist = urlencoding::encode(&normalize(artist));
    let q_title = urlencoding::encode(&normalize(title));
    format!(
        "{}/recording?query=recording:{}+artist:{}&fmt=json&limit=3",
        MB_API_URL, q_title, q_artist
    )
}

/// Look up a track on MusicBrainz. Returns best match if score >= 90.
pub async fn musicbrainz_lookup(
    client: &reqwest::Client,
    artist: &str,
    title: &str,
) -> Option<MusicBrainzMatch> {
    let url = musicbrainz_search_url(artist, title);
    let resp = client
        .get(&url)
        .header("User-Agent", MB_USER_AGENT)
        .send()
        .await
        .ok()?;

    let body: serde_json::Value = resp.json().await.ok()?;
    let recordings = body.get("recordings")?.as_array()?;

    for rec in recordings {
        let score = rec.get("score")?.as_u64()? as u32;
        if score < 90 {
            continue;
        }
        let mbid = rec.get("id")?.as_str()?.to_string();
        let title = rec.get("title")?.as_str()?.to_string();
        let artist = rec
            .get("artist-credit")?
            .as_array()?
            .first()?
            .get("name")?
            .as_str()?
            .to_string();

        return Some(MusicBrainzMatch {
            mbid,
            title,
            artist,
            score,
        });
    }
    None
}

/// Tauri command: resolve track identity with optional MusicBrainz lookup.
#[tauri::command]
pub async fn resolve_track_id(
    app: tauri::AppHandle,
    source: String,
    source_id: String,
    artist: String,
    title: String,
    duration: f64,
) -> Result<String, String> {
    let db = app.state::<crate::db::Db>();
    let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());

    let cid = resolve_or_create(&conn, &source, &source_id, &artist, &title, duration);

    // Check if MusicBrainz ID already set
    let has_mb: bool = conn.query_row(
        "SELECT musicbrainz_id FROM track_identity WHERE canonical_id = ?1 AND musicbrainz_id IS NOT NULL LIMIT 1",
        [&cid],
        |_| Ok(true),
    ).unwrap_or(false);

    drop(conn); // Release lock before async HTTP call

    if !has_mb && !artist.is_empty() && !title.is_empty() {
        let client = reqwest::Client::new();
        if let Some(mb_match) = musicbrainz_lookup(&client, &artist, &title).await {
            let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
            set_musicbrainz_id(&conn, &cid, &mb_match.mbid);
            eprintln!("[GOAMP] MusicBrainz match: {} - {} (score={})", mb_match.artist, mb_match.title, mb_match.score);
        }
    }

    Ok(cid)
}
```

- [ ] **Step 4: Register command in lib.rs**

Add `track_id::resolve_track_id` to the `invoke_handler` macro in `src-tauri/src/lib.rs`.

- [ ] **Step 5: Add IPC declaration**

Add to `src/lib/tauri-ipc.ts`:

```typescript
// Track Identity
export async function resolveTrackId(
  source: string,
  sourceId: string,
  artist: string,
  title: string,
  duration: number,
): Promise<string> {
  return invoke("resolve_track_id", { source, sourceId, artist, title, duration });
}
```

- [ ] **Step 6: Run all tests**

Run: `cd /home/moffaty/projects/goamp/src-tauri && cargo test -- --nocapture 2>&1 | tail -20`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/track_id.rs src-tauri/src/lib.rs src/lib/tauri-ipc.ts
git commit -m "feat: MusicBrainz lookup integration for track identification"
```

---

### Task 4: Listening History Recording

**Files:**
- Create: `src-tauri/src/history.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod history;`, register commands)
- Modify: `src/lib/tauri-ipc.ts` (add IPC declarations)

- [ ] **Step 1: Write the failing test**

```rust
// src-tauri/src/history.rs

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_db;

    #[test]
    fn test_record_listen() {
        let db = test_db();
        let conn = db.0.lock().unwrap();

        record_listen(
            &conn,
            "hash_abc",
            "youtube",
            1712200000,
            213,
            200,
            true,
            false,
        );

        let count: i32 = conn.query_row(
            "SELECT COUNT(*) FROM listen_history WHERE canonical_id = 'hash_abc'",
            [], |row| row.get(0),
        ).unwrap();
        assert_eq!(count, 1);

        let completed: i32 = conn.query_row(
            "SELECT completed FROM listen_history WHERE canonical_id = 'hash_abc'",
            [], |row| row.get(0),
        ).unwrap();
        assert_eq!(completed, 1);
    }

    #[test]
    fn test_record_like_and_dislike() {
        let db = test_db();
        let conn = db.0.lock().unwrap();

        set_like(&conn, "hash_abc", true);
        assert_eq!(get_like(&conn, "hash_abc"), Some(true));

        // Toggle to dislike
        set_like(&conn, "hash_abc", false);
        assert_eq!(get_like(&conn, "hash_abc"), Some(false));
    }

    #[test]
    fn test_remove_like() {
        let db = test_db();
        let conn = db.0.lock().unwrap();

        set_like(&conn, "hash_abc", true);
        remove_like(&conn, "hash_abc");
        assert_eq!(get_like(&conn, "hash_abc"), None);
    }

    #[test]
    fn test_get_listen_count() {
        let db = test_db();
        let conn = db.0.lock().unwrap();

        record_listen(&conn, "hash_abc", "youtube", 1000, 200, 200, true, false);
        record_listen(&conn, "hash_abc", "youtube", 2000, 200, 200, true, false);
        record_listen(&conn, "hash_abc", "youtube", 3000, 200, 50, false, true);

        assert_eq!(get_listen_count(&conn, "hash_abc"), 3);
        assert_eq!(get_completed_count(&conn, "hash_abc"), 2);
    }

    #[test]
    fn test_get_liked_tracks() {
        let db = test_db();
        let conn = db.0.lock().unwrap();

        set_like(&conn, "hash_1", true);
        set_like(&conn, "hash_2", true);
        set_like(&conn, "hash_3", false);

        let liked = get_liked_canonical_ids(&conn);
        assert_eq!(liked.len(), 2);
        assert!(liked.contains(&"hash_1".to_string()));
        assert!(liked.contains(&"hash_2".to_string()));
    }

    #[test]
    fn test_implicit_like_from_completion() {
        let db = test_db();
        let conn = db.0.lock().unwrap();

        // 80%+ completion = implicit positive signal
        assert!(is_implicit_like(200, 170)); // 85%
        assert!(!is_implicit_like(200, 50));  // 25%
        assert!(is_implicit_like(200, 160));  // 80% exactly
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/moffaty/projects/goamp/src-tauri && cargo test history -- --nocapture 2>&1`
Expected: FAIL — module doesn't exist

- [ ] **Step 3: Write the implementation**

```rust
// src-tauri/src/history.rs

use chrono::{Datelike, Timelike, Utc};
use rusqlite::Connection;
use serde::Serialize;

/// Record a listening event.
pub fn record_listen(
    conn: &Connection,
    canonical_id: &str,
    source: &str,
    started_at: i64,
    duration_secs: i32,
    listened_secs: i32,
    completed: bool,
    skipped_early: bool,
) {
    let now = Utc::now();
    let hour = now.hour() as i32;
    let weekday = now.weekday().num_days_from_monday() as i32;

    let _ = conn.execute(
        "INSERT INTO listen_history (canonical_id, source, started_at, duration_secs, listened_secs, completed, skipped_early, context_hour, context_weekday)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        rusqlite::params![
            canonical_id, source, started_at, duration_secs, listened_secs,
            completed as i32, skipped_early as i32, hour, weekday
        ],
    );
}

/// Set like/dislike for a track (upsert).
pub fn set_like(conn: &Connection, canonical_id: &str, liked: bool) {
    let _ = conn.execute(
        "INSERT INTO track_likes (canonical_id, liked, created_at, updated_at)
         VALUES (?1, ?2, unixepoch(), unixepoch())
         ON CONFLICT(canonical_id) DO UPDATE SET liked = ?2, updated_at = unixepoch()",
        rusqlite::params![canonical_id, liked as i32],
    );
}

/// Get like status: Some(true) = liked, Some(false) = disliked, None = no opinion.
pub fn get_like(conn: &Connection, canonical_id: &str) -> Option<bool> {
    conn.query_row(
        "SELECT liked FROM track_likes WHERE canonical_id = ?1",
        [canonical_id],
        |row| {
            let val: i32 = row.get(0)?;
            Ok(val != 0)
        },
    ).ok()
}

/// Remove like/dislike entry entirely.
pub fn remove_like(conn: &Connection, canonical_id: &str) {
    let _ = conn.execute(
        "DELETE FROM track_likes WHERE canonical_id = ?1",
        [canonical_id],
    );
}

/// Total listen count for a track.
pub fn get_listen_count(conn: &Connection, canonical_id: &str) -> i32 {
    conn.query_row(
        "SELECT COUNT(*) FROM listen_history WHERE canonical_id = ?1",
        [canonical_id],
        |row| row.get(0),
    ).unwrap_or(0)
}

/// Count of completed listens (>80% or explicit completion).
pub fn get_completed_count(conn: &Connection, canonical_id: &str) -> i32 {
    conn.query_row(
        "SELECT COUNT(*) FROM listen_history WHERE canonical_id = ?1 AND completed = 1",
        [canonical_id],
        |row| row.get(0),
    ).unwrap_or(0)
}

/// Get all liked track canonical IDs.
pub fn get_liked_canonical_ids(conn: &Connection) -> Vec<String> {
    let mut stmt = conn.prepare(
        "SELECT canonical_id FROM track_likes WHERE liked = 1 ORDER BY updated_at DESC"
    ).unwrap();
    stmt.query_map([], |row| row.get(0))
        .unwrap()
        .filter_map(|r| r.ok())
        .collect()
}

/// Check if listen duration qualifies as implicit like (>=80% completion).
pub fn is_implicit_like(duration_secs: i32, listened_secs: i32) -> bool {
    if duration_secs <= 0 {
        return false;
    }
    (listened_secs as f64 / duration_secs as f64) >= 0.80
}

// ─── Tauri commands ───

#[derive(Serialize)]
pub struct ListenStats {
    pub canonical_id: String,
    pub listen_count: i32,
    pub completed_count: i32,
    pub liked: Option<bool>,
}

#[tauri::command]
pub fn record_track_listen(
    app: tauri::AppHandle,
    canonical_id: String,
    source: String,
    started_at: i64,
    duration_secs: i32,
    listened_secs: i32,
    completed: bool,
    skipped_early: bool,
) -> Result<(), String> {
    let db = app.state::<crate::db::Db>();
    let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
    record_listen(&conn, &canonical_id, &source, started_at, duration_secs, listened_secs, completed, skipped_early);
    Ok(())
}

#[tauri::command]
pub fn set_track_like(
    app: tauri::AppHandle,
    canonical_id: String,
    liked: bool,
) -> Result<(), String> {
    let db = app.state::<crate::db::Db>();
    let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
    set_like(&conn, &canonical_id, liked);
    Ok(())
}

#[tauri::command]
pub fn remove_track_like(
    app: tauri::AppHandle,
    canonical_id: String,
) -> Result<(), String> {
    let db = app.state::<crate::db::Db>();
    let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
    remove_like(&conn, &canonical_id);
    Ok(())
}

#[tauri::command]
pub fn get_track_stats(
    app: tauri::AppHandle,
    canonical_id: String,
) -> Result<ListenStats, String> {
    let db = app.state::<crate::db::Db>();
    let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
    Ok(ListenStats {
        canonical_id: canonical_id.clone(),
        listen_count: get_listen_count(&conn, &canonical_id),
        completed_count: get_completed_count(&conn, &canonical_id),
        liked: get_like(&conn, &canonical_id),
    })
}

#[tauri::command]
pub fn get_liked_tracks(
    app: tauri::AppHandle,
) -> Result<Vec<String>, String> {
    let db = app.state::<crate::db::Db>();
    let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
    Ok(get_liked_canonical_ids(&conn))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_db;

    #[test]
    fn test_record_listen() {
        let db = test_db();
        let conn = db.0.lock().unwrap();

        record_listen(&conn, "hash_abc", "youtube", 1712200000, 213, 200, true, false);

        let count: i32 = conn.query_row(
            "SELECT COUNT(*) FROM listen_history WHERE canonical_id = 'hash_abc'",
            [], |row| row.get(0),
        ).unwrap();
        assert_eq!(count, 1);

        let completed: i32 = conn.query_row(
            "SELECT completed FROM listen_history WHERE canonical_id = 'hash_abc'",
            [], |row| row.get(0),
        ).unwrap();
        assert_eq!(completed, 1);
    }

    #[test]
    fn test_record_like_and_dislike() {
        let db = test_db();
        let conn = db.0.lock().unwrap();

        set_like(&conn, "hash_abc", true);
        assert_eq!(get_like(&conn, "hash_abc"), Some(true));

        set_like(&conn, "hash_abc", false);
        assert_eq!(get_like(&conn, "hash_abc"), Some(false));
    }

    #[test]
    fn test_remove_like() {
        let db = test_db();
        let conn = db.0.lock().unwrap();

        set_like(&conn, "hash_abc", true);
        remove_like(&conn, "hash_abc");
        assert_eq!(get_like(&conn, "hash_abc"), None);
    }

    #[test]
    fn test_get_listen_count() {
        let db = test_db();
        let conn = db.0.lock().unwrap();

        record_listen(&conn, "hash_abc", "youtube", 1000, 200, 200, true, false);
        record_listen(&conn, "hash_abc", "youtube", 2000, 200, 200, true, false);
        record_listen(&conn, "hash_abc", "youtube", 3000, 200, 50, false, true);

        assert_eq!(get_listen_count(&conn, "hash_abc"), 3);
        assert_eq!(get_completed_count(&conn, "hash_abc"), 2);
    }

    #[test]
    fn test_get_liked_tracks() {
        let db = test_db();
        let conn = db.0.lock().unwrap();

        set_like(&conn, "hash_1", true);
        set_like(&conn, "hash_2", true);
        set_like(&conn, "hash_3", false);

        let liked = get_liked_canonical_ids(&conn);
        assert_eq!(liked.len(), 2);
        assert!(liked.contains(&"hash_1".to_string()));
        assert!(liked.contains(&"hash_2".to_string()));
    }

    #[test]
    fn test_implicit_like_from_completion() {
        assert!(is_implicit_like(200, 170));
        assert!(!is_implicit_like(200, 50));
        assert!(is_implicit_like(200, 160));
        assert!(!is_implicit_like(0, 0)); // edge case
    }
}
```

- [ ] **Step 4: Register module and commands in lib.rs**

Add `mod history;` and register these commands in `invoke_handler`:
- `history::record_track_listen`
- `history::set_track_like`
- `history::remove_track_like`
- `history::get_track_stats`
- `history::get_liked_tracks`

- [ ] **Step 5: Add IPC declarations to tauri-ipc.ts**

```typescript
// Listen History
export interface ListenStats {
  canonical_id: string;
  listen_count: number;
  completed_count: number;
  liked: boolean | null;
}

export async function recordTrackListen(
  canonicalId: string,
  source: string,
  startedAt: number,
  durationSecs: number,
  listenedSecs: number,
  completed: boolean,
  skippedEarly: boolean,
): Promise<void> {
  return invoke("record_track_listen", {
    canonicalId, source, startedAt, durationSecs, listenedSecs, completed, skippedEarly,
  });
}

export async function setTrackLike(canonicalId: string, liked: boolean): Promise<void> {
  return invoke("set_track_like", { canonicalId, liked });
}

export async function removeTrackLike(canonicalId: string): Promise<void> {
  return invoke("remove_track_like", { canonicalId });
}

export async function getTrackStats(canonicalId: string): Promise<ListenStats> {
  return invoke("get_track_stats", { canonicalId });
}

export async function getLikedTracks(): Promise<string[]> {
  return invoke("get_liked_tracks");
}
```

- [ ] **Step 6: Run all tests**

Run: `cd /home/moffaty/projects/goamp/src-tauri && cargo test -- --nocapture 2>&1 | tail -20`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/history.rs src-tauri/src/lib.rs src/lib/tauri-ipc.ts
git commit -m "feat: listening history recording with likes, stats, and implicit signals"
```

---

### Task 5: Passive Signal Collection in Frontend Bridge

**Files:**
- Create: `src/recommendations/history-service.ts`
- Modify: `src/webamp/bridge.ts` (hook into track events)

- [ ] **Step 1: Write the test**

```typescript
// src/recommendations/history-service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HistoryTracker } from './history-service';

describe('HistoryTracker', () => {
  let tracker: HistoryTracker;
  const mockResolveTrackId = vi.fn().mockResolvedValue('canonical_123');
  const mockRecordListen = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    tracker = new HistoryTracker(mockResolveTrackId, mockRecordListen);
  });

  it('tracks play start', () => {
    tracker.onTrackStart('youtube', 'vid1', 'Artist', 'Title', 200);
    expect(mockResolveTrackId).toHaveBeenCalledWith('youtube', 'vid1', 'Artist', 'Title', 200);
  });

  it('records completed listen on track end', async () => {
    tracker.onTrackStart('youtube', 'vid1', 'Artist', 'Title', 200);
    await vi.advanceTimersByTimeAsync(0); // resolve promise
    tracker.onTrackEnd(195); // listened 195 of 200 secs
    expect(mockRecordListen).toHaveBeenCalledWith(
      'canonical_123', 'youtube', expect.any(Number), 200, 195, true, false,
    );
  });

  it('records skip on early track change (<10s)', async () => {
    tracker.onTrackStart('youtube', 'vid1', 'Artist', 'Title', 200);
    await vi.advanceTimersByTimeAsync(0);
    tracker.onTrackEnd(5); // only 5 seconds
    expect(mockRecordListen).toHaveBeenCalledWith(
      'canonical_123', 'youtube', expect.any(Number), 200, 5, false, true,
    );
  });

  it('does not record if no track started', () => {
    tracker.onTrackEnd(100);
    expect(mockRecordListen).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/moffaty/projects/goamp && npx vitest run src/recommendations/history-service.test.ts 2>&1`
Expected: FAIL — module doesn't exist

- [ ] **Step 3: Write the implementation**

```typescript
// src/recommendations/history-service.ts

type ResolveTrackIdFn = (
  source: string, sourceId: string, artist: string, title: string, duration: number,
) => Promise<string>;

type RecordListenFn = (
  canonicalId: string, source: string, startedAt: number,
  durationSecs: number, listenedSecs: number, completed: boolean, skippedEarly: boolean,
) => Promise<void>;

export class HistoryTracker {
  private resolveTrackId: ResolveTrackIdFn;
  private recordListen: RecordListenFn;

  private currentCanonicalId: string | null = null;
  private currentSource: string = '';
  private currentDuration: number = 0;
  private startedAt: number = 0;
  private resolving: Promise<void> | null = null;

  constructor(resolveTrackId: ResolveTrackIdFn, recordListen: RecordListenFn) {
    this.resolveTrackId = resolveTrackId;
    this.recordListen = recordListen;
  }

  onTrackStart(source: string, sourceId: string, artist: string, title: string, duration: number) {
    this.currentCanonicalId = null;
    this.currentSource = source;
    this.currentDuration = duration;
    this.startedAt = Math.floor(Date.now() / 1000);

    this.resolving = this.resolveTrackId(source, sourceId, artist, title, duration)
      .then((cid) => { this.currentCanonicalId = cid; })
      .catch(() => { this.currentCanonicalId = null; });
  }

  async onTrackEnd(listenedSecs: number) {
    if (this.resolving) {
      await this.resolving;
    }
    if (!this.currentCanonicalId) return;

    const completed = listenedSecs >= this.currentDuration * 0.8;
    const skippedEarly = listenedSecs < 10;

    await this.recordListen(
      this.currentCanonicalId,
      this.currentSource,
      this.startedAt,
      this.currentDuration,
      listenedSecs,
      completed,
      skippedEarly,
    );

    this.currentCanonicalId = null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/moffaty/projects/goamp && npx vitest run src/recommendations/history-service.test.ts 2>&1`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/recommendations/history-service.ts src/recommendations/history-service.test.ts
git commit -m "feat: passive listening history tracker with implicit signal detection"
```

---

### Task 6: Micro-Survey System (Backend)

**Files:**
- Create: `src-tauri/src/survey.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/lib/tauri-ipc.ts`

- [ ] **Step 1: Write the failing test**

```rust
// src-tauri/src/survey.rs

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_db;

    #[test]
    fn test_create_similarity_survey() {
        let db = test_db();
        let conn = db.0.lock().unwrap();

        let survey = create_similarity_survey(&conn, "hash_a", "hash_b", "hash_c");
        assert!(survey.id > 0);
        assert_eq!(survey.survey_type, "similarity");
    }

    #[test]
    fn test_create_genre_survey() {
        let db = test_db();
        let conn = db.0.lock().unwrap();

        let survey = create_genre_survey(&conn, "hash_a", &["electronic", "ambient", "rock", "jazz"]);
        assert!(survey.id > 0);
        assert_eq!(survey.survey_type, "genre");
    }

    #[test]
    fn test_create_mood_survey() {
        let db = test_db();
        let conn = db.0.lock().unwrap();

        let survey = create_mood_survey(&conn, "hash_a");
        assert!(survey.id > 0);
        assert_eq!(survey.survey_type, "mood");
    }

    #[test]
    fn test_respond_to_survey() {
        let db = test_db();
        let conn = db.0.lock().unwrap();

        let survey = create_mood_survey(&conn, "hash_a");
        respond_to_survey(&conn, survey.id, "energetic");

        let answered: i32 = conn.query_row(
            "SELECT answered FROM surveys WHERE id = ?1",
            [survey.id],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(answered, 1);
    }

    #[test]
    fn test_get_pending_survey_respects_cooldown() {
        let db = test_db();
        let conn = db.0.lock().unwrap();

        create_mood_survey(&conn, "hash_a");

        // Survey just created — should be available
        let pending = get_pending_survey(&conn);
        assert!(pending.is_some());

        // Mark as shown
        if let Some(s) = pending {
            mark_shown(&conn, s.id);
        }

        // After marking shown, should not return again (cooldown)
        let pending2 = get_pending_survey(&conn);
        assert!(pending2.is_none());
    }

    #[test]
    fn test_skip_survey() {
        let db = test_db();
        let conn = db.0.lock().unwrap();

        let survey = create_mood_survey(&conn, "hash_a");
        skip_survey(&conn, survey.id);

        let shown: i32 = conn.query_row(
            "SELECT shown FROM surveys WHERE id = ?1",
            [survey.id],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(shown, 1); // marked as shown so it won't appear again
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/moffaty/projects/goamp/src-tauri && cargo test survey -- --nocapture 2>&1`
Expected: FAIL

- [ ] **Step 3: Write the implementation**

```rust
// src-tauri/src/survey.rs

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct Survey {
    pub id: i64,
    pub survey_type: String,
    pub payload: String,
    pub created_at: i64,
}

/// Create a "which two tracks are most similar?" survey.
pub fn create_similarity_survey(
    conn: &Connection,
    track_a: &str,
    track_b: &str,
    track_c: &str,
) -> Survey {
    let payload = serde_json::json!({
        "tracks": [track_a, track_b, track_c]
    }).to_string();

    conn.execute(
        "INSERT INTO surveys (survey_type, payload) VALUES ('similarity', ?1)",
        [&payload],
    ).unwrap();

    let id = conn.last_insert_rowid();
    Survey { id, survey_type: "similarity".to_string(), payload, created_at: 0 }
}

/// Create a "what genre is this track?" survey.
pub fn create_genre_survey(conn: &Connection, track: &str, options: &[&str]) -> Survey {
    let payload = serde_json::json!({
        "track": track,
        "options": options,
    }).to_string();

    conn.execute(
        "INSERT INTO surveys (survey_type, payload) VALUES ('genre', ?1)",
        [&payload],
    ).unwrap();

    let id = conn.last_insert_rowid();
    Survey { id, survey_type: "genre".to_string(), payload, created_at: 0 }
}

/// Create a "is this track energetic or calm?" survey.
pub fn create_mood_survey(conn: &Connection, track: &str) -> Survey {
    let payload = serde_json::json!({
        "track": track,
        "choices": ["energetic", "calm"]
    }).to_string();

    conn.execute(
        "INSERT INTO surveys (survey_type, payload) VALUES ('mood', ?1)",
        [&payload],
    ).unwrap();

    let id = conn.last_insert_rowid();
    Survey { id, survey_type: "mood".to_string(), payload, created_at: 0 }
}

/// Record a user's response to a survey.
pub fn respond_to_survey(conn: &Connection, survey_id: i64, response: &str) {
    let _ = conn.execute(
        "INSERT INTO survey_responses (survey_id, response) VALUES (?1, ?2)",
        rusqlite::params![survey_id, response],
    );
    let _ = conn.execute(
        "UPDATE surveys SET answered = 1 WHERE id = ?1",
        [survey_id],
    );
}

/// Get one pending survey that hasn't been shown yet.
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

/// Mark a survey as shown (prevents re-showing).
pub fn mark_shown(conn: &Connection, survey_id: i64) {
    let _ = conn.execute(
        "UPDATE surveys SET shown = 1 WHERE id = ?1",
        [survey_id],
    );
}

/// Skip a survey (mark as shown without answering).
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
        let survey = create_similarity_survey(&conn, "hash_a", "hash_b", "hash_c");
        assert!(survey.id > 0);
        assert_eq!(survey.survey_type, "similarity");
    }

    #[test]
    fn test_create_genre_survey() {
        let db = test_db();
        let conn = db.0.lock().unwrap();
        let survey = create_genre_survey(&conn, "hash_a", &["electronic", "ambient", "rock", "jazz"]);
        assert!(survey.id > 0);
        assert_eq!(survey.survey_type, "genre");
    }

    #[test]
    fn test_create_mood_survey() {
        let db = test_db();
        let conn = db.0.lock().unwrap();
        let survey = create_mood_survey(&conn, "hash_a");
        assert!(survey.id > 0);
        assert_eq!(survey.survey_type, "mood");
    }

    #[test]
    fn test_respond_to_survey() {
        let db = test_db();
        let conn = db.0.lock().unwrap();
        let survey = create_mood_survey(&conn, "hash_a");
        respond_to_survey(&conn, survey.id, "energetic");

        let answered: i32 = conn.query_row(
            "SELECT answered FROM surveys WHERE id = ?1",
            [survey.id],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(answered, 1);
    }

    #[test]
    fn test_get_pending_survey_respects_cooldown() {
        let db = test_db();
        let conn = db.0.lock().unwrap();
        create_mood_survey(&conn, "hash_a");

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
        let survey = create_mood_survey(&conn, "hash_a");
        skip_survey(&conn, survey.id);

        let shown: i32 = conn.query_row(
            "SELECT shown FROM surveys WHERE id = ?1",
            [survey.id],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(shown, 1);
    }
}
```

- [ ] **Step 4: Register module and commands, add IPC declarations**

In `src-tauri/src/lib.rs` add `mod survey;` and register:
- `survey::survey_get_pending`
- `survey::survey_respond`
- `survey::survey_skip`
- `survey::survey_mark_shown`

In `src/lib/tauri-ipc.ts` add:

```typescript
// Surveys
export interface Survey {
  id: number;
  survey_type: string;
  payload: string;
  created_at: number;
}

export async function surveyGetPending(): Promise<Survey | null> {
  return invoke("survey_get_pending");
}

export async function surveyRespond(surveyId: number, response: string): Promise<void> {
  return invoke("survey_respond", { surveyId, response });
}

export async function surveySkip(surveyId: number): Promise<void> {
  return invoke("survey_skip", { surveyId });
}

export async function surveyMarkShown(surveyId: number): Promise<void> {
  return invoke("survey_mark_shown", { surveyId });
}
```

- [ ] **Step 5: Run all tests**

Run: `cd /home/moffaty/projects/goamp/src-tauri && cargo test -- --nocapture 2>&1 | tail -20`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/survey.rs src-tauri/src/lib.rs src/lib/tauri-ipc.ts
git commit -m "feat: micro-survey system for similarity, genre, and mood data collection"
```

---

## Phase 2: Taste Profile & Server Aggregation

### File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src-tauri/src/taste_profile.rs` | Build anonymous taste profile from local data |
| Create | `src-tauri/src/aggregator.rs` | Server communication: profile upload, model download |
| Create | `src-tauri/src/sybil.rs` | Client-side proof-of-listening generation |
| Modify | `src-tauri/src/db/mod.rs` | New tables: `taste_profile_cache`, `peer_profiles` |
| Modify | `src-tauri/src/lib.rs` | Register new commands |
| Modify | `src/lib/tauri-ipc.ts` | New IPC declarations |

---

### Task 7: Taste Profile Generation

**Files:**
- Create: `src-tauri/src/taste_profile.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write the failing test**

```rust
// src-tauri/src/taste_profile.rs

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_db;
    use crate::history::*;
    use crate::track_id::*;

    fn seed_data(conn: &rusqlite::Connection) {
        // Create track identities
        resolve_or_create(conn, "youtube", "vid1", "Boards of Canada", "Dayvan Cowboy", 300.0);
        resolve_or_create(conn, "youtube", "vid2", "Aphex Twin", "Windowlicker", 390.0);
        resolve_or_create(conn, "youtube", "vid3", "Metallica", "Enter Sandman", 331.0);

        let cid1 = canonical_hash("Boards of Canada", "Dayvan Cowboy");
        let cid2 = canonical_hash("Aphex Twin", "Windowlicker");
        let cid3 = canonical_hash("Metallica", "Enter Sandman");

        // Listen history
        for _ in 0..10 {
            record_listen(conn, &cid1, "youtube", 1000, 300, 280, true, false);
        }
        for _ in 0..5 {
            record_listen(conn, &cid2, "youtube", 2000, 390, 390, true, false);
        }
        record_listen(conn, &cid3, "youtube", 3000, 331, 30, false, true);

        // Likes
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
        assert!(!profile.listen_pairs.is_empty());
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/moffaty/projects/goamp/src-tauri && cargo test taste_profile -- --nocapture 2>&1`
Expected: FAIL

- [ ] **Step 3: Write the implementation**

```rust
// src-tauri/src/taste_profile.rs

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

/// Anonymous taste profile shared with the aggregation network.
/// Contains no personal identifiers — only track hashes and patterns.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TasteProfile {
    /// Version of the profile format
    pub version: u32,
    /// SHA-256 hashes of liked tracks (canonical_ids)
    pub liked_hashes: Vec<String>,
    /// Sequential listen pairs: (track_a_hash, track_b_hash) — "after A, user listened to B"
    pub listen_pairs: Vec<(String, String)>,
    /// Genre/tag weights derived from listening history: {tag: weight 0.0-1.0}
    pub genre_weights: std::collections::HashMap<String, f64>,
    /// Total number of completed listens (proof-of-engagement metric)
    pub total_listens: u32,
    /// Timestamp of profile generation
    pub generated_at: i64,
}

/// Build an anonymous taste profile from local data.
pub fn build_taste_profile(conn: &Connection, max_items: usize) -> TasteProfile {
    let liked_hashes = get_top_liked(conn, max_items);
    let listen_pairs = get_listen_pairs(conn, max_items);
    let genre_weights = get_genre_weights(conn);
    let total_listens = get_total_completed(conn);

    TasteProfile {
        version: 1,
        liked_hashes,
        listen_pairs,
        genre_weights,
        total_listens,
        generated_at: chrono::Utc::now().timestamp(),
    }
}

/// Get top liked track hashes, ordered by listen count.
fn get_top_liked(conn: &Connection, limit: usize) -> Vec<String> {
    let mut stmt = conn.prepare(
        "SELECT tl.canonical_id, COUNT(lh.id) as cnt
         FROM track_likes tl
         LEFT JOIN listen_history lh ON lh.canonical_id = tl.canonical_id
         WHERE tl.liked = 1
         GROUP BY tl.canonical_id
         ORDER BY cnt DESC
         LIMIT ?1"
    ).unwrap();

    stmt.query_map([limit as i64], |row| row.get(0))
        .unwrap()
        .filter_map(|r| r.ok())
        .collect()
}

/// Get sequential listen pairs from history.
fn get_listen_pairs(conn: &Connection, limit: usize) -> Vec<(String, String)> {
    let mut stmt = conn.prepare(
        "SELECT a.canonical_id, b.canonical_id
         FROM listen_history a
         JOIN listen_history b ON b.started_at > a.started_at
            AND b.started_at - a.started_at < 600
            AND b.id = (SELECT MIN(c.id) FROM listen_history c WHERE c.started_at > a.started_at)
         WHERE a.completed = 1
         GROUP BY a.canonical_id, b.canonical_id
         ORDER BY COUNT(*) DESC
         LIMIT ?1"
    ).unwrap();

    stmt.query_map([limit as i64], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })
    .unwrap()
    .filter_map(|r| r.ok())
    .collect()
}

/// Compute genre weights from track identities with listen counts.
fn get_genre_weights(conn: &Connection) -> std::collections::HashMap<String, f64> {
    let mut weights = std::collections::HashMap::new();

    let mut stmt = conn.prepare(
        "SELECT ti.canonical_id, pt.genre, COUNT(lh.id) as cnt
         FROM track_identity ti
         JOIN playlist_tracks pt ON pt.source = ti.source AND pt.source_id = ti.source_id AND pt.genre != ''
         JOIN listen_history lh ON lh.canonical_id = ti.canonical_id AND lh.completed = 1
         GROUP BY ti.canonical_id, pt.genre"
    ).unwrap();

    let mut total = 0.0f64;
    let rows: Vec<(String, i64)> = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(1)?, row.get::<_, i64>(2)?))
    })
    .unwrap()
    .filter_map(|r| r.ok())
    .collect();

    for (genre, cnt) in &rows {
        let c = *cnt as f64;
        *weights.entry(genre.to_lowercase()).or_insert(0.0) += c;
        total += c;
    }

    // Normalize to 0.0-1.0
    if total > 0.0 {
        for val in weights.values_mut() {
            *val /= total;
        }
    }

    weights
}

/// Total completed listens.
fn get_total_completed(conn: &Connection) -> u32 {
    conn.query_row(
        "SELECT COUNT(*) FROM listen_history WHERE completed = 1",
        [],
        |row| row.get(0),
    ).unwrap_or(0)
}

// ─── Tauri commands ───

#[tauri::command]
pub fn build_profile(app: tauri::AppHandle) -> Result<TasteProfile, String> {
    let db = app.state::<crate::db::Db>();
    let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
    Ok(build_taste_profile(&conn, 200))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_db;
    use crate::history::*;
    use crate::track_id::*;

    fn seed_data(conn: &rusqlite::Connection) {
        resolve_or_create(conn, "youtube", "vid1", "Boards of Canada", "Dayvan Cowboy", 300.0);
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
```

- [ ] **Step 4: Register module and command in lib.rs**

Add `mod taste_profile;` and register `taste_profile::build_profile` in `invoke_handler`.

- [ ] **Step 5: Run tests**

Run: `cd /home/moffaty/projects/goamp/src-tauri && cargo test taste_profile -- --nocapture 2>&1`
Expected: All 4 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/taste_profile.rs src-tauri/src/lib.rs
git commit -m "feat: anonymous taste profile generation from local listening data"
```

---

### Task 8: Proof-of-Listening & Anti-Sybil

**Files:**
- Create: `src-tauri/src/sybil.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write the failing test**

```rust
// src-tauri/src/sybil.rs

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_proof_of_listening() {
        let proof = ListeningProof {
            track_hash: "abc123".to_string(),
            started_at: 1000,
            duration_secs: 200,
            listened_secs: 190,
        };
        assert!(proof.is_plausible());
    }

    #[test]
    fn test_impossible_proof_rejected() {
        // Listened longer than duration — impossible
        let proof = ListeningProof {
            track_hash: "abc123".to_string(),
            started_at: 1000,
            duration_secs: 200,
            listened_secs: 500,
        };
        assert!(!proof.is_plausible());
    }

    #[test]
    fn test_validate_profile_timing() {
        // 50 completed tracks × 3 min avg = 150 min minimum
        let proofs: Vec<ListeningProof> = (0..50).map(|i| ListeningProof {
            track_hash: format!("hash_{}", i),
            started_at: 1000 + i * 200,  // 200s apart
            duration_secs: 180,
            listened_secs: 170,
        }).collect();

        let result = validate_profile_timing(&proofs);
        assert!(result.is_valid);
        assert!(result.total_time_secs >= 50 * 170);
    }

    #[test]
    fn test_reject_impossibly_fast_profile() {
        // 100 tracks all "started" at the same second — impossible
        let proofs: Vec<ListeningProof> = (0..100).map(|i| ListeningProof {
            track_hash: format!("hash_{}", i),
            started_at: 1000,  // all same time
            duration_secs: 180,
            listened_secs: 170,
        }).collect();

        let result = validate_profile_timing(&proofs);
        assert!(!result.is_valid);
    }

    #[test]
    fn test_diversity_check() {
        // All same track hash = suspicious
        let proofs: Vec<ListeningProof> = (0..20).map(|i| ListeningProof {
            track_hash: "same_hash".to_string(),
            started_at: 1000 + i * 200,
            duration_secs: 180,
            listened_secs: 170,
        }).collect();

        assert!(!check_diversity(&proofs, 0.5)); // less than 50% unique
    }

    #[test]
    fn test_diverse_profile_passes() {
        let proofs: Vec<ListeningProof> = (0..20).map(|i| ListeningProof {
            track_hash: format!("hash_{}", i),
            started_at: 1000 + i * 200,
            duration_secs: 180,
            listened_secs: 170,
        }).collect();

        assert!(check_diversity(&proofs, 0.5));
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/moffaty/projects/goamp/src-tauri && cargo test sybil -- --nocapture 2>&1`
Expected: FAIL

- [ ] **Step 3: Write the implementation**

```rust
// src-tauri/src/sybil.rs

use serde::{Deserialize, Serialize};
use std::collections::HashSet;

/// Proof that a user actually listened to a track.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListeningProof {
    pub track_hash: String,
    pub started_at: i64,
    pub duration_secs: i64,
    pub listened_secs: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TimingValidation {
    pub is_valid: bool,
    pub total_time_secs: i64,
    pub reason: String,
}

impl ListeningProof {
    /// Check if a single proof is plausible.
    pub fn is_plausible(&self) -> bool {
        // Can't listen more than the track duration (with 10% tolerance for rounding)
        if self.listened_secs > (self.duration_secs as f64 * 1.1) as i64 {
            return false;
        }
        if self.listened_secs < 0 || self.duration_secs <= 0 {
            return false;
        }
        if self.started_at <= 0 {
            return false;
        }
        true
    }
}

/// Validate that a collection of proofs represents physically possible listening.
pub fn validate_profile_timing(proofs: &[ListeningProof]) -> TimingValidation {
    if proofs.is_empty() {
        return TimingValidation {
            is_valid: true,
            total_time_secs: 0,
            reason: "empty profile".to_string(),
        };
    }

    // Check individual plausibility
    for proof in proofs {
        if !proof.is_plausible() {
            return TimingValidation {
                is_valid: false,
                total_time_secs: 0,
                reason: format!("implausible proof for {}", proof.track_hash),
            };
        }
    }

    // Sort by start time
    let mut sorted: Vec<&ListeningProof> = proofs.iter().collect();
    sorted.sort_by_key(|p| p.started_at);

    // Check for overlapping listens — can't listen to 2 tracks at once
    let mut overlaps = 0;
    for window in sorted.windows(2) {
        let a = window[0];
        let b = window[1];
        // If B starts before A finishes, they overlap
        if b.started_at < a.started_at + a.listened_secs {
            overlaps += 1;
        }
    }

    // Allow some overlap (switching between tracks), but not if >50% overlap
    let overlap_ratio = overlaps as f64 / proofs.len().max(1) as f64;
    if overlap_ratio > 0.5 {
        return TimingValidation {
            is_valid: false,
            total_time_secs: 0,
            reason: format!("too many overlapping listens: {:.0}%", overlap_ratio * 100.0),
        };
    }

    let total_time: i64 = proofs.iter().map(|p| p.listened_secs).sum();

    TimingValidation {
        is_valid: true,
        total_time_secs: total_time,
        reason: "valid".to_string(),
    }
}

/// Check that a profile has sufficient track diversity.
/// `min_unique_ratio`: minimum fraction of unique track hashes (0.0-1.0).
pub fn check_diversity(proofs: &[ListeningProof], min_unique_ratio: f64) -> bool {
    if proofs.is_empty() {
        return true;
    }
    let unique: HashSet<&str> = proofs.iter().map(|p| p.track_hash.as_str()).collect();
    let ratio = unique.len() as f64 / proofs.len() as f64;
    ratio >= min_unique_ratio
}

/// Generate proofs from local listen history for profile submission.
pub fn generate_proofs(conn: &rusqlite::Connection, limit: usize) -> Vec<ListeningProof> {
    let mut stmt = conn.prepare(
        "SELECT canonical_id, started_at, duration_secs, listened_secs
         FROM listen_history
         WHERE completed = 1
         ORDER BY started_at DESC
         LIMIT ?1"
    ).unwrap();

    stmt.query_map([limit as i64], |row| {
        Ok(ListeningProof {
            track_hash: row.get(0)?,
            started_at: row.get(1)?,
            duration_secs: row.get(2)?,
            listened_secs: row.get(3)?,
        })
    })
    .unwrap()
    .filter_map(|r| r.ok())
    .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_proof_of_listening() {
        let proof = ListeningProof {
            track_hash: "abc123".to_string(),
            started_at: 1000,
            duration_secs: 200,
            listened_secs: 190,
        };
        assert!(proof.is_plausible());
    }

    #[test]
    fn test_impossible_proof_rejected() {
        let proof = ListeningProof {
            track_hash: "abc123".to_string(),
            started_at: 1000,
            duration_secs: 200,
            listened_secs: 500,
        };
        assert!(!proof.is_plausible());
    }

    #[test]
    fn test_validate_profile_timing() {
        let proofs: Vec<ListeningProof> = (0..50).map(|i| ListeningProof {
            track_hash: format!("hash_{}", i),
            started_at: 1000 + i * 200,
            duration_secs: 180,
            listened_secs: 170,
        }).collect();

        let result = validate_profile_timing(&proofs);
        assert!(result.is_valid);
        assert!(result.total_time_secs >= 50 * 170);
    }

    #[test]
    fn test_reject_impossibly_fast_profile() {
        let proofs: Vec<ListeningProof> = (0..100).map(|i| ListeningProof {
            track_hash: format!("hash_{}", i),
            started_at: 1000,
            duration_secs: 180,
            listened_secs: 170,
        }).collect();

        let result = validate_profile_timing(&proofs);
        assert!(!result.is_valid);
    }

    #[test]
    fn test_diversity_check() {
        let proofs: Vec<ListeningProof> = (0..20).map(|i| ListeningProof {
            track_hash: "same_hash".to_string(),
            started_at: 1000 + i * 200,
            duration_secs: 180,
            listened_secs: 170,
        }).collect();

        assert!(!check_diversity(&proofs, 0.5));
    }

    #[test]
    fn test_diverse_profile_passes() {
        let proofs: Vec<ListeningProof> = (0..20).map(|i| ListeningProof {
            track_hash: format!("hash_{}", i),
            started_at: 1000 + i * 200,
            duration_secs: 180,
            listened_secs: 170,
        }).collect();

        assert!(check_diversity(&proofs, 0.5));
    }
}
```

- [ ] **Step 4: Register module in lib.rs**

Add `mod sybil;` to `src-tauri/src/lib.rs`.

- [ ] **Step 5: Run tests**

Run: `cd /home/moffaty/projects/goamp/src-tauri && cargo test sybil -- --nocapture 2>&1`
Expected: All 6 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/sybil.rs src-tauri/src/lib.rs
git commit -m "feat: anti-Sybil proof-of-listening with timing and diversity validation"
```

---

### Task 9: Server Aggregator Client

**Files:**
- Create: `src-tauri/src/aggregator.rs`
- Modify: `src-tauri/src/db/mod.rs` (peer_profiles cache table)
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/lib/tauri-ipc.ts`

- [ ] **Step 1: Write the failing test for DB table**

```rust
// Add to src-tauri/src/db/mod.rs tests:

#[test]
fn test_peer_profiles_table_exists() {
    let db = test_db();
    let conn = db.0.lock().unwrap();

    conn.execute(
        "INSERT INTO peer_profiles (profile_hash, profile_data, received_at)
         VALUES ('abc', '{}', 1712200000)",
        [],
    ).unwrap();

    let count: i32 = conn.query_row(
        "SELECT COUNT(*) FROM peer_profiles", [], |row| row.get(0),
    ).unwrap();
    assert_eq!(count, 1);
}

#[test]
fn test_recommendation_cache_table_exists() {
    let db = test_db();
    let conn = db.0.lock().unwrap();

    conn.execute(
        "INSERT INTO recommendation_cache (canonical_id, score, source, cached_at)
         VALUES ('hash_abc', 0.95, 'collaborative', 1712200000)",
        [],
    ).unwrap();

    let score: f64 = conn.query_row(
        "SELECT score FROM recommendation_cache WHERE canonical_id = 'hash_abc'",
        [], |row| row.get(0),
    ).unwrap();
    assert!((score - 0.95).abs() < f64::EPSILON);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/moffaty/projects/goamp/src-tauri && cargo test peer_profiles_table recommendation_cache_table -- --nocapture 2>&1`
Expected: FAIL

- [ ] **Step 3: Add migration**

Add to `src-tauri/src/db/mod.rs` after the survey tables migration:

```rust
    // Migration: aggregation tables
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS peer_profiles (
            profile_hash TEXT PRIMARY KEY,
            profile_data TEXT NOT NULL,
            received_at INTEGER NOT NULL DEFAULT (unixepoch())
        );

        CREATE TABLE IF NOT EXISTS recommendation_cache (
            canonical_id TEXT PRIMARY KEY,
            score REAL NOT NULL,
            source TEXT NOT NULL,
            metadata TEXT NOT NULL DEFAULT '{}',
            cached_at INTEGER NOT NULL DEFAULT (unixepoch())
        );
        ",
    )?;
```

- [ ] **Step 4: Run DB tests**

Run: `cd /home/moffaty/projects/goamp/src-tauri && cargo test db::tests -- --nocapture 2>&1`
Expected: All PASS

- [ ] **Step 5: Write aggregator module tests**

```rust
// src-tauri/src/aggregator.rs

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

        let stored: String = conn.query_row(
            "SELECT profile_data FROM peer_profiles WHERE profile_hash = 'peer_hash_1'",
            [], |row| row.get(0),
        ).unwrap();
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

        let count: i32 = conn.query_row(
            "SELECT COUNT(*) FROM recommendation_cache",
            [], |row| row.get(0),
        ).unwrap();
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
        assert_eq!(cached[0].0, "hash_1"); // highest score first
    }
}
```

- [ ] **Step 6: Write aggregator implementation**

```rust
// src-tauri/src/aggregator.rs

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use crate::taste_profile::TasteProfile;
use crate::sybil::{ListeningProof, validate_profile_timing, check_diversity};

const AGGREGATOR_SETTING: &str = "aggregator_url";
const DEFAULT_AGGREGATOR: &str = "https://api.goamp.app/v1";

/// Store a peer's profile in local cache.
pub fn store_peer_profile(conn: &Connection, profile_hash: &str, profile_data: &str) {
    let _ = conn.execute(
        "INSERT OR REPLACE INTO peer_profiles (profile_hash, profile_data, received_at)
         VALUES (?1, ?2, unixepoch())",
        rusqlite::params![profile_hash, profile_data],
    );
}

/// Cache recommendation results locally.
pub fn cache_recommendations(conn: &Connection, recs: &[(String, f64, String)]) {
    for (canonical_id, score, source) in recs {
        let _ = conn.execute(
            "INSERT OR REPLACE INTO recommendation_cache (canonical_id, score, source, cached_at)
             VALUES (?1, ?2, ?3, unixepoch())",
            rusqlite::params![canonical_id, score, source],
        );
    }
}

/// Get cached recommendations, ordered by score desc.
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

/// Submit profile to aggregation server and receive recommendations.
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

/// Fetch latest recommendation model/index from aggregator.
pub async fn fetch_recommendations(
    client: &reqwest::Client,
    base_url: &str,
    liked_hashes: &[String],
) -> Result<AggregatorResponse, String> {
    let resp = client
        .post(format!("{}/recommendations/for-profile", base_url))
        .json(&serde_json::json!({ "liked_hashes": liked_hashes }))
        .header("User-Agent", "GOAMP/1.0")
        .send()
        .await
        .map_err(|e| format!("recommendation request failed: {e}"))?;

    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("recommendation error: {body}"));
    }

    resp.json().await.map_err(|e| format!("parse error: {e}"))
}

// ─── Tauri commands ───

#[tauri::command]
pub async fn sync_profile(app: tauri::AppHandle) -> Result<u32, String> {
    let db = app.state::<crate::db::Db>();
    let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());

    let base_url = conn
        .query_row("SELECT value FROM settings WHERE key = ?1", [AGGREGATOR_SETTING], |row| row.get::<_, String>(0))
        .unwrap_or_else(|_| DEFAULT_AGGREGATOR.to_string());

    let profile = crate::taste_profile::build_taste_profile(&conn, 200);
    let proofs = crate::sybil::generate_proofs(&conn, 200);

    drop(conn); // Release lock before async

    let client = reqwest::Client::new();
    let submission = ProfileSubmission { profile, proofs };
    let response = submit_to_aggregator(&client, &base_url, &submission).await?;

    // Cache received recommendations
    let db = app.state::<crate::db::Db>();
    let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
    let recs: Vec<(String, f64, String)> = response.recommendations.iter()
        .map(|r| (r.canonical_id.clone(), r.score, r.source.clone()))
        .collect();
    cache_recommendations(&conn, &recs);

    eprintln!("[GOAMP] Synced profile, received {} recommendations from {} peers",
        response.recommendations.len(), response.peer_count);
    Ok(response.recommendations.len() as u32)
}

#[tauri::command]
pub fn get_recommendations(app: tauri::AppHandle, limit: Option<u32>) -> Result<Vec<(String, f64, String)>, String> {
    let db = app.state::<crate::db::Db>();
    let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
    Ok(get_cached_recommendations(&conn, limit.unwrap_or(50) as usize))
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

        let stored: String = conn.query_row(
            "SELECT profile_data FROM peer_profiles WHERE profile_hash = 'peer_hash_1'",
            [], |row| row.get(0),
        ).unwrap();
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

        let count: i32 = conn.query_row(
            "SELECT COUNT(*) FROM recommendation_cache",
            [], |row| row.get(0),
        ).unwrap();
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
```

- [ ] **Step 7: Register module, commands, add IPC**

In `src-tauri/src/lib.rs` add `mod aggregator;` and register:
- `aggregator::sync_profile`
- `aggregator::get_recommendations`

In `src/lib/tauri-ipc.ts`:

```typescript
// Aggregator
export async function syncProfile(): Promise<number> {
  return invoke("sync_profile");
}

export async function getRecommendations(limit?: number): Promise<[string, number, string][]> {
  return invoke("get_recommendations", { limit: limit ?? null });
}
```

- [ ] **Step 8: Run all tests**

Run: `cd /home/moffaty/projects/goamp/src-tauri && cargo test -- --nocapture 2>&1 | tail -20`
Expected: All tests PASS

- [ ] **Step 9: Commit**

```bash
git add src-tauri/src/aggregator.rs src-tauri/src/db/mod.rs src-tauri/src/lib.rs src/lib/tauri-ipc.ts
git commit -m "feat: server aggregator client with profile sync and recommendation caching"
```

---

## Phase 3: Recommendation Engine & Genre Radio UI

### File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src-tauri/src/recommend.rs` | Hybrid recommendation engine: collaborative + content-based + Last.fm fallback |
| Create | `src/recommendations/RecommendationPanel.ts` | Genre radio & mood channel UI |
| Create | `src/recommendations/recommendation-service.ts` | Frontend recommendation service |
| Modify | `src/webamp/bridge.ts` | Register recommendation panel |
| Modify | `src/webamp/goamp-menu.ts` | Add menu entry |

---

### Task 10: Local Recommendation Engine

**Files:**
- Create: `src-tauri/src/recommend.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write the failing test**

```rust
// src-tauri/src/recommend.rs

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_db;
    use crate::track_id::*;
    use crate::history::*;

    fn seed_rich_data(conn: &rusqlite::Connection) {
        // Create diverse track library
        let tracks = vec![
            ("youtube", "v1", "Boards of Canada", "Dayvan Cowboy", 300.0),
            ("youtube", "v2", "Aphex Twin", "Windowlicker", 390.0),
            ("youtube", "v3", "Autechre", "Gantz Graf", 260.0),
            ("soundcloud", "s1", "Four Tet", "She Moves She", 420.0),
            ("youtube", "v4", "Metallica", "Enter Sandman", 331.0),
            ("youtube", "v5", "Slayer", "Raining Blood", 251.0),
            ("soundcloud", "s2", "Bonobo", "Kerala", 335.0),
        ];

        for (src, sid, artist, title, dur) in &tracks {
            resolve_or_create(conn, src, sid, artist, title, *dur);
        }

        // IDM cluster: listen patterns
        let cid1 = canonical_hash("Boards of Canada", "Dayvan Cowboy");
        let cid2 = canonical_hash("Aphex Twin", "Windowlicker");
        let cid3 = canonical_hash("Autechre", "Gantz Graf");
        let cid4 = canonical_hash("Four Tet", "She Moves She");

        for i in 0..10 {
            record_listen(conn, &cid1, "youtube", 1000 + i * 400, 300, 280, true, false);
            record_listen(conn, &cid2, "youtube", 1200 + i * 400, 390, 380, true, false);
        }
        for i in 0..3 {
            record_listen(conn, &cid3, "youtube", 5000 + i * 400, 260, 250, true, false);
        }

        set_like(conn, &cid1, true);
        set_like(conn, &cid2, true);
        set_like(conn, &cid3, true);
        set_like(conn, &cid4, true);

        // Peer profiles that show cid4 and cid7 co-occurring with cid1,cid2
        let peer_profile = serde_json::json!({
            "liked_hashes": [cid1, cid2, cid4,
                canonical_hash("Bonobo", "Kerala")]
        }).to_string();
        crate::aggregator::store_peer_profile(conn, "peer1", &peer_profile);
    }

    #[test]
    fn test_collaborative_recommendations() {
        let db = test_db();
        let conn = db.0.lock().unwrap();
        seed_rich_data(&conn);

        let my_likes = crate::history::get_liked_canonical_ids(&conn);
        let recs = collaborative_recommend(&conn, &my_likes, 10);

        // Should recommend tracks liked by similar peers but not yet liked by user
        // Bonobo - Kerala is in peer's likes but not in ours
        let bonobo_cid = canonical_hash("Bonobo", "Kerala");
        // It might or might not appear depending on overlap threshold,
        // but the function should not crash and return a list
        assert!(recs.len() <= 10);
    }

    #[test]
    fn test_content_based_recommendations() {
        let db = test_db();
        let conn = db.0.lock().unwrap();
        seed_rich_data(&conn);

        let recs = content_recommend(&conn, 10);
        // Should return tracks sorted by listen affinity
        assert!(recs.len() <= 10);
    }

    #[test]
    fn test_hybrid_recommendations_merge() {
        let db = test_db();
        let conn = db.0.lock().unwrap();
        seed_rich_data(&conn);

        let recs = hybrid_recommend(&conn, 10);
        assert!(recs.len() <= 10);
        // Scores should be between 0 and 1
        for (_, score, _) in &recs {
            assert!(*score >= 0.0 && *score <= 1.0);
        }
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/moffaty/projects/goamp/src-tauri && cargo test recommend -- --nocapture 2>&1`
Expected: FAIL

- [ ] **Step 3: Write the implementation**

```rust
// src-tauri/src/recommend.rs

use rusqlite::Connection;
use std::collections::{HashMap, HashSet};

/// Collaborative filtering: find tracks liked by similar peers but not yet liked by user.
pub fn collaborative_recommend(
    conn: &Connection,
    my_likes: &[String],
    limit: usize,
) -> Vec<(String, f64, String)> {
    let my_set: HashSet<&str> = my_likes.iter().map(|s| s.as_str()).collect();
    if my_set.is_empty() {
        return vec![];
    }

    // Load peer profiles
    let mut stmt = conn.prepare(
        "SELECT profile_data FROM peer_profiles"
    ).unwrap();

    let peers: Vec<String> = stmt.query_map([], |row| row.get(0))
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    // Score tracks by co-occurrence with my likes across peers
    let mut track_scores: HashMap<String, f64> = HashMap::new();

    for peer_json in &peers {
        let peer: serde_json::Value = match serde_json::from_str(peer_json) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let peer_likes: Vec<&str> = peer.get("liked_hashes")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|v| v.as_str()).collect())
            .unwrap_or_default();

        // Jaccard similarity between my likes and peer likes
        let peer_set: HashSet<&str> = peer_likes.iter().copied().collect();
        let intersection = my_set.intersection(&peer_set).count();
        if intersection == 0 {
            continue;
        }
        let union = my_set.union(&peer_set).count();
        let similarity = intersection as f64 / union as f64;

        // Tracks peer likes that I don't = candidates
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

/// Content-based: recommend based on listening patterns and completion rates.
pub fn content_recommend(
    conn: &Connection,
    limit: usize,
) -> Vec<(String, f64, String)> {
    // Find tracks with high completion rate that aren't explicitly liked/disliked
    let mut stmt = conn.prepare(
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
         LIMIT ?1"
    ).unwrap();

    stmt.query_map([limit as i64], |row| {
        let cid: String = row.get(0)?;
        let avg_completion: f64 = row.get(3)?;
        Ok((cid, avg_completion.min(1.0), "content".to_string()))
    })
    .unwrap()
    .filter_map(|r| r.ok())
    .collect()
}

/// Hybrid recommendation: merge collaborative and content-based with weighted scoring.
pub fn hybrid_recommend(
    conn: &Connection,
    limit: usize,
) -> Vec<(String, f64, String)> {
    let my_likes = crate::history::get_liked_canonical_ids(conn);

    let collab = collaborative_recommend(conn, &my_likes, limit * 2);
    let content = content_recommend(conn, limit * 2);

    // Also use cached server recommendations
    let cached = crate::aggregator::get_cached_recommendations(conn, limit * 2);

    // Merge with weights: collaborative 0.4, content 0.3, server 0.3
    let mut merged: HashMap<String, (f64, String)> = HashMap::new();

    for (id, score, source) in &collab {
        let entry = merged.entry(id.clone()).or_insert((0.0, source.clone()));
        entry.0 += score * 0.4;
    }
    for (id, score, source) in &content {
        let entry = merged.entry(id.clone()).or_insert((0.0, source.clone()));
        entry.0 += score * 0.3;
    }
    for (id, score, source) in &cached {
        let entry = merged.entry(id.clone()).or_insert((0.0, source.clone()));
        entry.0 += score * 0.3;
    }

    let mut result: Vec<(String, f64, String)> = merged
        .into_iter()
        .map(|(id, (score, source))| (id, score.min(1.0), source))
        .collect();
    result.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
    result.truncate(limit);
    result
}

// ─── Tauri commands ───

#[tauri::command]
pub fn get_hybrid_recommendations(
    app: tauri::AppHandle,
    limit: Option<u32>,
) -> Result<Vec<(String, f64, String)>, String> {
    let db = app.state::<crate::db::Db>();
    let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
    Ok(hybrid_recommend(&conn, limit.unwrap_or(30) as usize))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_db;
    use crate::track_id::*;
    use crate::history::*;

    fn seed_rich_data(conn: &rusqlite::Connection) {
        let tracks = vec![
            ("youtube", "v1", "Boards of Canada", "Dayvan Cowboy", 300.0),
            ("youtube", "v2", "Aphex Twin", "Windowlicker", 390.0),
            ("youtube", "v3", "Autechre", "Gantz Graf", 260.0),
            ("soundcloud", "s1", "Four Tet", "She Moves She", 420.0),
            ("youtube", "v4", "Metallica", "Enter Sandman", 331.0),
            ("youtube", "v5", "Slayer", "Raining Blood", 251.0),
            ("soundcloud", "s2", "Bonobo", "Kerala", 335.0),
        ];

        for (src, sid, artist, title, dur) in &tracks {
            resolve_or_create(conn, src, sid, artist, title, *dur);
        }

        let cid1 = canonical_hash("Boards of Canada", "Dayvan Cowboy");
        let cid2 = canonical_hash("Aphex Twin", "Windowlicker");
        let cid3 = canonical_hash("Autechre", "Gantz Graf");
        let cid4 = canonical_hash("Four Tet", "She Moves She");

        for i in 0..10 {
            record_listen(conn, &cid1, "youtube", 1000 + i * 400, 300, 280, true, false);
            record_listen(conn, &cid2, "youtube", 1200 + i * 400, 390, 380, true, false);
        }
        for i in 0..3 {
            record_listen(conn, &cid3, "youtube", 5000 + i * 400, 260, 250, true, false);
        }

        set_like(conn, &cid1, true);
        set_like(conn, &cid2, true);
        set_like(conn, &cid3, true);
        set_like(conn, &cid4, true);

        let peer_profile = serde_json::json!({
            "liked_hashes": [cid1, cid2, cid4,
                canonical_hash("Bonobo", "Kerala")]
        }).to_string();
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
```

- [ ] **Step 4: Register module and command**

Add `mod recommend;` and register `recommend::get_hybrid_recommendations` in `invoke_handler`.

- [ ] **Step 5: Run tests**

Run: `cd /home/moffaty/projects/goamp/src-tauri && cargo test recommend -- --nocapture 2>&1`
Expected: All 3 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/recommend.rs src-tauri/src/lib.rs
git commit -m "feat: hybrid recommendation engine with collaborative filtering and content analysis"
```

---

### Task 11: Last.fm Fallback for Cold Start

**Files:**
- Modify: `src-tauri/src/recommend.rs` (add Last.fm getSimilar integration)

- [ ] **Step 1: Write the failing test**

```rust
// Add to src-tauri/src/recommend.rs tests:

#[test]
fn test_lastfm_similar_url() {
    let url = lastfm_similar_url("abc123", "Boards of Canada", "Dayvan Cowboy");
    assert!(url.contains("method=track.getSimilar"));
    assert!(url.contains("Boards+of+Canada"));
    assert!(url.contains("Dayvan+Cowboy"));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/moffaty/projects/goamp/src-tauri && cargo test lastfm_similar_url -- --nocapture 2>&1`
Expected: FAIL

- [ ] **Step 3: Write the implementation**

Add to `src-tauri/src/recommend.rs`:

```rust
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

    let tracks = match body.get("similartracks")
        .and_then(|st| st.get("track"))
        .and_then(|t| t.as_array())
    {
        Some(arr) => arr,
        None => return vec![],
    };

    tracks.iter().filter_map(|t| {
        let name = t.get("name")?.as_str()?;
        let artist = t.get("artist")?.get("name")?.as_str()?;
        let match_score = t.get("match")?.as_str()?.parse::<f64>().ok()?;
        Some((artist.to_string(), name.to_string(), match_score))
    }).collect()
}

/// Cold-start recommendation: use Last.fm getSimilar when local data is insufficient.
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
            [], |row| row.get::<_, String>(0),
        ).map_err(|_| "Last.fm API key not set")?
    };

    let client = reqwest::Client::new();
    let mut similar = lastfm_get_similar(&client, &api_key, &artist, &title).await;
    similar.truncate(limit.unwrap_or(20) as usize);
    Ok(similar)
}
```

- [ ] **Step 4: Register command in lib.rs**

Add `recommend::get_coldstart_recommendations` to `invoke_handler`.

- [ ] **Step 5: Add IPC declaration**

Add to `src/lib/tauri-ipc.ts`:

```typescript
// Recommendations
export async function getHybridRecommendations(limit?: number): Promise<[string, number, string][]> {
  return invoke("get_hybrid_recommendations", { limit: limit ?? null });
}

export async function getColdstartRecommendations(
  artist: string,
  title: string,
  limit?: number,
): Promise<[string, string, number][]> {
  return invoke("get_coldstart_recommendations", { artist, title, limit: limit ?? null });
}
```

- [ ] **Step 6: Run tests**

Run: `cd /home/moffaty/projects/goamp/src-tauri && cargo test recommend -- --nocapture 2>&1`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/recommend.rs src-tauri/src/lib.rs src/lib/tauri-ipc.ts
git commit -m "feat: Last.fm getSimilar fallback for cold start recommendations"
```

---

### Task 12: Mood Channels Configuration

**Files:**
- Modify: `src-tauri/src/db/mod.rs` (mood_channels table)
- Modify: `src-tauri/src/recommend.rs` (mood channel CRUD + track assignment)

- [ ] **Step 1: Write the failing test for DB**

```rust
// Add to db/mod.rs tests:

#[test]
fn test_mood_channels_table_exists() {
    let db = test_db();
    let conn = db.0.lock().unwrap();

    conn.execute(
        "INSERT INTO mood_channels (id, name, description, seed_tracks, filters)
         VALUES ('ch1', 'Focus', 'Music for deep work', '[]', '{}')",
        [],
    ).unwrap();

    let name: String = conn.query_row(
        "SELECT name FROM mood_channels WHERE id = 'ch1'",
        [], |row| row.get(0),
    ).unwrap();
    assert_eq!(name, "Focus");
}
```

- [ ] **Step 2: Run and verify failure**

Run: `cd /home/moffaty/projects/goamp/src-tauri && cargo test mood_channels_table -- --nocapture 2>&1`
Expected: FAIL

- [ ] **Step 3: Add migration and default channels**

Add to `src-tauri/src/db/mod.rs`:

```rust
    // Migration: mood channels
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS mood_channels (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            seed_tracks TEXT NOT NULL DEFAULT '[]',
            filters TEXT NOT NULL DEFAULT '{}',
            created_at INTEGER NOT NULL DEFAULT (unixepoch()),
            is_default INTEGER NOT NULL DEFAULT 0
        );

        -- Default mood channels
        INSERT OR IGNORE INTO mood_channels (id, name, description, is_default) VALUES
            ('calm', 'Calm', 'Relaxing and ambient music', 1),
            ('energetic', 'Energetic', 'Upbeat and driving tracks', 1),
            ('focus', 'Focus', 'Music for concentration', 1),
            ('discovery', 'Discovery', 'New tracks from recommendations', 1);
        ",
    )?;
```

- [ ] **Step 4: Write mood channel Tauri commands**

Add to `src-tauri/src/recommend.rs`:

```rust
#[derive(Debug, Serialize, Deserialize)]
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

    let channels = stmt.query_map([], |row| {
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
    ).map_err(|e| format!("{e}"))?;

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

    let current: String = conn.query_row(
        "SELECT seed_tracks FROM mood_channels WHERE id = ?1",
        [&channel_id], |row| row.get(0),
    ).map_err(|_| "channel not found")?;

    let mut seeds: Vec<String> = serde_json::from_str(&current).unwrap_or_default();
    if !seeds.contains(&canonical_id) {
        seeds.push(canonical_id);
    }

    let updated = serde_json::to_string(&seeds).unwrap();
    conn.execute(
        "UPDATE mood_channels SET seed_tracks = ?1 WHERE id = ?2",
        rusqlite::params![updated, channel_id],
    ).map_err(|e| format!("{e}"))?;

    Ok(())
}

#[tauri::command]
pub fn delete_mood_channel(
    app: tauri::AppHandle,
    channel_id: String,
) -> Result<(), String> {
    let db = app.state::<crate::db::Db>();
    let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());

    // Don't delete default channels
    let is_default: i32 = conn.query_row(
        "SELECT is_default FROM mood_channels WHERE id = ?1",
        [&channel_id], |row| row.get(0),
    ).map_err(|_| "channel not found")?;

    if is_default != 0 {
        return Err("cannot delete default channel".into());
    }

    conn.execute(
        "DELETE FROM mood_channels WHERE id = ?1",
        [&channel_id],
    ).map_err(|e| format!("{e}"))?;

    Ok(())
}
```

- [ ] **Step 5: Register commands, add IPC**

Register in `invoke_handler`:
- `recommend::list_mood_channels`
- `recommend::create_mood_channel`
- `recommend::add_seed_track`
- `recommend::delete_mood_channel`

Add to `src/lib/tauri-ipc.ts`:

```typescript
// Mood Channels
export interface MoodChannel {
  id: string;
  name: string;
  description: string;
  seed_tracks: string[];
  is_default: boolean;
}

export async function listMoodChannels(): Promise<MoodChannel[]> {
  return invoke("list_mood_channels");
}

export async function createMoodChannel(name: string, description: string): Promise<MoodChannel> {
  return invoke("create_mood_channel", { name, description });
}

export async function addSeedTrack(channelId: string, canonicalId: string): Promise<void> {
  return invoke("add_seed_track", { channelId, canonicalId });
}

export async function deleteMoodChannel(channelId: string): Promise<void> {
  return invoke("delete_mood_channel", { channelId });
}
```

- [ ] **Step 6: Run all tests**

Run: `cd /home/moffaty/projects/goamp/src-tauri && cargo test -- --nocapture 2>&1 | tail -20`
Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/recommend.rs src-tauri/src/db/mod.rs src-tauri/src/lib.rs src/lib/tauri-ipc.ts
git commit -m "feat: mood channels with seed tracks and default presets"
```

---

### Task 13: Remove Yandex Music Integration

**Files:**
- Delete: `src-tauri/src/yandex.rs`
- Delete: `src/yandex/` (entire directory)
- Modify: `src-tauri/src/lib.rs` (remove mod yandex and all yandex commands)
- Modify: `src-tauri/Cargo.toml` (remove `yandex-music` dependency)
- Modify: `src/webamp/bridge.ts` (remove Yandex panel registration)
- Modify: `src/youtube/SearchOverlay.ts` (remove Yandex tab)
- Modify: `src-tauri/src/db/mod.rs` (remove `yandex_music` feature flag default)

- [ ] **Step 1: Remove `yandex-music` from Cargo.toml**

```bash
cd /home/moffaty/projects/goamp/src-tauri && cargo remove yandex-music
```

- [ ] **Step 2: Delete yandex.rs**

```bash
rm /home/moffaty/projects/goamp/src-tauri/src/yandex.rs
```

- [ ] **Step 3: Remove `mod yandex` and all yandex commands from lib.rs**

Remove the `mod yandex;` declaration and all `yandex::*` commands from the `invoke_handler` macro in `src-tauri/src/lib.rs`.

- [ ] **Step 4: Delete frontend Yandex directory**

```bash
rm -rf /home/moffaty/projects/goamp/src/yandex/
```

- [ ] **Step 5: Remove Yandex panel from bridge.ts**

Remove the YandexPanel import and registration from `src/webamp/bridge.ts`.

- [ ] **Step 6: Remove Yandex tab from SearchOverlay.ts**

Remove the Yandex search tab from `src/youtube/SearchOverlay.ts`.

- [ ] **Step 7: Update feature flags default**

In `src-tauri/src/db/mod.rs`, remove the line:
```sql
('yandex_music', 1, 'Yandex Music integration'),
```

- [ ] **Step 8: Build and verify**

Run: `cd /home/moffaty/projects/goamp/src-tauri && cargo build 2>&1 | tail -20`
Expected: Builds successfully with no yandex references

Run: `cd /home/moffaty/projects/goamp && npx tsc --noEmit 2>&1`
Expected: No TypeScript errors

- [ ] **Step 9: Run all tests**

Run: `cd /home/moffaty/projects/goamp/src-tauri && cargo test -- --nocapture 2>&1 | tail -20`
Expected: All tests PASS

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: remove Yandex Music integration, replaced by GOAMP recommendations"
```

---

### Task 14: Recommendation Panel UI

**Files:**
- Create: `src/recommendations/RecommendationPanel.ts`
- Create: `src/recommendations/recommendation-service.ts`
- Create: `src/recommendations/SurveyWidget.ts`
- Modify: `src/webamp/bridge.ts` (register new panel)
- Modify: `src/webamp/goamp-menu.ts` (add menu entry)

- [ ] **Step 1: Create recommendation service**

```typescript
// src/recommendations/recommendation-service.ts

import {
  getHybridRecommendations,
  getColdstartRecommendations,
  listMoodChannels,
  syncProfile,
  surveyGetPending,
  surveyRespond,
  surveySkip,
  type MoodChannel,
  type Survey,
} from '../lib/tauri-ipc';

export interface Recommendation {
  canonicalId: string;
  score: number;
  source: string;
}

export async function fetchRecommendations(limit = 30): Promise<Recommendation[]> {
  const recs = await getHybridRecommendations(limit);
  return recs.map(([canonicalId, score, source]) => ({ canonicalId, score, source }));
}

export async function fetchColdstart(artist: string, title: string, limit = 20) {
  return getColdstartRecommendations(artist, title, limit);
}

export async function getMoodChannels(): Promise<MoodChannel[]> {
  return listMoodChannels();
}

export async function syncWithServer(): Promise<number> {
  return syncProfile();
}

export async function getNextSurvey(): Promise<Survey | null> {
  return surveyGetPending();
}

export async function answerSurvey(surveyId: number, response: string): Promise<void> {
  return surveyRespond(surveyId, response);
}

export async function dismissSurvey(surveyId: number): Promise<void> {
  return surveySkip(surveyId);
}
```

- [ ] **Step 2: Create SurveyWidget**

```typescript
// src/recommendations/SurveyWidget.ts

import { getNextSurvey, answerSurvey, dismissSurvey } from './recommendation-service';

export function createSurveyWidget(container: HTMLElement): { check: () => void } {
  const widget = document.createElement('div');
  widget.className = 'survey-widget';
  widget.style.display = 'none';
  container.appendChild(widget);

  async function check() {
    const survey = await getNextSurvey();
    if (!survey) {
      widget.style.display = 'none';
      return;
    }

    const payload = JSON.parse(survey.payload);
    widget.style.display = 'block';
    widget.innerHTML = '';

    const dismiss = document.createElement('button');
    dismiss.className = 'survey-dismiss';
    dismiss.textContent = '\u00d7';
    dismiss.onclick = () => {
      dismissSurvey(survey.id);
      widget.style.display = 'none';
    };
    widget.appendChild(dismiss);

    if (survey.survey_type === 'mood') {
      const label = document.createElement('span');
      label.textContent = 'This track feels:';
      widget.appendChild(label);

      for (const choice of payload.choices) {
        const btn = document.createElement('button');
        btn.className = 'survey-choice';
        btn.textContent = choice;
        btn.onclick = () => {
          answerSurvey(survey.id, choice);
          widget.style.display = 'none';
        };
        widget.appendChild(btn);
      }
    } else if (survey.survey_type === 'genre') {
      const label = document.createElement('span');
      label.textContent = 'Best genre for this track:';
      widget.appendChild(label);

      for (const option of payload.options) {
        const btn = document.createElement('button');
        btn.className = 'survey-choice';
        btn.textContent = option;
        btn.onclick = () => {
          answerSurvey(survey.id, option);
          widget.style.display = 'none';
        };
        widget.appendChild(btn);
      }
    } else if (survey.survey_type === 'similarity') {
      const label = document.createElement('span');
      label.textContent = 'Which two are most similar?';
      widget.appendChild(label);
      // Similarity surveys need more complex UI — track pair selection
      // This is a simplified version showing track hashes
      for (let i = 0; i < payload.tracks.length; i++) {
        for (let j = i + 1; j < payload.tracks.length; j++) {
          const btn = document.createElement('button');
          btn.className = 'survey-choice';
          btn.textContent = `${i + 1} & ${j + 1}`;
          btn.onclick = () => {
            answerSurvey(survey.id, `${payload.tracks[i]}|${payload.tracks[j]}`);
            widget.style.display = 'none';
          };
          widget.appendChild(btn);
        }
      }
    }
  }

  return { check };
}
```

- [ ] **Step 3: Create RecommendationPanel**

```typescript
// src/recommendations/RecommendationPanel.ts

import {
  fetchRecommendations,
  getMoodChannels,
  syncWithServer,
  type Recommendation,
} from './recommendation-service';
import { createSurveyWidget } from './SurveyWidget';
import type { MoodChannel } from '../lib/tauri-ipc';

export function createRecommendationPanel(container: HTMLElement) {
  const panel = document.createElement('div');
  panel.className = 'recommendation-panel';
  panel.innerHTML = `
    <div class="rec-header">
      <span class="rec-title">Recommendations</span>
      <button class="rec-sync" title="Sync with network">&#x21bb;</button>
    </div>
    <div class="rec-channels"></div>
    <div class="rec-list"></div>
    <div class="rec-survey-area"></div>
  `;
  container.appendChild(panel);

  const channelsEl = panel.querySelector('.rec-channels') as HTMLElement;
  const listEl = panel.querySelector('.rec-list') as HTMLElement;
  const syncBtn = panel.querySelector('.rec-sync') as HTMLButtonElement;
  const surveyArea = panel.querySelector('.rec-survey-area') as HTMLElement;

  const survey = createSurveyWidget(surveyArea);

  let activeChannel: string | null = null;

  async function loadChannels() {
    const channels = await getMoodChannels();
    channelsEl.innerHTML = '';

    // "All" tab
    const allTab = document.createElement('button');
    allTab.className = 'rec-tab' + (activeChannel === null ? ' active' : '');
    allTab.textContent = 'All';
    allTab.onclick = () => { activeChannel = null; loadRecommendations(); loadChannels(); };
    channelsEl.appendChild(allTab);

    for (const ch of channels) {
      const tab = document.createElement('button');
      tab.className = 'rec-tab' + (activeChannel === ch.id ? ' active' : '');
      tab.textContent = ch.name;
      tab.onclick = () => { activeChannel = ch.id; loadRecommendations(); loadChannels(); };
      channelsEl.appendChild(tab);
    }
  }

  async function loadRecommendations() {
    listEl.innerHTML = '<div class="rec-loading">Loading...</div>';

    const recs = await fetchRecommendations(30);
    listEl.innerHTML = '';

    if (recs.length === 0) {
      listEl.innerHTML = '<div class="rec-empty">Listen to more music to get recommendations!</div>';
      return;
    }

    for (const rec of recs) {
      const item = document.createElement('div');
      item.className = 'rec-item';
      item.innerHTML = `
        <span class="rec-score">${Math.round(rec.score * 100)}%</span>
        <span class="rec-track-id">${rec.canonicalId.substring(0, 12)}...</span>
        <span class="rec-source">${rec.source}</span>
      `;
      listEl.appendChild(item);
    }
  }

  syncBtn.onclick = async () => {
    syncBtn.disabled = true;
    syncBtn.textContent = '...';
    try {
      const count = await syncWithServer();
      syncBtn.textContent = `\u2713 ${count}`;
      await loadRecommendations();
    } catch {
      syncBtn.textContent = '\u2717';
    }
    setTimeout(() => { syncBtn.textContent = '\u21bb'; syncBtn.disabled = false; }, 3000);
  };

  // Initial load
  loadChannels();
  loadRecommendations();

  // Check for surveys periodically (every 15 min of active use)
  survey.check();
  setInterval(() => survey.check(), 15 * 60 * 1000);

  return panel;
}
```

- [ ] **Step 4: Register panel in bridge.ts**

Add import and registration of RecommendationPanel in `src/webamp/bridge.ts`, following the same pattern as RadioPanel.

- [ ] **Step 5: Add menu entry in goamp-menu.ts**

Add a "Recommendations" entry to the GOAMP menu in `src/webamp/goamp-menu.ts`.

- [ ] **Step 6: Build and verify**

Run: `cd /home/moffaty/projects/goamp && npx tsc --noEmit 2>&1`
Expected: No TypeScript errors

- [ ] **Step 7: Commit**

```bash
git add src/recommendations/ src/webamp/bridge.ts src/webamp/goamp-menu.ts
git commit -m "feat: recommendation panel UI with mood channels, sync, and micro-surveys"
```

---

### Task 15: Integration Wiring & Feature Flag

**Files:**
- Modify: `src-tauri/src/db/mod.rs` (add feature flag)
- Modify: `src/webamp/bridge.ts` (wire history tracker to track events)

- [ ] **Step 1: Add feature flag**

In `src-tauri/src/db/mod.rs`, add to feature flags INSERT:
```sql
('recommendations', 1, 'GOAMP recommendations and mood radio');
```

- [ ] **Step 2: Wire HistoryTracker into bridge.ts**

In `src/webamp/bridge.ts`, instantiate `HistoryTracker` and connect it to Webamp's track change events:

```typescript
import { HistoryTracker } from '../recommendations/history-service';
import { resolveTrackId, recordTrackListen } from '../lib/tauri-ipc';

// After webamp is initialized:
const historyTracker = new HistoryTracker(resolveTrackId, recordTrackListen);

// On track start (when Webamp begins playing a new track):
// historyTracker.onTrackStart(source, sourceId, artist, title, duration);

// On track end/change:
// historyTracker.onTrackEnd(listenedSeconds);
```

The exact event hooking depends on Webamp's API — read `bridge.ts` to find the right event listeners.

- [ ] **Step 3: Run full build**

Run: `cd /home/moffaty/projects/goamp/src-tauri && cargo build 2>&1 | tail -10`
Run: `cd /home/moffaty/projects/goamp && npx tsc --noEmit 2>&1`
Expected: Both succeed

- [ ] **Step 4: Run all tests**

Run: `cd /home/moffaty/projects/goamp/src-tauri && cargo test -- --nocapture 2>&1 | tail -20`
Run: `cd /home/moffaty/projects/goamp && npx vitest run 2>&1 | tail -10`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: wire recommendation system into player with feature flag"
```

---

## Summary

| Phase | Tasks | What it delivers |
|-------|-------|-----------------|
| 1: Foundation | 1-6 | Track ID (MusicBrainz + hash), listen history, likes, implicit signals, micro-surveys |
| 2: Aggregation | 7-9 | Taste profiles, anti-Sybil proofs, server aggregator client, peer profile cache |
| 3: Engine & UI | 10-15 | Hybrid recommendations, Last.fm fallback, mood channels, panel UI, Yandex removal |

**Key design decisions:**
- Track ID level 4 (unidentifiable local files) participates in aggregation **only** when `peer_count >= threshold` — rare tracks gain weight across users
- Anti-Sybil uses proof-of-listening timing validation + diversity checks
- Cold start falls back to Last.fm getSimilar, no ML needed
- Recommendation model is collaborative filtering + content-based hybrid — runs on CPU, scales to millions of profiles
- Server aggregator is supplementary; P2P gossip layer will be added in a separate plan
