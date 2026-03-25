use tauri::Manager;

mod commands;
mod hook;

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
        .invoke_handler(tauri::generate_handler![
            commands::files::scan_directory,
            commands::files::read_metadata,
            commands::youtube::search_youtube,
            commands::youtube::extract_audio,
        ])
        .setup(|app| {
            let window = app.get_webview_window("main").unwrap();
            let _ = window.maximize();
            hook::start_global_mouse_stream(window);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
