use tauri::Manager;

mod aggregator;
mod commands;
mod db;
mod feature_flags;
mod history;
#[cfg(not(target_os = "android"))]
mod hook;
mod md5;
#[cfg(not(target_os = "android"))]
mod media_keys;
#[cfg(desktop)]
mod node;
mod radio;
mod recommend;
mod scrobble;
mod survey;
mod sybil;
mod taste_profile;
mod track_id;
#[cfg(desktop)]
mod tray;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _sentry_guard = sentry::init(sentry::ClientOptions {
        // TODO: set your Sentry DSN
        // dsn: "https://...@sentry.io/...".parse().ok(),
        release: Some("goamp@0.1.0".into()),
        ..Default::default()
    });

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(radio::RadioStreamState::new())
        .manage(node::NodeProcess::new());

    #[cfg(not(target_os = "android"))]
    {
        builder = builder.manage(media_keys::MediaControlsState::new());
    }

    builder
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
            #[cfg(desktop)]
            tray::update_tray_tooltip,
            #[cfg(not(target_os = "android"))]
            media_keys::update_media_metadata,
            #[cfg(not(target_os = "android"))]
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
            commands::playlists::update_track_source,
            commands::playlists::list_genres,
            commands::playlists::get_tracks_by_genre,
            commands::youtube::youtube_set_cookies,
            commands::youtube::youtube_get_cookies,
            commands::youtube::youtube_clear_cookies,
            commands::youtube::youtube_get_playlist,
            feature_flags::feature_flags_list,
            feature_flags::feature_flags_set,
            feature_flags::feature_flag_get,
            radio::radio_search,
            radio::radio_top_stations,
            radio::radio_by_tag,
            radio::radio_tags,
            radio::radio_add_favorite,
            radio::radio_remove_favorite,
            radio::radio_list_favorites,
            radio::radio_add_custom,
            radio::radio_remove_custom,
            radio::radio_list_custom,
            radio::radio_play,
            radio::radio_stop,
            radio::radio_now_playing,
            radio::radio_list_cached,
            radio::radio_save_segment,
            radio::radio_save_last_secs,
            track_id::resolve_track_id,
            history::record_track_listen,
            history::set_track_like,
            history::remove_track_like,
            history::get_track_stats,
            history::get_liked_tracks,
            survey::survey_get_pending,
            survey::survey_respond,
            survey::survey_skip,
            survey::survey_mark_shown,
            taste_profile::build_profile,
            aggregator::sync_profile,
            aggregator::get_recommendations,
            recommend::get_hybrid_recommendations,
            recommend::get_coldstart_recommendations,
            recommend::list_mood_channels,
            recommend::create_mood_channel,
            recommend::add_seed_track,
            recommend::delete_mood_channel,
        ])
        .setup(|app| {
            db::init(app).expect("failed to initialize database");

            // Spawn the GOAMP P2P node sidecar (desktop only)
            #[cfg(desktop)]
            if let Err(e) = node::start_node(app.handle()) {
                eprintln!("[goamp] failed to start node sidecar: {e}");
            }

            #[cfg(desktop)]
            {
                let handle = app.handle();
                tray::setup(handle).expect("failed to setup tray");

                #[cfg(not(target_os = "android"))]
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

                #[cfg(not(target_os = "android"))]
                hook::start_global_mouse_stream(window);
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
