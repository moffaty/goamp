use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::process::Stdio;
use tauri::Manager;

use crate::db::Db;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct YoutubeResult {
    pub id: String,
    pub title: String,
    pub channel: String,
    pub duration: f64,
    pub thumbnail: String,
    pub source: String,
    pub webpage_url: String,
    pub genre: String,
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
    genre: Option<String>,
    categories: Option<Vec<String>>,
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

    let mut args: Vec<String> = cookies_args(&app);
    args.extend([
        search_query,
        "--dump-json".to_string(),
        "--flat-playlist".to_string(),
        "--no-warnings".to_string(),
    ]);
    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let output = run_ytdlp(&app, &arg_refs).await?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("yt-dlp error: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(parse_entries(&stdout, src))
}

/// Infer the logical source from a page/playlist URL host.
fn infer_source(url: &str) -> &'static str {
    if url.contains("soundcloud.com") {
        "soundcloud"
    } else {
        "youtube"
    }
}

/// Parse one yt-dlp `--dump-json` line into a YoutubeResult, or None if unusable
/// (missing id, or a SoundCloud ≤31s preview). Pure — unit-testable without yt-dlp.
fn parse_entry(line: &str, src: &str) -> Option<YoutubeResult> {
    let entry: YtDlpEntry = serde_json::from_str(line).ok()?;
    let id = entry.id?;
    let title = entry.title.unwrap_or_else(|| "Unknown".into());
    let channel = entry
        .channel
        .or(entry.uploader)
        .unwrap_or_else(|| "Unknown".into());
    let duration = entry.duration.unwrap_or(0.0);

    // Filter out SoundCloud 30-second previews (unauthenticated).
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

    // Genre: prefer explicit genre field (SoundCloud), fall back to first category (YouTube).
    let genre = entry
        .genre
        .or_else(|| entry.categories.and_then(|c| c.into_iter().next()))
        .unwrap_or_default();

    Some(YoutubeResult {
        id,
        title,
        channel,
        duration,
        thumbnail,
        source: src.to_string(),
        webpage_url,
        genre,
    })
}

/// Parse a full yt-dlp `--dump-json` stdout (one JSON object per line).
fn parse_entries(stdout: &str, src: &str) -> Vec<YoutubeResult> {
    stdout
        .lines()
        .filter(|line| !line.trim().is_empty())
        .filter_map(|line| parse_entry(line, src))
        .collect()
}

/// Import a whole playlist/album/set by URL (SoundCloud set, YouTube playlist, …).
/// Uses a full (non-flat) `--dump-json` so each track carries title + duration —
/// SoundCloud sets return nothing useful under `--flat-playlist`. Source is inferred
/// from the URL host, so cross-profile re-uploads import the same way.
#[tauri::command]
pub async fn import_playlist(
    app: tauri::AppHandle,
    url: String,
) -> Result<Vec<YoutubeResult>, String> {
    let src = infer_source(&url);
    let mut args: Vec<String> = cookies_args(&app);
    args.extend([
        url,
        "--dump-json".to_string(),
        "--no-warnings".to_string(),
        // Keep emitting good tracks even if one entry in the set fails to resolve.
        "--ignore-errors".to_string(),
    ]);
    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let output = run_ytdlp(&app, &arg_refs).await?;

    // yt-dlp may exit non-zero on a partial failure while still printing usable
    // tracks, so parse stdout regardless and only error when nothing came back.
    let stdout = String::from_utf8_lossy(&output.stdout);
    let results = parse_entries(&stdout, src);
    if results.is_empty() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("no tracks found for playlist: {}", stderr));
    }
    Ok(results)
}

/// Build a filesystem-safe `Artist - Title` stem. Pure — unit-testable.
fn sanitize_filename(artist: &str, title: &str) -> String {
    let a = artist.trim();
    let t = title.trim();
    let stem = match (a.is_empty(), t.is_empty()) {
        (false, false) => format!("{a} - {t}"),
        (true, false) => t.to_string(),
        (false, true) => a.to_string(),
        (true, true) => String::new(),
    };

    // Drop chars illegal on Windows/macOS/Linux + control chars; collapse whitespace.
    let mut out = String::with_capacity(stem.len());
    let mut prev_space = false;
    for c in stem.chars() {
        let bad =
            matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || c.is_control();
        let ch = if bad || c.is_whitespace() { ' ' } else { c };
        if ch == ' ' {
            if prev_space {
                continue;
            }
            prev_space = true;
        } else {
            prev_space = false;
        }
        out.push(ch);
    }
    let out = out.trim().to_string();

    // Cap length (char-safe), then fall back if nothing usable remains.
    let capped: String = out.chars().take(120).collect();
    let capped = capped.trim().to_string();
    // Fall back when nothing meaningful survived (empty, or only separators like "-").
    if capped.chars().any(|c| c.is_alphanumeric()) {
        capped
    } else {
        "track".to_string()
    }
}

// --- P2P content seeding wiring (talks to the local goamp-node) ---

const NODE_BASE: &str = "http://localhost:7472";

/// Stable, cross-peer content id. Both the seeder (on download) and the fetcher
/// (on play) compute the same string for the same track:
/// `youtube:<videoId>` / `soundcloud:<webpageUrl>`.
fn content_id(source: &str, native: &str) -> String {
    format!("{}:{}", source, native)
}

/// Best-effort: ask the local node to seed `path` under `track_id` (store in the
/// archive + announce to the DHT). Failures are ignored — seeding is optional.
async fn node_provide(track_id: String, path: String) {
    let body = serde_json::json!({ "track_id": track_id, "path": path });
    let _ = crate::http::CLIENT
        .post(format!("{NODE_BASE}/content/provide"))
        .json(&body)
        .send()
        .await;
}

/// Setting that gates P2P seeding of downloaded tracks. OFF unless "1".
const SEED_ENABLED_SETTING: &str = "p2p_seed_enabled";

/// Default OFF: only an explicit "1" enables seeding.
fn parse_seed_enabled(v: Option<String>) -> bool {
    matches!(v.as_deref(), Some("1"))
}

fn seed_enabled(app: &tauri::AppHandle) -> bool {
    let db = app.state::<Db>();
    parse_seed_enabled(db.get_setting(SEED_ENABLED_SETTING))
}

/// Fire-and-forget seed so the download command returns immediately. No-op when
/// the user hasn't opted into seeding (default) or when there's no content id.
fn spawn_provide(app: &tauri::AppHandle, track_id: String, path: String) {
    if track_id.is_empty() || !seed_enabled(app) {
        return;
    }
    tauri::async_runtime::spawn(node_provide(track_id, path));
}

/// Enable/disable P2P seeding of downloaded tracks (persisted).
#[tauri::command]
pub fn set_seed_enabled(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    app.state::<Db>()
        .set_setting(SEED_ENABLED_SETTING, if enabled { "1" } else { "0" });
    Ok(())
}

/// Whether P2P seeding of downloaded tracks is currently enabled.
///
/// Runtime-generic (unlike `seed_enabled`/`set_seed_enabled`'s concrete
/// `AppHandle`) so the verification gate can invoke it for real against
/// `tauri::test::MockRuntime` — same minimal, behaviour-preserving pattern
/// already used for `get_top_tracks_cmd`, `build_profile`, and friends;
/// production still infers `Wry` at the call site.
#[tauri::command]
pub fn get_seed_enabled<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Result<bool, String> {
    let db = app.state::<Db>();
    Ok(parse_seed_enabled(db.get_setting(SEED_ENABLED_SETTING)))
}

/// Best-effort peer fetch: if a peer serves `cid`, write the bytes to
/// `dest_base.opus` and return that path; else None. A short timeout keeps
/// playback from ever stalling on the node.
async fn node_fetch(cid: &str, dest_base: &std::path::Path) -> Option<String> {
    let resp = crate::http::CLIENT
        .get(format!("{NODE_BASE}/content"))
        .query(&[("id", cid)])
        .timeout(std::time::Duration::from_secs(4))
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let bytes = resp.bytes().await.ok()?;
    if bytes.is_empty() {
        return None;
    }
    let dest = dest_base.with_extension("opus");
    fs::write(&dest, &bytes).ok()?;
    Some(dest.to_string_lossy().to_string())
}

/// Download a track's audio to the OS Downloads folder as `Artist - Title.ext`.
/// `url` is any yt-dlp page URL, or a bare YouTube video id. `track_id` is the
/// P2P content id to seed under (empty = don't seed). Returns the saved path.
#[tauri::command]
pub async fn download_track(
    app: tauri::AppHandle,
    url: String,
    title: String,
    artist: String,
    track_id: Option<String>,
) -> Result<String, String> {
    let page_url = if url.contains("://") {
        url
    } else {
        format!("https://www.youtube.com/watch?v={}", url)
    };

    let dir = app
        .path()
        .download_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("goamp"));
    let _ = fs::create_dir_all(&dir);

    let stem = sanitize_filename(&artist, &title);
    let base = dir.join(&stem);
    let out_arg = format!("{}.%(ext)s", base.display());

    // Primary: tagged mp3 (needs ffmpeg). Fallback: raw bestaudio.
    let mut args: Vec<String> = cookies_args(&app);
    args.extend([
        page_url.clone(),
        "-x".to_string(),
        "--audio-format".to_string(),
        "mp3".to_string(),
        "--audio-quality".to_string(),
        "5".to_string(),
        "--embed-metadata".to_string(),
        "--embed-thumbnail".to_string(),
        "--no-playlist".to_string(),
        "--no-warnings".to_string(),
        "-o".to_string(),
        out_arg.clone(),
    ]);
    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let _ = run_ytdlp(&app, &arg_refs).await?;

    // The primary pass may exit non-zero when ffmpeg is missing (postprocessing
    // fails) yet still leave the fully-downloaded audio on disk — accept that file
    // instead of downloading a second time. Only fall back when nothing landed.
    if let Some(path) = find_cached_file(&base) {
        sweep_sidecar_images(&base);
        spawn_provide(&app, track_id.clone().unwrap_or_default(), path.clone());
        return Ok(path);
    }

    // Fallback: raw bestaudio, no post-processing (no ffmpeg needed).
    let mut args2: Vec<String> = cookies_args(&app);
    args2.extend([
        page_url,
        "-f".to_string(),
        "bestaudio".to_string(),
        "--no-playlist".to_string(),
        "--no-warnings".to_string(),
        "-o".to_string(),
        out_arg,
    ]);
    let arg_refs2: Vec<&str> = args2.iter().map(|s| s.as_str()).collect();
    let output2 = run_ytdlp(&app, &arg_refs2).await?;

    if !output2.status.success() {
        let stderr = String::from_utf8_lossy(&output2.stderr);
        return Err(format!("download failed: {}", stderr));
    }

    sweep_sidecar_images(&base);
    let path =
        find_cached_file(&base).ok_or_else(|| "file not found after download".to_string())?;
    spawn_provide(&app, track_id.unwrap_or_default(), path.clone());
    Ok(path)
}

/// Remove sidecar thumbnail images (`--embed-thumbnail` leaves these when ffmpeg
/// can't embed them) so the Downloads folder gets only the audio file.
fn sweep_sidecar_images(base: &std::path::Path) {
    for ext in &["jpg", "jpeg", "png", "webp"] {
        let _ = fs::remove_file(base.with_extension(ext));
    }
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

    // Resolve-on-play: try a peer before yt-dlp; fall through on any miss.
    if let Some(p) = node_fetch(&content_id("soundcloud", &url), &out_template).await {
        return Ok(p);
    }

    // Try with -x first
    let out_arg = format!("{}.%(ext)s", out_template.display());
    let mut args: Vec<String> = cookies_args(&app);
    args.extend([
        url.clone(),
        "-x".to_string(),
        "--audio-format".to_string(),
        "opus".to_string(),
        "-o".to_string(),
        out_arg.clone(),
        "--no-warnings".to_string(),
    ]);
    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let output = run_ytdlp(&app, &arg_refs).await?;

    if output.status.success() {
        if let Some(path) = find_cached_file(&out_template) {
            return Ok(path);
        }
    }

    // Fallback: download bestaudio without conversion
    let mut args2: Vec<String> = cookies_args(&app);
    args2.extend([
        url,
        "-f".to_string(),
        "bestaudio".to_string(),
        "-o".to_string(),
        out_arg,
        "--no-warnings".to_string(),
    ]);
    let arg_refs2: Vec<&str> = args2.iter().map(|s| s.as_str()).collect();
    let output = run_ytdlp(&app, &arg_refs2).await?;

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

/// Return the path of an already-downloaded audio file for `video_id`, if any.
/// Used by the goamp-audio:// streaming protocol for its instant-cache path.
pub fn cached_audio_path(app: &tauri::AppHandle, video_id: &str) -> Option<String> {
    let cache = cache_dir(app);
    for ext in &["opus", "m4a", "webm", "ogg", "mp3", "wav"] {
        let p = cache.join(format!("{}.{}", video_id, ext));
        if p.exists() {
            return Some(p.to_string_lossy().to_string());
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

    // Resolve-on-play: try a peer before yt-dlp; fall through on any miss.
    if let Some(p) = node_fetch(&content_id("youtube", &video_id), &cache.join(&video_id)).await {
        return Ok(p);
    }

    let out_template = cache.join(format!("{}.%(ext)s", video_id));
    let out_template_str = out_template.to_string_lossy().to_string();
    let url = format!("https://www.youtube.com/watch?v={}", video_id);

    // Try with audio extraction (needs ffmpeg)
    let mut args: Vec<String> = cookies_args(&app);
    args.extend([
        "-x".to_string(),
        "--audio-format".to_string(),
        "opus".to_string(),
        "--audio-quality".to_string(),
        "5".to_string(),
        "-o".to_string(),
        out_template_str.clone(),
        "--no-playlist".to_string(),
        "--no-warnings".to_string(),
        url.clone(),
    ]);
    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let output = run_ytdlp(&app, &arg_refs).await?;

    // If -x failed (no ffmpeg), try downloading best audio directly
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        eprintln!(
            "[GOAMP] extract with -x failed, trying direct download: {}",
            stderr
        );

        let mut args2: Vec<String> = cookies_args(&app);
        args2.extend([
            "-f".to_string(),
            "bestaudio".to_string(),
            "-o".to_string(),
            out_template_str,
            "--no-playlist".to_string(),
            "--no-warnings".to_string(),
            url,
        ]);
        let arg_refs2: Vec<&str> = args2.iter().map(|s| s.as_str()).collect();
        let output2 = run_ytdlp(&app, &arg_refs2).await?;

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

/// Extract a directly streamable audio URL WITHOUT downloading the file.
/// `yt-dlp -g` returns the direct CDN URL (n-parameter already deciphered, so
/// the browser gets full-speed playback). The webview's <audio> element then
/// streams it progressively — playback starts in ~1-2s instead of waiting for
/// a full download.
///
/// `input` may be a bare YouTube video id or any yt-dlp-supported page URL.
/// The returned URL is time-limited (~6h) — fine for immediate playback and
/// for the autoplay queue, not for persistent saved playlists.
#[tauri::command]
pub async fn extract_audio_stream_url(
    app: tauri::AppHandle,
    input: String,
) -> Result<String, String> {
    let url = if input.contains("://") {
        input
    } else {
        format!("https://www.youtube.com/watch?v={}", input)
    };

    let mut args: Vec<String> = cookies_args(&app);
    args.extend([
        url,
        "-g".to_string(),
        "-f".to_string(),
        "bestaudio".to_string(),
        "--no-playlist".to_string(),
        "--no-warnings".to_string(),
    ]);
    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let output = run_ytdlp(&app, &arg_refs).await?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("yt-dlp -g error: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout
        .lines()
        .map(|l| l.trim())
        .find(|l| l.starts_with("http"))
        .map(|l| l.to_string())
        .ok_or_else(|| "no stream URL returned by yt-dlp".to_string())
}

// --- YouTube cookies/auth ---

const YT_COOKIES_SETTING: &str = "youtube_cookies_path";

/// Save YouTube cookies file path to settings
#[tauri::command]
pub fn youtube_set_cookies(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let db = app.state::<Db>();
    db.set_setting(YT_COOKIES_SETTING, &path);
    Ok(())
}

/// Get saved YouTube cookies path
#[tauri::command]
pub fn youtube_get_cookies(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let db = app.state::<Db>();
    Ok(db.get_setting(YT_COOKIES_SETTING).filter(|s| !s.is_empty()))
}

/// Clear YouTube cookies
#[tauri::command]
pub fn youtube_clear_cookies(app: tauri::AppHandle) -> Result<(), String> {
    let db = app.state::<Db>();
    db.set_setting(YT_COOKIES_SETTING, "");
    Ok(())
}

fn cookies_args(app: &tauri::AppHandle) -> Vec<String> {
    let db = app.state::<Db>();
    if let Some(path) = db.get_setting(YT_COOKIES_SETTING) {
        if !path.is_empty() && std::path::Path::new(&path).exists() {
            return vec!["--cookies".to_string(), path];
        }
    }
    Vec::new()
}

// --- YouTube playlist import ---

/// Fetch playlist metadata (title + track list) from a YouTube playlist URL
#[tauri::command]
pub async fn youtube_get_playlist(
    app: tauri::AppHandle,
    url: String,
) -> Result<Vec<YoutubeResult>, String> {
    let mut args: Vec<String> = cookies_args(&app);
    args.extend([
        url,
        "--dump-json".to_string(),
        "--flat-playlist".to_string(),
        "--no-warnings".to_string(),
    ]);

    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let output = run_ytdlp(&app, &arg_refs).await?;

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
            let webpage_url = entry.webpage_url.unwrap_or_default();
            let genre = entry
                .genre
                .or_else(|| entry.categories.and_then(|c| c.into_iter().next()))
                .unwrap_or_default();

            Some(YoutubeResult {
                id,
                title,
                channel,
                duration,
                thumbnail,
                source: "youtube".to_string(),
                webpage_url,
                genre,
            })
        })
        .collect();

    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn infers_source_from_url_host() {
        assert_eq!(
            infer_source(
                "https://soundcloud.com/sofiya-chernyak-646218391/sets/koroli-abstrakta-vi"
            ),
            "soundcloud"
        );
        assert_eq!(
            infer_source("https://www.youtube.com/playlist?list=PLabc"),
            "youtube"
        );
    }

    #[test]
    fn parses_a_track_line_with_metadata() {
        let line = r#"{"id":"t1","title":"Некропатруль","uploader":"ежемесячные","duration":260.0,"webpage_url":"https://soundcloud.com/x/y","genre":"rap"}"#;
        let r = parse_entry(line, "soundcloud").expect("should parse");
        assert_eq!(r.id, "t1");
        assert_eq!(r.title, "Некропатруль");
        assert_eq!(r.channel, "ежемесячные");
        assert_eq!(r.duration, 260.0);
        assert_eq!(r.source, "soundcloud");
        assert_eq!(r.genre, "rap");
    }

    #[test]
    fn drops_soundcloud_preview_but_keeps_full_track() {
        let preview = r#"{"id":"p","title":"Preview","duration":30.0}"#;
        let full = r#"{"id":"f","title":"Full","duration":200.0}"#;
        assert!(parse_entry(preview, "soundcloud").is_none());
        assert!(parse_entry(full, "soundcloud").is_some());
        // Same 30s clip on YouTube is not a preview — kept.
        assert!(parse_entry(preview, "youtube").is_some());
    }

    #[test]
    fn sanitize_strips_illegal_chars_and_collapses_space() {
        let n = sanitize_filename("AC/DC", "Back:In*Black?");
        assert!(!n.contains('/'));
        assert!(!n.contains(':'));
        assert!(!n.contains('*'));
        assert!(!n.contains('?'));
        assert_eq!(n, "AC DC - Back In Black");
    }

    #[test]
    fn sanitize_handles_one_sided_and_empty_metadata() {
        assert_eq!(sanitize_filename("", "Just Title"), "Just Title");
        assert_eq!(sanitize_filename("Just Artist", ""), "Just Artist");
        assert_eq!(sanitize_filename("", ""), "track");
        // Only-illegal input collapses to the fallback, never empty.
        assert_eq!(sanitize_filename("///", "***"), "track");
    }

    #[test]
    fn seed_enabled_defaults_off() {
        assert!(!parse_seed_enabled(None));
        assert!(!parse_seed_enabled(Some("0".into())));
        assert!(!parse_seed_enabled(Some("".into())));
        assert!(!parse_seed_enabled(Some("true".into())));
        assert!(parse_seed_enabled(Some("1".into())));
    }

    #[test]
    fn content_id_is_stable_per_source() {
        assert_eq!(content_id("youtube", "abc123"), "youtube:abc123");
        assert_eq!(
            content_id("soundcloud", "https://soundcloud.com/x/y"),
            "soundcloud:https://soundcloud.com/x/y"
        );
    }

    #[test]
    fn sanitize_caps_length() {
        let long = "x".repeat(500);
        let n = sanitize_filename(&long, &long);
        assert!(n.chars().count() <= 120);
        assert!(!n.is_empty());
    }

    #[test]
    fn parse_entries_sums_a_set() {
        let stdout = concat!(
            r#"{"id":"a","title":"A","duration":100.0}"#,
            "\n",
            r#"{"id":"b","title":"B","duration":150.0}"#,
            "\n",
            "\n", // blank line ignored
            r#"not-json"#,
        );
        let rows = parse_entries(stdout, "soundcloud");
        assert_eq!(rows.len(), 2);
        let total: f64 = rows.iter().map(|r| r.duration).sum();
        assert_eq!(total, 250.0);
    }
}
