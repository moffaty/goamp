use tauri::Manager;

mod commands;
mod db;
mod hook;
mod media_keys;
mod tray;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _sentry_guard = sentry::init(sentry::ClientOptions {
        // TODO: set your Sentry DSN
        // dsn: "https://...@sentry.io/...".parse().ok(),
        release: Some("goamp@0.1.0".into()),
        ..Default::default()
    });

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .manage(media_keys::MediaControlsState::new())
        .invoke_handler(tauri::generate_handler![
            commands::files::scan_directory,
            commands::files::read_metadata,
            commands::youtube::search_youtube,
            commands::youtube::extract_audio,
            commands::playlists::create_playlist,
            commands::playlists::list_playlists,
            commands::playlists::get_playlist_tracks,
            commands::playlists::add_track_to_playlist,
            commands::playlists::remove_track_from_playlist,
            commands::playlists::delete_playlist,
            commands::playlists::save_session,
            commands::playlists::load_session,
            tray::update_tray_tooltip,
            media_keys::update_media_metadata,
            media_keys::update_media_playback,
        ])
        .setup(|app| {
            db::init(app).expect("failed to initialize database");

            let handle = app.handle();
            tray::setup(handle).expect("failed to setup tray");
            media_keys::setup(handle);

            let window = app.get_webview_window("main").unwrap();

            // Close-to-tray: hide window instead of closing
            let app_handle = handle.clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    if let Some(w) = app_handle.get_webview_window("main") {
                        let _ = w.hide();
                    }
                }
            });

            let _ = window.maximize();
            hook::start_global_mouse_stream(window);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
