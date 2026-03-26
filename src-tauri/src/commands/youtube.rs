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
    pub source: String,
    pub webpage_url: String,
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
    webpage_url: Option<String>,
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

/// Directory for managed binaries (yt-dlp etc)
fn bin_dir(app: &tauri::AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("goamp"))
        .join("bin");
    let _ = fs::create_dir_all(&dir);
    dir
}

fn ytdlp_filename() -> &'static str {
    if cfg!(target_os = "windows") {
        "yt-dlp.exe"
    } else {
        "yt-dlp"
    }
}

/// Find yt-dlp: next to exe → app_data/bin → system PATH
fn find_ytdlp(app: &tauri::AppHandle) -> Option<PathBuf> {
    let name = ytdlp_filename();

    // Next to executable
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let p = dir.join(name);
            if p.exists() {
                return Some(p);
            }
        }
    }

    // In managed bin dir (auto-downloaded)
    let p = bin_dir(app).join(name);
    if p.exists() {
        return Some(p);
    }

    // System PATH
    let check_cmd = if cfg!(target_os = "windows") {
        "where"
    } else {
        "which"
    };
    if let Ok(output) = std::process::Command::new(check_cmd).arg("yt-dlp").output() {
        if output.status.success() {
            return Some(PathBuf::from("yt-dlp"));
        }
    }

    None
}

fn download_url() -> &'static str {
    if cfg!(target_os = "windows") {
        "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
    } else if cfg!(target_os = "macos") {
        "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos"
    } else {
        "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux"
    }
}

/// Download yt-dlp from GitHub releases into app_data/bin/
async fn download_ytdlp(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dest = bin_dir(app).join(ytdlp_filename());
    let url = download_url();

    eprintln!("[GOAMP] Downloading yt-dlp from {}", url);

    let response = reqwest::get(url)
        .await
        .map_err(|e| format!("Failed to download yt-dlp: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "yt-dlp download failed: HTTP {}",
            response.status()
        ));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read yt-dlp download: {}", e))?;

    fs::write(&dest, &bytes).map_err(|e| format!("Failed to save yt-dlp: {}", e))?;

    // Make executable on unix
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&dest, fs::Permissions::from_mode(0o755));
    }

    eprintln!(
        "[GOAMP] yt-dlp downloaded: {} ({} bytes)",
        dest.display(),
        bytes.len()
    );
    Ok(dest)
}

/// Get yt-dlp path, downloading if necessary
async fn ensure_ytdlp(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Some(path) = find_ytdlp(app) {
        return Ok(path);
    }
    download_ytdlp(app).await
}

fn new_command(program: &PathBuf) -> tokio::process::Command {
    let mut cmd = tokio::process::Command::new(program);
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    cmd
}

async fn run_ytdlp(app: &tauri::AppHandle, args: &[&str]) -> Result<std::process::Output, String> {
    let ytdlp = ensure_ytdlp(app).await?;
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
    limit: Option<u32>,
    source: Option<String>,
) -> Result<Vec<YoutubeResult>, String> {
    let count = limit.unwrap_or(20).min(100);
    let src = source.as_deref().unwrap_or("youtube");

    let search_query = match src {
        "soundcloud" => format!("scsearch{}:{}", count, query),
        _ => format!("ytsearch{}:{}", count, query),
    };

    let output = run_ytdlp(
        &app,
        &[
            &search_query,
            "--dump-json",
            "--flat-playlist",
            "--no-warnings",
        ],
    )
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

            // Filter out SoundCloud 30-second previews
            if src == "soundcloud" && duration <= 31.0 {
                return None;
            }

            let thumbnail = entry
                .thumbnail
                .or_else(|| {
                    entry
                        .thumbnails
                        .and_then(|t| t.into_iter().last())
                        .and_then(|t| t.url)
                })
                .unwrap_or_default();

            let webpage_url = entry.webpage_url.unwrap_or_default();

            Some(YoutubeResult {
                id,
                title,
                channel,
                duration,
                thumbnail,
                source: src.to_string(),
                webpage_url,
            })
        })
        .collect();

    Ok(results)
}

/// Extract audio from any yt-dlp supported URL (YouTube, SoundCloud, etc)
#[tauri::command]
pub async fn extract_audio_url(app: tauri::AppHandle, url: String) -> Result<String, String> {
    let cache = cache_dir(&app);
    // Use URL hash as filename
    let hash = format!("{:x}", fnv_hash(&url));
    let out_template = cache.join(&hash);

    // Check if already cached
    for ext in &["opus", "m4a", "mp3", "webm", "ogg"] {
        let path = out_template.with_extension(ext);
        if path.exists() {
            return Ok(path.to_string_lossy().to_string());
        }
    }

    // Try with -x first
    let out_arg = format!("{}.%(ext)s", out_template.display());
    let output = run_ytdlp(
        &app,
        &[
            &url,
            "-x",
            "--audio-format",
            "opus",
            "-o",
            &out_arg,
            "--no-warnings",
        ],
    )
    .await?;

    if output.status.success() {
        if let Some(path) = find_cached_file(&out_template) {
            return Ok(path);
        }
    }

    // Fallback: download bestaudio without conversion
    let output = run_ytdlp(
        &app,
        &[&url, "-f", "bestaudio", "-o", &out_arg, "--no-warnings"],
    )
    .await?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("download failed: {}", stderr));
    }

    find_cached_file(&out_template).ok_or_else(|| "file not found after download".into())
}

fn fnv_hash(input: &str) -> u64 {
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in input.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

fn find_cached_file(base: &std::path::Path) -> Option<String> {
    for ext in &["opus", "m4a", "mp3", "webm", "ogg", "wav"] {
        let path = base.with_extension(ext);
        if path.exists() {
            return Some(path.to_string_lossy().to_string());
        }
    }
    None
}

#[tauri::command]
pub async fn extract_audio(app: tauri::AppHandle, video_id: String) -> Result<String, String> {
    let cache = cache_dir(&app);
    eprintln!(
        "[GOAMP] extract_audio: video_id={}, cache={}",
        video_id,
        cache.display()
    );

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
    let output = run_ytdlp(
        &app,
        &[
            "-x",
            "--audio-format",
            "opus",
            "--audio-quality",
            "5",
            "-o",
            &out_template_str,
            "--no-playlist",
            "--no-warnings",
            &url,
        ],
    )
    .await?;

    // If -x failed (no ffmpeg), try downloading best audio directly
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        eprintln!(
            "[GOAMP] extract with -x failed, trying direct download: {}",
            stderr
        );

        let output2 = run_ytdlp(
            &app,
            &[
                "-f",
                "bestaudio",
                "-o",
                &out_template_str,
                "--no-playlist",
                "--no-warnings",
                &url,
            ],
        )
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
                if name.starts_with(&video_id) {
                    Some(name)
                } else {
                    None
                }
            })
            .collect();
        eprintln!("[GOAMP] files matching video_id in cache: {:?}", files);

        if let Some(name) = files.first() {
            let p = cache.join(name);
            return Ok(p.to_string_lossy().to_string());
        }
    }

    Err("Audio file not found after extraction".into())
}
