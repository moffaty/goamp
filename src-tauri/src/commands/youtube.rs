use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;
use tauri_plugin_shell::ShellExt;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct YoutubeResult {
    pub id: String,
    pub title: String,
    pub channel: String,
    pub duration: f64,
    pub thumbnail: String,
}

#[derive(Debug, Deserialize)]
struct YtDlpEntry {
    id: Option<String>,
    title: Option<String>,
    channel: Option<String>,
    uploader: Option<String>,
    duration: Option<f64>,
    thumbnail: Option<String>,
    thumbnails: Option<Vec<YtDlpThumb>>,
}

#[derive(Debug, Deserialize)]
struct YtDlpThumb {
    url: Option<String>,
}

fn cache_dir(app: &tauri::AppHandle) -> PathBuf {
    let base = app.path().app_cache_dir().unwrap_or_else(|_| {
        std::env::temp_dir().join("goamp")
    });
    let dir = base.join("audio_cache");
    let _ = fs::create_dir_all(&dir);
    dir
}

#[tauri::command]
pub async fn search_youtube(
    app: tauri::AppHandle,
    query: String,
) -> Result<Vec<YoutubeResult>, String> {
    let shell = app.shell();

    let output = shell
        .sidecar("yt-dlp")
        .map_err(|e| format!("Failed to create sidecar: {}", e))?
        .args([
            &format!("ytsearch20:{}", query),
            "--dump-json",
            "--flat-playlist",
            "--no-warnings",
        ])
        .output()
        .await
        .map_err(|e| format!("Failed to run yt-dlp: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("yt-dlp error: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let results: Vec<YoutubeResult> = stdout
        .lines()
        .filter(|line| !line.trim().is_empty())
        .filter_map(|line| {
            let entry: YtDlpEntry = serde_json::from_str(line).ok()?;
            let id = entry.id?;
            let title = entry.title.unwrap_or_else(|| "Unknown".into());
            let channel = entry.channel
                .or(entry.uploader)
                .unwrap_or_else(|| "Unknown".into());
            let duration = entry.duration.unwrap_or(0.0);
            let thumbnail = entry.thumbnail
                .or_else(|| {
                    entry.thumbnails
                        .and_then(|t| t.into_iter().last())
                        .and_then(|t| t.url)
                })
                .unwrap_or_default();

            Some(YoutubeResult {
                id,
                title,
                channel,
                duration,
                thumbnail,
            })
        })
        .collect();

    Ok(results)
}

#[tauri::command]
pub async fn extract_audio(
    app: tauri::AppHandle,
    video_id: String,
) -> Result<String, String> {
    let cache = cache_dir(&app);
    let out_path = cache.join(format!("{}.opus", video_id));

    // Return cached file if exists
    if out_path.exists() {
        return Ok(out_path.to_string_lossy().to_string());
    }

    let out_template = cache.join(format!("{}.%(ext)s", video_id));
    let shell = app.shell();

    let output = shell
        .sidecar("yt-dlp")
        .map_err(|e| format!("Failed to create sidecar: {}", e))?
        .args([
            "-x",
            "--audio-format", "opus",
            "--audio-quality", "5",
            "-o", &out_template.to_string_lossy(),
            "--no-playlist",
            "--no-warnings",
            &format!("https://www.youtube.com/watch?v={}", video_id),
        ])
        .output()
        .await
        .map_err(|e| format!("Failed to run yt-dlp: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("yt-dlp extract error: {}", stderr));
    }

    // yt-dlp might output with different extension, find the actual file
    if out_path.exists() {
        return Ok(out_path.to_string_lossy().to_string());
    }

    // Check for other extensions yt-dlp might have used
    for ext in &["opus", "m4a", "webm", "ogg", "mp3"] {
        let p = cache.join(format!("{}.{}", video_id, ext));
        if p.exists() {
            return Ok(p.to_string_lossy().to_string());
        }
    }

    Err("Audio file not found after extraction".into())
}
