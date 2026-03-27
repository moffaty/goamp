use tauri::Manager;

mod commands;
mod db;
mod feature_flags;
mod hook;
mod md5;
mod media_keys;
mod scrobble;
mod tray;
mod yandex;

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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(media_keys::MediaControlsState::new())
        .invoke_handler(tauri::generate_handler![
            commands::files::scan_directory,
            commands::files::read_metadata,
            commands::youtube::search_youtube,
            commands::youtube::extract_audio,
            commands::youtube::extract_audio_url,
            commands::playlists::create_playlist,
            commands::playlists::list_playlists,
            commands::playlists::get_playlist_tracks,
            commands::playlists::add_track_to_playlist,
            commands::playlists::remove_track_from_playlist,
            commands::playlists::delete_playlist,
            commands::playlists::save_session,
            commands::playlists::load_session,
            commands::playlists::rename_track,
            tray::update_tray_tooltip,
            media_keys::update_media_metadata,
            media_keys::update_media_playback,
            scrobble::lastfm_get_auth_url,
            scrobble::lastfm_auth,
            scrobble::lastfm_now_playing,
            scrobble::lastfm_scrobble,
            scrobble::lastfm_save_settings,
            scrobble::lastfm_get_status,
            scrobble::listenbrainz_save_token,
            scrobble::listenbrainz_get_status,
            scrobble::listenbrainz_logout,
            scrobble::listenbrainz_now_playing,
            scrobble::listenbrainz_scrobble,
            scrobble::scrobble_get_status,
            scrobble::scrobble_flush_queue,
            yandex::yandex_save_token,
            yandex::yandex_request_device_code,
            yandex::yandex_poll_token,
            yandex::yandex_refresh_token,
            yandex::yandex_get_status,
            yandex::yandex_logout,
            yandex::yandex_search,
            yandex::yandex_get_track_url,
            yandex::yandex_list_stations,
            yandex::yandex_station_tracks,
            yandex::yandex_list_playlists,
            yandex::yandex_get_playlist_tracks,
            yandex::yandex_import_playlist,
            yandex::yandex_download_track,
            yandex::yandex_download_playlist,
            yandex::yandex_get_liked_tracks,
            yandex::yandex_get_track_urls,
            yandex::yandex_open_oauth_window,
            yandex::yandex_like_track,
            feature_flags::feature_flags_list,
            feature_flags::feature_flags_set,
            feature_flags::feature_flag_get,
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
