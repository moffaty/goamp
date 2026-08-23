use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{mock_builder, mock_context, noop_assets, MockRuntime, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::{App, Manager, WebviewWindow, WebviewWindowBuilder};

/// The commands the gate invokes for real. Every name here must also appear in
/// the production handler in `lib.rs` — `verify::registration` enforces that.
pub const GATE_COMMANDS: &[&str] = &[
    "feature_flags_list",
    "list_playlists",
    "get_top_tracks_cmd",
    "get_community_charts_cmd",
    "get_hybrid_recommendations",
    "record_track_listen",
    "get_liked_tracks",
    "build_profile",
    "record_track_signal",
];

/// A mock app carrying the gate's commands and a fresh in-memory database.
pub fn mock_app() -> (App<MockRuntime>, WebviewWindow<MockRuntime>) {
    let app = mock_builder()
        .invoke_handler(tauri::generate_handler![
            crate::feature_flags::feature_flags_list,
            crate::commands::playlists::list_playlists,
            crate::charts::get_top_tracks_cmd,
            crate::charts::get_community_charts_cmd,
            crate::recommend::get_hybrid_recommendations,
            crate::history::record_track_listen,
            crate::history::get_liked_tracks,
            crate::taste_profile::build_profile,
            crate::commands::mood::record_track_signal,
        ])
        .manage(crate::db::test_db())
        .build(mock_context(noop_assets()))
        .expect("failed to build mock app");

    let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("failed to build mock webview");

    (app, webview)
}

/// Seeds a track's identity (artist/title) straight through the managed
/// database. Fixture setup, not the thing under test: the real
/// `resolve_track_id` command is async and can reach out to MusicBrainz, which
/// the offline constraint forbids. Everything under test still goes over IPC.
pub fn seed_identity(
    app: &App<MockRuntime>,
    canonical_id: &str,
    source: &str,
    source_id: &str,
    artist: &str,
    title: &str,
) {
    let db = app.state::<crate::db::Db>();
    let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
    conn.execute(
        "INSERT OR REPLACE INTO track_identity (canonical_id, source, source_id, artist, title)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![canonical_id, source, source_id, artist, title],
    )
    .expect("seeding track_identity must succeed");
}

/// Invoke a command through the real IPC path. `args` is the command's argument
/// object; pass `serde_json::json!({})` for none.
pub fn invoke(
    webview: &WebviewWindow<MockRuntime>,
    cmd: &str,
    args: serde_json::Value,
) -> Result<serde_json::Value, serde_json::Value> {
    tauri::test::get_ipc_response(
        webview,
        InvokeRequest {
            cmd: cmd.into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: "http://tauri.localhost".parse().unwrap(),
            body: InvokeBody::Json(args),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        },
    )
    .map(|b| {
        b.deserialize::<serde_json::Value>()
            .unwrap_or(serde_json::Value::Null)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn feature_flags_list_answers_over_real_ipc() {
        let (_app, webview) = mock_app();

        let res = invoke(&webview, "feature_flags_list", serde_json::json!({}))
            .expect("feature_flags_list must succeed");

        assert!(res.is_array(), "expected an array of flags, got {res}");
    }

    #[test]
    fn every_gate_command_is_reachable() {
        let (_app, webview) = mock_app();

        for cmd in GATE_COMMANDS {
            // Empty args: most commands reject them, and that is fine. What must
            // never happen is Tauri reporting the command does not exist.
            if let Err(e) = invoke(&webview, cmd, serde_json::json!({})) {
                let msg = e.to_string();
                assert!(
                    !msg.contains("not found"),
                    "gate command `{cmd}` is not reachable over IPC: {msg}"
                );
            }
        }
    }
}
