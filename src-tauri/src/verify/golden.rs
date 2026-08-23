use super::harness::{invoke, mock_app};
use std::path::PathBuf;

fn golden_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("src-tauri has a parent")
        .join("e2e/golden")
}

/// Commands whose responses the UI layer replays, with the arguments used to
/// produce them. Seeded state comes from `seed`.
fn cases() -> Vec<(&'static str, serde_json::Value)> {
    vec![
        ("feature_flags_list", serde_json::json!({})),
        ("list_playlists", serde_json::json!({})),
        (
            "get_top_tracks_cmd",
            serde_json::json!({ "period": "all", "limit": 50 }),
        ),
        (
            "get_community_charts_cmd",
            serde_json::json!({ "limit": 50 }),
        ),
        (
            "get_hybrid_recommendations",
            serde_json::json!({ "limit": 20 }),
        ),
        ("get_liked_tracks", serde_json::json!({})),
        ("build_profile", serde_json::json!({})),
    ]
}

/// Puts two completed listens in history so charts and recommendations have
/// something to return. Offsets are relative to now — never absolute dates —
/// so the week/month windows stay valid forever.
fn seed(
    app: &tauri::App<tauri::test::MockRuntime>,
    webview: &tauri::WebviewWindow<tauri::test::MockRuntime>,
) {
    let now = chrono::Utc::now().timestamp();
    for (id, artist, title, plays) in [
        ("aaa", "Portishead", "Roads", 3),
        ("bbb", "Massive Attack", "Angel", 1),
    ] {
        // Artist/title live in track_identity — record_track_listen does not
        // carry them — so seed identity directly, then record listens over IPC.
        super::harness::seed_identity(app, id, "local", id, artist, title);
        for i in 0..plays {
            invoke(
                webview,
                "record_track_listen",
                serde_json::json!({
                    "canonicalId": id,
                    "source": "local",
                    "startedAt": now - 3600 - i,
                    "durationSecs": 240,
                    "listenedSecs": 240,
                    "completed": true,
                    "skippedEarly": false,
                }),
            )
            .unwrap_or_else(|e| panic!("seeding {id} failed: {e}"));
        }
    }
}

/// `build_profile` stamps its response with `chrono::Utc::now()` (see
/// `taste_profile.rs`), so the raw response can never be byte-stable across
/// two test runs — not even two runs with an unchanged backend. Golden files
/// are meant to catch real drift, not the wall clock, so pin any
/// `generated_at` field to a fixed sentinel before writing or comparing.
fn normalize(mut value: serde_json::Value) -> serde_json::Value {
    if let Some(obj) = value.as_object_mut() {
        if obj.contains_key("generated_at") {
            obj.insert("generated_at".to_string(), serde_json::json!(0));
        }
    }
    value
}

#[test]
fn golden_matches_the_real_backend() {
    let (app, webview) = mock_app();
    seed(&app, &webview);

    let regenerate = std::env::var("GOAMP_GOLDEN_REGENERATE").is_ok();
    std::fs::create_dir_all(golden_dir()).expect("golden dir is creatable");

    for (cmd, args) in cases() {
        let actual = invoke(&webview, cmd, args).unwrap_or_else(|e| panic!("`{cmd}` failed: {e}"));
        let actual = normalize(actual);
        let pretty = serde_json::to_string_pretty(&actual).expect("serializable");
        let path = golden_dir().join(format!("{cmd}.json"));

        if regenerate {
            std::fs::write(&path, format!("{pretty}\n")).expect("golden is writable");
            continue;
        }

        let expected = std::fs::read_to_string(&path)
            .unwrap_or_else(|_| panic!("missing golden for `{cmd}` — run `make verify-golden`"));
        assert_eq!(
            expected.trim(),
            pretty.trim(),
            "`{cmd}` drifted from its golden — run `make verify-golden` if the change is intended"
        );
    }
}
