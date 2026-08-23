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
