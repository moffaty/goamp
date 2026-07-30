use chrono::Utc;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::Manager;

#[derive(Serialize, Deserialize, Debug, PartialEq, Clone)]
pub struct ChartEntry {
    pub canonical_id: String,
    pub artist: String,
    pub title: String,
    pub play_count: i32,
}

/// Cutoff (unix secs) for a chart period. "week"/"month" are relative windows;
/// anything else (incl. "all") means no lower bound.
fn period_cutoff(period: &str) -> i64 {
    let now = Utc::now().timestamp();
    match period {
        "week" => now - 7 * 86_400,
        "month" => now - 30 * 86_400,
        _ => 0,
    }
}

/// Top completed-play tracks in a period, most-played first.
///
/// play_count counts rows in `listen_history` ONLY — artist/title come from
/// correlated subqueries against `track_identity` (which can hold several rows
/// per canonical_id). A LEFT JOIN here would multiply listen rows by identity
/// rows and inflate the count, so we deliberately avoid it.
pub fn get_top_tracks(conn: &Connection, period: &str, limit: i32) -> Vec<ChartEntry> {
    let cutoff = period_cutoff(period);
    let mut stmt = match conn.prepare(
        "SELECT h.canonical_id,
                COALESCE((SELECT MAX(artist) FROM track_identity WHERE canonical_id = h.canonical_id), '') AS artist,
                COALESCE((SELECT MAX(title)  FROM track_identity WHERE canonical_id = h.canonical_id), '') AS title,
                COUNT(*) AS play_count
         FROM listen_history h
         WHERE h.completed = 1 AND h.started_at >= ?1
         GROUP BY h.canonical_id
         ORDER BY play_count DESC, h.canonical_id ASC
         LIMIT ?2",
    ) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };

    let rows = stmt.query_map(rusqlite::params![cutoff, limit], |row| {
        Ok(ChartEntry {
            canonical_id: row.get(0)?,
            artist: row.get(1)?,
            title: row.get(2)?,
            play_count: row.get(3)?,
        })
    });

    match rows {
        Ok(mapped) => mapped.filter_map(|r| r.ok()).collect(),
        Err(_) => Vec::new(),
    }
}

/// Network-aggregated charts: local completed plays + peers' gossiped `top_tracks`,
/// summed by canonical_id. Peer data comes from the already-synced `peer_profiles`
/// table (JSON blobs), so this is a pure local read — no network call here.
///
/// No period filter: gossiped profiles are snapshots without per-play timestamps,
/// so community charts are all-time only.
// ponytail: reads whole peer_profiles table each call; add a materialized cache if
// profile counts ever get large enough to matter.
pub fn get_community_charts(conn: &Connection, limit: i32) -> Vec<ChartEntry> {
    // canonical_id -> (artist, title, summed play_count)
    let mut agg: HashMap<String, (String, String, i32)> = HashMap::new();

    let merge = |agg: &mut HashMap<String, (String, String, i32)>, e: ChartEntry| {
        let slot = agg
            .entry(e.canonical_id)
            .or_insert_with(|| (String::new(), String::new(), 0));
        slot.2 += e.play_count;
        if slot.0.is_empty() && !e.artist.is_empty() {
            slot.0 = e.artist;
        }
        if slot.1.is_empty() && !e.title.is_empty() {
            slot.1 = e.title;
        }
    };

    // Local contribution (all-time).
    for e in get_top_tracks(conn, "all", limit.max(0)) {
        merge(&mut agg, e);
    }

    // Peer contributions from stored profiles.
    if let Ok(mut stmt) = conn.prepare("SELECT profile_data FROM peer_profiles") {
        let rows = stmt.query_map([], |row| row.get::<_, String>(0));
        if let Ok(rows) = rows {
            for data in rows.filter_map(|r| r.ok()) {
                let profile: crate::taste_profile::TasteProfile = match serde_json::from_str(&data)
                {
                    Ok(p) => p,
                    Err(_) => continue, // skip malformed / old profiles without top_tracks
                };
                for e in profile.top_tracks {
                    merge(&mut agg, e);
                }
            }
        }
    }

    let mut entries: Vec<ChartEntry> = agg
        .into_iter()
        .map(|(canonical_id, (artist, title, play_count))| ChartEntry {
            canonical_id,
            artist,
            title,
            play_count,
        })
        .collect();
    entries.sort_by(|a, b| {
        b.play_count
            .cmp(&a.play_count)
            .then_with(|| a.canonical_id.cmp(&b.canonical_id))
    });
    entries.truncate(limit.max(0) as usize);
    entries
}

// ─── Tauri commands ───

#[tauri::command]
pub fn get_top_tracks_cmd(
    app: tauri::AppHandle,
    period: String,
    limit: i32,
) -> Result<Vec<ChartEntry>, String> {
    let db = app.state::<crate::db::Db>();
    let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
    Ok(get_top_tracks(&conn, &period, limit))
}

#[tauri::command]
pub fn get_community_charts_cmd(
    app: tauri::AppHandle,
    limit: i32,
) -> Result<Vec<ChartEntry>, String> {
    let db = app.state::<crate::db::Db>();
    let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
    Ok(get_community_charts(&conn, limit))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_db;
    use crate::history::record_listen;

    fn seed_identity(conn: &Connection, canonical_id: &str, artist: &str, title: &str) {
        conn.execute(
            "INSERT INTO track_identity (canonical_id, source, source_id, artist, title, duration)
             VALUES (?1, 'youtube', ?2, ?3, ?4, 200)",
            rusqlite::params![canonical_id, canonical_id, artist, title],
        )
        .unwrap();
    }

    #[test]
    fn test_top_tracks_ordering() {
        let db = test_db();
        let conn = db.0.lock().unwrap();
        let now = Utc::now().timestamp();

        for (id, plays) in [("aaa", 5), ("bbb", 3), ("ccc", 1)] {
            seed_identity(&conn, id, "Artist", id);
            for _ in 0..plays {
                record_listen(&conn, id, "youtube", now - 3600, 200, 200, true, false);
            }
        }
        // Non-completed listens must be excluded entirely.
        seed_identity(&conn, "ddd", "Artist", "ddd");
        record_listen(&conn, "ddd", "youtube", now - 3600, 200, 20, false, true);
        record_listen(&conn, "ddd", "youtube", now - 3600, 200, 20, false, true);

        let top = get_top_tracks(&conn, "week", 10);
        assert_eq!(top.len(), 3);
        assert_eq!(top[0].canonical_id, "aaa");
        assert_eq!(top[0].play_count, 5);
        assert_eq!(top[0].title, "aaa");
        assert_eq!(top[1].canonical_id, "bbb");
        assert_eq!(top[1].play_count, 3);
        assert_eq!(top[2].canonical_id, "ccc");
        assert_eq!(top[2].play_count, 1);
    }

    #[test]
    fn test_top_tracks_period_filtering() {
        let db = test_db();
        let conn = db.0.lock().unwrap();
        let now = Utc::now().timestamp();

        seed_identity(&conn, "eee", "A", "E");
        for _ in 0..3 {
            record_listen(
                &conn,
                "eee",
                "youtube",
                now - 2 * 86_400,
                200,
                200,
                true,
                false,
            );
        }
        seed_identity(&conn, "fff", "A", "F");
        for _ in 0..4 {
            record_listen(
                &conn,
                "fff",
                "youtube",
                now - 20 * 86_400,
                200,
                200,
                true,
                false,
            );
        }

        let week = get_top_tracks(&conn, "week", 10);
        assert_eq!(week.len(), 1);
        assert_eq!(week[0].canonical_id, "eee");

        let month = get_top_tracks(&conn, "month", 10);
        assert_eq!(month.len(), 2);
        assert_eq!(month[0].canonical_id, "fff"); // 4 > 3

        let all = get_top_tracks(&conn, "all", 10);
        assert_eq!(all.len(), 2);
    }

    #[test]
    fn test_top_tracks_limit() {
        let db = test_db();
        let conn = db.0.lock().unwrap();
        let now = Utc::now().timestamp();
        for (i, id) in ["a", "b", "c", "d", "e"].iter().enumerate() {
            seed_identity(&conn, id, "A", id);
            for _ in 0..(i + 1) {
                record_listen(&conn, id, "youtube", now - 3600, 200, 200, true, false);
            }
        }
        let top = get_top_tracks(&conn, "all", 3);
        assert_eq!(top.len(), 3);
        assert_eq!(top[0].canonical_id, "e"); // 5 plays
    }

    #[test]
    fn test_top_tracks_empty() {
        let db = test_db();
        let conn = db.0.lock().unwrap();
        assert!(get_top_tracks(&conn, "all", 10).is_empty());
    }

    #[test]
    fn test_top_tracks_dedupes_identity() {
        let db = test_db();
        let conn = db.0.lock().unwrap();
        let now = Utc::now().timestamp();

        // Two identity rows for the same canonical_id (different source_id).
        seed_identity(&conn, "dup", "Artist", "Song");
        conn.execute(
            "INSERT INTO track_identity (canonical_id, source, source_id, artist, title, duration)
             VALUES ('dup', 'local', '/x.mp3', 'Artist', 'Song', 200)",
            [],
        )
        .unwrap();

        for _ in 0..4 {
            record_listen(&conn, "dup", "youtube", now - 3600, 200, 200, true, false);
        }

        let top = get_top_tracks(&conn, "all", 10);
        assert_eq!(
            top.len(),
            1,
            "duplicate identity rows must not split the entry"
        );
        assert_eq!(
            top[0].play_count, 4,
            "play_count must not be inflated by the join"
        );
    }

    // Insert a peer profile JSON carrying the given top_tracks.
    fn seed_peer(conn: &Connection, hash: &str, top: &[(&str, &str, &str, i32)]) {
        let top_tracks: Vec<ChartEntry> = top
            .iter()
            .map(|(id, artist, title, n)| ChartEntry {
                canonical_id: id.to_string(),
                artist: artist.to_string(),
                title: title.to_string(),
                play_count: *n,
            })
            .collect();
        let data = serde_json::json!({
            "version": 1,
            "liked_hashes": [],
            "listen_pairs": [],
            "genre_weights": {},
            "total_listens": 0,
            "generated_at": 0,
            "top_tracks": top_tracks,
        })
        .to_string();
        crate::aggregator::store_peer_profile(conn, hash, &data);
    }

    #[test]
    fn test_community_merges_local_and_peers() {
        let db = test_db();
        let conn = db.0.lock().unwrap();
        let now = Utc::now().timestamp();

        // Local: track "x" played twice.
        seed_identity(&conn, "x", "ArtX", "SongX");
        for _ in 0..2 {
            record_listen(&conn, "x", "youtube", now - 3600, 200, 200, true, false);
        }

        // Peer 1: "x" +3, "y" +5. Peer 2: "x" +1.
        seed_peer(
            &conn,
            "p1",
            &[("x", "ArtX", "SongX", 3), ("y", "ArtY", "SongY", 5)],
        );
        seed_peer(&conn, "p2", &[("x", "ArtX", "SongX", 1)]);

        let top = get_community_charts(&conn, 10);
        assert_eq!(top.len(), 2);
        assert_eq!(top[0].canonical_id, "x", "x = 2+3+1 = 6 > y = 5");
        assert_eq!(top[0].play_count, 6);
        assert_eq!(top[1].canonical_id, "y");
        assert_eq!(top[1].play_count, 5);
    }

    #[test]
    fn test_community_uses_peer_metadata_for_unknown_track() {
        let db = test_db();
        let conn = db.0.lock().unwrap();
        // Track never heard locally — metadata must come from the peer profile.
        seed_peer(&conn, "p1", &[("z", "ArtZ", "SongZ", 4)]);
        let top = get_community_charts(&conn, 10);
        assert_eq!(top.len(), 1);
        assert_eq!(top[0].canonical_id, "z");
        assert_eq!(top[0].artist, "ArtZ");
        assert_eq!(top[0].title, "SongZ");
        assert_eq!(top[0].play_count, 4);
    }

    #[test]
    fn test_community_skips_malformed_peer_profiles() {
        let db = test_db();
        let conn = db.0.lock().unwrap();
        let now = Utc::now().timestamp();
        seed_identity(&conn, "x", "ArtX", "SongX");
        record_listen(&conn, "x", "youtube", now - 3600, 200, 200, true, false);

        crate::aggregator::store_peer_profile(&conn, "bad", "not json at all");
        // Old-format profile without top_tracks parses (serde default) and contributes nothing.
        crate::aggregator::store_peer_profile(&conn, "old", r#"{"liked_hashes":["x"]}"#);

        let top = get_community_charts(&conn, 10);
        assert_eq!(top.len(), 1);
        assert_eq!(top[0].play_count, 1, "only the local play counts");
    }

    #[test]
    fn test_community_respects_limit() {
        let db = test_db();
        let conn = db.0.lock().unwrap();
        seed_peer(
            &conn,
            "p1",
            &[("a", "A", "a", 5), ("b", "A", "b", 4), ("c", "A", "c", 3)],
        );
        let top = get_community_charts(&conn, 2);
        assert_eq!(top.len(), 2);
        assert_eq!(top[0].canonical_id, "a");
        assert_eq!(top[1].canonical_id, "b");
    }

    #[test]
    fn test_community_empty() {
        let db = test_db();
        let conn = db.0.lock().unwrap();
        assert!(get_community_charts(&conn, 10).is_empty());
    }
}
