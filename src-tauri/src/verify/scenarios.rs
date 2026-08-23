use super::harness::{invoke, mock_app};

/// Scenario 4: a completed listen recorded through the real command must show up
/// at the top of the real charts query — UI-Rust-SQLite proven from the data side.
#[test]
fn a_completed_listen_reaches_the_charts() {
    let (app, webview) = mock_app();
    let now = chrono::Utc::now().timestamp();
    super::harness::seed_identity(
        &app,
        "top-track",
        "local",
        "top-track",
        "Boards of Canada",
        "Roygbiv",
    );

    for i in 0..2 {
        invoke(
            &webview,
            "record_track_listen",
            serde_json::json!({
                "canonicalId": "top-track",
                "source": "local",
                "startedAt": now - 600 - i,
                "durationSecs": 200,
                "listenedSecs": 200,
                "completed": true,
                "skippedEarly": false,
            }),
        )
        .expect("recording a listen must succeed");
    }

    // An incomplete listen must not count.
    invoke(
        &webview,
        "record_track_listen",
        serde_json::json!({
            "canonicalId": "skipped-track",
            "source": "local",
            "startedAt": now - 300,
            "durationSecs": 200,
            "listenedSecs": 12,
            "completed": false,
            "skippedEarly": true,
            "artist": "Nobody",
            "title": "Skipped",
        }),
    )
    .expect("recording a skip must succeed");

    let charts = invoke(
        &webview,
        "get_top_tracks_cmd",
        serde_json::json!({ "period": "week", "limit": 10 }),
    )
    .expect("charts query must succeed");

    let rows = charts.as_array().expect("charts return an array");
    assert_eq!(rows[0]["canonical_id"], "top-track");
    assert_eq!(rows[0]["play_count"], 2);
    assert!(
        !rows.iter().any(|r| r["canonical_id"] == "skipped-track"),
        "an incomplete listen must never appear in the charts: {rows:?}"
    );
}

/// The period filter is a real filter, not decoration.
#[test]
fn charts_respect_the_period_window() {
    let (_app, webview) = mock_app();
    let now = chrono::Utc::now().timestamp();

    invoke(
        &webview,
        "record_track_listen",
        serde_json::json!({
            "canonicalId": "old-track",
            "source": "local",
            "startedAt": now - 20 * 86_400,
            "durationSecs": 200,
            "listenedSecs": 200,
            "completed": true,
            "skippedEarly": false,
        }),
    )
    .expect("recording must succeed");

    let week = invoke(
        &webview,
        "get_top_tracks_cmd",
        serde_json::json!({ "period": "week", "limit": 10 }),
    )
    .expect("week query must succeed");
    let month = invoke(
        &webview,
        "get_top_tracks_cmd",
        serde_json::json!({ "period": "month", "limit": 10 }),
    )
    .expect("month query must succeed");

    assert!(
        week.as_array().expect("array").is_empty(),
        "20 days ago is outside the week window"
    );
    assert_eq!(
        month.as_array().expect("array").len(),
        1,
        "20 days ago is inside the month window"
    );
}

/// The like commands own `track_likes`, and `get_liked_tracks` reads it. This
/// pair is the contract; whether the UI currently calls it is a separate
/// question (it does not — see the plan's Task 5 notes).
#[test]
fn a_like_round_trips_through_the_like_commands() {
    let (app, webview) = mock_app();
    super::harness::seed_identity(&app, "liked", "local", "liked", "Artist", "Liked Song");

    let before = invoke(&webview, "get_liked_tracks", serde_json::json!({}))
        .expect("get_liked_tracks must succeed");
    assert!(
        before.as_array().expect("array").is_empty(),
        "nothing is liked before the command runs, got {before}"
    );

    invoke(
        &webview,
        "set_track_like",
        serde_json::json!({ "canonicalId": "liked", "liked": true }),
    )
    .expect("set_track_like must succeed");

    let after = invoke(&webview, "get_liked_tracks", serde_json::json!({}))
        .expect("get_liked_tracks must succeed");

    let ids: Vec<String> = after
        .as_array()
        .expect("array")
        .iter()
        .filter_map(|v| v.as_str().map(str::to_string))
        .collect();

    assert!(
        ids.iter().any(|id| id == "liked"),
        "a liked track must appear in get_liked_tracks, got {ids:?}"
    );
}

/// The recommender must return well-formed rows once there is history to work
/// with. Shape matters as much as content: RecEntry is a positional tuple, so a
/// field reorder in production would otherwise slip through silently.
#[test]
fn the_recommender_returns_well_formed_rows() {
    let (app, webview) = mock_app();
    let now = chrono::Utc::now().timestamp();

    // content_recommend needs at least two completed listens per track.
    for (id, artist, title) in [
        ("rec-a", "Portishead", "Roads"),
        ("rec-b", "Massive Attack", "Angel"),
        ("rec-c", "Tricky", "Hell Is Round The Corner"),
    ] {
        super::harness::seed_identity(&app, id, "local", id, artist, title);
        for i in 0..3 {
            invoke(
                &webview,
                "record_track_listen",
                serde_json::json!({
                    "canonicalId": id,
                    "source": "local",
                    "startedAt": now - 3600 - i,
                    "durationSecs": 200,
                    "listenedSecs": 200,
                    "completed": true,
                    "skippedEarly": false,
                }),
            )
            .expect("seeding must succeed");
        }
    }

    let recs = invoke(
        &webview,
        "get_hybrid_recommendations",
        serde_json::json!({ "limit": 20 }),
    )
    .expect("recommendations must succeed");

    let rows = recs.as_array().expect("recommendations return an array");
    assert!(
        !rows.is_empty(),
        "the recommender must return something once history exists"
    );

    for row in rows {
        let entry = row.as_array().expect("each RecEntry is a positional tuple");
        assert_eq!(entry.len(), 5, "RecEntry must have 5 fields, got {entry:?}");
        assert!(
            entry[0].as_str().is_some_and(|s| !s.is_empty()),
            "field 0 must be a non-empty canonical_id, got {entry:?}"
        );
        assert!(
            entry[1].is_number(),
            "field 1 must be the numeric score, got {entry:?}"
        );
    }
}
