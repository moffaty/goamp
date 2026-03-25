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
    // Check next to the executable itself
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

    // Check resource dir (bundled builds)
    if let Ok(exe_dir) = app.path().resource_dir() {
        let name = if cfg!(target_os = "windows") {
            "yt-dlp.exe"
        } else {
            "yt-dlp"
        };
        let p = exe_dir.join(name);
        if p.exists() {
            return Ok(p);
        }
    }

    // Fall back to system PATH
    let check_cmd = if cfg!(target_os = "windows") { "where" } else { "which" };
    if let Ok(output) = std::process::Command::new(check_cmd)
        .arg("yt-dlp")
        .output()
    {
        if output.status.success() {
            return Ok(PathBuf::from("yt-dlp"));
        }
    }

    Err("yt-dlp not found. Place yt-dlp binary next to goamp executable or install it system-wide.".into())
}

fn new_command(program: &PathBuf) -> tokio::process::Command {
    let mut cmd = tokio::process::Command::new(program);
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

    // Hide console window on Windows
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    cmd
}

async fn run_ytdlp(app: &tauri::AppHandle, args: &[&str]) -> Result<std::process::Output, String> {
    let ytdlp = find_ytdlp(app)?;
    eprintln!("[GOAMP] yt-dlp: {} {:?}", ytdlp.display(), args);

    let output = new_command(&ytdlp)
        .args(args)
        .output()
        .await
        .map_err(|e| format!("Failed to run yt-dlp ({}): {}", ytdlp.display(), e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        eprintln!("[GOAMP] yt-dlp stderr: {}", stderr);
    }

    Ok(output)
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
    eprintln!("[GOAMP] extract_audio: video_id={}, cache={}", video_id, cache.display());

    // Return cached file if exists (any format)
    for ext in &["opus", "m4a", "webm", "ogg", "mp3", "wav"] {
        let p = cache.join(format!("{}.{}", video_id, ext));
        if p.exists() {
            eprintln!("[GOAMP] cache hit: {}", p.display());
            return Ok(p.to_string_lossy().to_string());
        }
    }

    let out_template = cache.join(format!("{}.%(ext)s", video_id));
    let out_template_str = out_template.to_string_lossy().to_string();
    let url = format!("https://www.youtube.com/watch?v={}", video_id);

    // Try with audio extraction (needs ffmpeg)
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

    // If -x failed (no ffmpeg), try downloading best audio directly
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        eprintln!("[GOAMP] extract with -x failed, trying direct download: {}", stderr);

        let output2 = run_ytdlp(&app, &[
            "-f", "bestaudio",
            "-o", &out_template_str,
            "--no-playlist",
            "--no-warnings",
            &url,
        ])
        .await?;

        if !output2.status.success() {
            let stderr2 = String::from_utf8_lossy(&output2.stderr);
            return Err(format!("yt-dlp extract error: {}", stderr2));
        }
    }

    // Find the downloaded file
    for ext in &["opus", "m4a", "webm", "ogg", "mp3", "wav"] {
        let p = cache.join(format!("{}.{}", video_id, ext));
        if p.exists() {
            eprintln!("[GOAMP] downloaded: {}", p.display());
            return Ok(p.to_string_lossy().to_string());
        }
    }

    // List what's actually in cache dir for debugging
    if let Ok(entries) = fs::read_dir(&cache) {
        let files: Vec<String> = entries
            .filter_map(|e| e.ok())
            .filter_map(|e| {
                let name = e.file_name().to_string_lossy().to_string();
                if name.starts_with(&video_id) { Some(name) } else { None }
            })
            .collect();
        eprintln!("[GOAMP] files matching video_id in cache: {:?}", files);

        // Return first match
        if let Some(name) = files.first() {
            let p = cache.join(name);
            return Ok(p.to_string_lossy().to_string());
        }
    }

    Err("Audio file not found after extraction".into())
}
