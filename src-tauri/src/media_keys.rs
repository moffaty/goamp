use souvlaki::{MediaControlEvent, MediaControls, MediaMetadata, MediaPlayback, PlatformConfig};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

pub struct MediaControlsState {
    controls: Mutex<Option<MediaControls>>,
}

impl MediaControlsState {
    pub fn new() -> Self {
        Self {
            controls: Mutex::new(None),
        }
    }
}

pub fn setup(app: &AppHandle) {
    #[cfg(not(target_os = "windows"))]
    let hwnd = None;

    #[cfg(target_os = "windows")]
    let hwnd = {
        let window = app.get_webview_window("main").unwrap();
        window.hwnd().ok().map(|h| h.0 as *mut std::ffi::c_void)
    };

    let config = PlatformConfig {
        dbus_name: "goamp",
        display_name: "GOAMP",
        hwnd,
    };

    let controls = MediaControls::new(config);
    let mut controls = match controls {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[GOAMP] Failed to create media controls: {e}");
            return;
        }
    };

    let app_handle = app.clone();
    let attach_result = controls.attach(move |event: MediaControlEvent| {
        let action = match event {
            MediaControlEvent::Play => "play",
            MediaControlEvent::Pause => "pause",
            MediaControlEvent::Toggle => "play_pause",
            MediaControlEvent::Next => "next",
            MediaControlEvent::Previous => "prev",
            MediaControlEvent::Stop => "stop",
            _ => return,
        };
        let _ = app_handle.emit("media-action", action);
    });

    if let Err(e) = attach_result {
        eprintln!("[GOAMP] Failed to attach media controls: {e}");
        return;
    }

    let _ = controls.set_playback(MediaPlayback::Stopped);

    let state = app.state::<MediaControlsState>();
    *state.controls.lock().unwrap() = Some(controls);
}

#[tauri::command]
pub fn update_media_metadata(app: AppHandle, title: String, artist: String) {
    let state = app.state::<MediaControlsState>();
    let mut guard = state.controls.lock().unwrap();
    if let Some(controls) = guard.as_mut() {
        let _ = controls.set_metadata(MediaMetadata {
            title: Some(&title),
            artist: Some(&artist),
            ..Default::default()
        });
    }
}

#[tauri::command]
pub fn update_media_playback(app: AppHandle, playing: bool) {
    let state = app.state::<MediaControlsState>();
    let mut guard = state.controls.lock().unwrap();
    if let Some(controls) = guard.as_mut() {
        let playback = if playing {
            MediaPlayback::Playing { progress: None }
        } else {
            MediaPlayback::Paused { progress: None }
        };
        let _ = controls.set_playback(playback);
    }
}
