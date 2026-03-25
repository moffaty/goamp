use tauri::Manager;
mod commands;

const APTABASE_KEY: &str = "A-EU-4215436752";

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
        .invoke_handler(tauri::generate_handler![
            commands::files::scan_directory,
            commands::files::read_metadata,
        ])
        .setup(|app| {
            let win = app.get_webview_window("main").unwrap();
            let _ = win.maximize();
            Ok(())
        });

    if !APTABASE_KEY.is_empty() {
        builder = builder.plugin(tauri_plugin_aptabase::Builder::new(APTABASE_KEY).build());
    }

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
