use rusqlite::Connection;
use sha2::{Digest, Sha256};

/// Normalize artist/title: lowercase, trim, collapse whitespace, strip common diacritics.
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
    let result = hasher.finalize();
    result.iter().map(|b| format!("{:02x}", b)).collect()
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

    // 2. Insert new source mapping (canonical_id may already exist from another source)
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

/// Update peer_count for all entries with a given canonical_id.
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
    )
    .unwrap_or(false)
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
        assert_eq!(id.len(), 64); // SHA-256 hex
        assert_eq!(id, canonical_hash("Rick Astley", "Never Gonna Give You Up"));
        assert_eq!(id, canonical_hash("rick astley", "never gonna give you up"));
        assert_eq!(
            id,
            canonical_hash("  Rick Astley  ", " Never Gonna Give You Up ")
        );
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

        let id = resolve_or_create(
            &conn,
            "youtube",
            "dQw4w9WgXcQ",
            "Rick Astley",
            "Never Gonna Give You Up",
            213.0,
        );
        assert!(!id.is_empty());

        let id2 = resolve_or_create(
            &conn,
            "youtube",
            "dQw4w9WgXcQ",
            "Rick Astley",
            "Never Gonna Give You Up",
            213.0,
        );
        assert_eq!(id, id2);

        let id3 = resolve_or_create(
            &conn,
            "soundcloud",
            "sc-12345",
            "Rick Astley",
            "Never Gonna Give You Up",
            213.0,
        );
        assert_eq!(id, id3);
    }

    #[test]
    fn test_resolve_updates_peer_count_on_existing_canonical() {
        let db = crate::db::test_db();
        let conn = db.0.lock().unwrap();

        resolve_or_create(&conn, "youtube", "vid1", "Artist", "Track", 180.0);
        resolve_or_create(&conn, "soundcloud", "sc1", "Artist", "Track", 180.0);

        let count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM track_identity WHERE canonical_id = ?1",
                [canonical_hash("Artist", "Track")],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 2);
    }

    #[test]
    fn test_musicbrainz_id_propagates() {
        let db = crate::db::test_db();
        let conn = db.0.lock().unwrap();

        let cid = resolve_or_create(&conn, "youtube", "vid1", "Artist", "Track", 180.0);
        resolve_or_create(&conn, "soundcloud", "sc1", "Artist", "Track", 180.0);

        set_musicbrainz_id(&conn, &cid, "mb-uuid-123");

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

        let cid = resolve_or_create(&conn, "local", "/music/rare.mp3", "Unknown", "Rare", 240.0);
        assert!(!is_aggregation_eligible(&conn, &cid, 3));

        update_peer_count(&conn, &cid, 5);
        assert!(is_aggregation_eligible(&conn, &cid, 3));

        let cid2 = resolve_or_create(&conn, "youtube", "vid2", "Known", "Song", 200.0);
        set_musicbrainz_id(&conn, &cid2, "mb-456");
        assert!(is_aggregation_eligible(&conn, &cid2, 100));
    }
}
