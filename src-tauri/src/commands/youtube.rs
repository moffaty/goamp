use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::process::Stdio;
use tauri::Manager;

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
    let base = app
        .path()
        .app_cache_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("goamp"));
    let dir = base.join("audio_cache");
    let _ = fs::create_dir_all(&dir);
    dir
}

/// Find yt-dlp binary: sidecar next to exe, then system PATH
fn find_ytdlp(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    // 1. Check sidecar next to the executable
    if let Ok(exe_dir) = app.path().resource_dir() {
        let candidates = if cfg!(target_os = "windows") {
            vec!["yt-dlp.exe"]
        } else {
            vec!["yt-dlp"]
        };
        for name in &candidates {
            let p = exe_dir.join(name);
            if p.exists() {
                return Ok(p);
            }
        }
    }

    // Also check next to the executable itself
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let name = if cfg!(target_os = "windows") {
                "yt-dlp.exe"
            } else {
                "yt-dlp"
            };
            let p = dir.join(name);
            if p.exists() {
                return Ok(p);
            }
        }
    }

    // 2. Fall back to system PATH
    let name = if cfg!(target_os = "windows") {
        "yt-dlp.exe"
    } else {
        "yt-dlp"
    };

    // Check if it exists in PATH
    if let Ok(output) = std::process::Command::new(if cfg!(target_os = "windows") { "where" } else { "which" })
        .arg("yt-dlp")
        .output()
    {
        if output.status.success() {
            return Ok(PathBuf::from(name));
        }
    }

    Err("yt-dlp not found. Place yt-dlp binary next to goamp executable or install it system-wide.".into())
}

async fn run_ytdlp(app: &tauri::AppHandle, args: &[&str]) -> Result<std::process::Output, String> {
    let ytdlp = find_ytdlp(app)?;

    tokio::process::Command::new(&ytdlp)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("Failed to run yt-dlp ({}): {}", ytdlp.display(), e))
}

#[tauri::command]
pub async fn search_youtube(
    app: tauri::AppHandle,
    query: String,
) -> Result<Vec<YoutubeResult>, String> {
    let search_query = format!("ytsearch20:{}", query);
    let output = run_ytdlp(&app, &[
        &search_query,
        "--dump-json",
        "--flat-playlist",
        "--no-warnings",
    ])
    .await?;

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
            let channel = entry
                .channel
                .or(entry.uploader)
                .unwrap_or_else(|| "Unknown".into());
            let duration = entry.duration.unwrap_or(0.0);
            let thumbnail = entry
                .thumbnail
                .or_else(|| {
                    entry
                        .thumbnails
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
    let out_template_str = out_template.to_string_lossy().to_string();
    let url = format!("https://www.youtube.com/watch?v={}", video_id);

    let output = run_ytdlp(&app, &[
        "-x",
        "--audio-format", "opus",
        "--audio-quality", "5",
        "-o", &out_template_str,
        "--no-playlist",
        "--no-warnings",
        &url,
    ])
    .await?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("yt-dlp extract error: {}", stderr));
    }

    // yt-dlp might output with different extension, find the actual file
    for ext in &["opus", "m4a", "webm", "ogg", "mp3"] {
        let p = cache.join(format!("{}.{}", video_id, ext));
        if p.exists() {
            return Ok(p.to_string_lossy().to_string());
        }
    }

    Err("Audio file not found after extraction".into())
}
