use super::harness::{invoke, mock_app};
use std::path::PathBuf;

fn golden_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("src-tauri has a parent")
        .join("e2e/golden")
}

/// Where per-command *argument shapes* live — separate from the response
/// goldens (`<cmd>.json`) so this can be added without touching the shape of
/// any existing golden file or its consumers (`e2e/golden/index.json` is
/// still built only from the top-level `<cmd>.json` response files).
fn args_dir() -> PathBuf {
    golden_dir().join("args")
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
        ("load_session", serde_json::json!({})),
        ("get_seed_enabled", serde_json::json!({})),
    ]
}

/// Write-commands (no meaningful read response, so no `<cmd>.json`) whose
/// *argument shape* the shim still needs, so an L2 test can catch a renamed,
/// dropped, or retyped frontend argument the same way L1 already catches a
/// backend rename. Each args value here is a real payload the backend in
/// `mock_app()` is proven (by this file's tests) to accept.
fn write_command_cases() -> Vec<(&'static str, serde_json::Value)> {
    vec![
        (
            "record_track_listen",
            serde_json::json!({
                "canonicalId": "args-shape-track",
                "source": "local",
                "startedAt": 0,
                "durationSecs": 200,
                "listenedSecs": 200,
                "completed": true,
                "skippedEarly": false,
            }),
        ),
        (
            "record_track_signal",
            serde_json::json!({
                "canonicalId": "args-shape-track",
                "signal": 1,
                "scope": "global",
            }),
        ),
        (
            "set_track_like",
            serde_json::json!({
                "canonicalId": "args-shape-track",
                "liked": true,
            }),
        ),
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

/// Records, per gate command, the argument shape the real backend accepted —
/// `e2e/golden/args/<cmd>.json`. `e2e/shim/tauri.ts` validates incoming L2
/// `invoke()` args against these shapes (exact key set, matching `typeof` per
/// value), so a frontend argument rename/drop/retype fails loudly in L2
/// instead of silently replaying golden data for the wrong request. Covers
/// every `cases()` command plus the write-commands that have no read
/// response to pin (`write_command_cases()`).
#[test]
fn argument_shapes_match_the_real_backend() {
    let (app, webview) = mock_app();
    super::harness::seed_identity(
        &app,
        "args-shape-track",
        "local",
        "args-shape-track",
        "Arg Shape",
        "Fixture Track",
    );

    let regenerate = std::env::var("GOAMP_GOLDEN_REGENERATE").is_ok();
    std::fs::create_dir_all(args_dir()).expect("args dir is creatable");

    for (cmd, args) in cases().into_iter().chain(write_command_cases()) {
        // Prove the backend actually accepts this shape — the whole point is
        // that the recorded shape is one the real command signature agrees
        // with, not an arbitrary guess.
        invoke(&webview, cmd, args.clone())
            .unwrap_or_else(|e| panic!("`{cmd}` rejected its own recorded argument shape: {e}"));

        let pretty = serde_json::to_string_pretty(&args).expect("serializable");
        let path = args_dir().join(format!("{cmd}.json"));

        if regenerate {
            std::fs::write(&path, format!("{pretty}\n")).expect("args golden is writable");
            continue;
        }

        let expected = std::fs::read_to_string(&path).unwrap_or_else(|_| {
            panic!("missing argument-shape golden for `{cmd}` — run `make verify-golden`")
        });
        assert_eq!(
            expected.trim(),
            pretty.trim(),
            "`{cmd}`'s argument shape drifted — run `make verify-golden` if the change is intended"
        );
    }
}

/// `e2e/golden/index.json` (built by the `node -e` one-liner in
/// `make verify-golden`) is what the shim actually reads at L2. Nothing else
/// checks it still agrees with the individual `<cmd>.json` files it was
/// built from — a stale index would silently feed L2 old backend data while
/// L1 (which only reads the individual files) stayed green. This test reads
/// both the same way the index-builder does and requires them to match
/// exactly: same command set, same values.
#[test]
fn golden_index_matches_the_individual_files() {
    let index_path = golden_dir().join("index.json");
    let index_raw = std::fs::read_to_string(&index_path)
        .unwrap_or_else(|_| panic!("missing {index_path:?} — run `make verify-golden`"));
    let index: serde_json::Value =
        serde_json::from_str(&index_raw).expect("index.json must be valid JSON");
    let index = index.as_object().expect("index.json must be a JSON object");

    let mut expected_commands: Vec<&str> = cases().iter().map(|(cmd, _)| *cmd).collect();
    expected_commands.sort_unstable();
    let mut index_commands: Vec<&str> = index.keys().map(String::as_str).collect();
    index_commands.sort_unstable();
    assert_eq!(
        expected_commands, index_commands,
        "index.json's command set must match the individual golden files exactly"
    );

    for cmd in expected_commands {
        let path = golden_dir().join(format!("{cmd}.json"));
        let file_raw =
            std::fs::read_to_string(&path).unwrap_or_else(|_| panic!("missing golden for `{cmd}`"));
        let file_value: serde_json::Value = serde_json::from_str(&file_raw)
            .unwrap_or_else(|e| panic!("`{cmd}.json` is not valid JSON: {e}"));
        let index_value = index
            .get(cmd)
            .unwrap_or_else(|| panic!("`{cmd}` missing from index.json"));
        assert_eq!(
            &file_value, index_value,
            "index.json[\"{cmd}\"] no longer matches e2e/golden/{cmd}.json — run `make verify-golden`"
        );
    }
}
