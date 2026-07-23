//! Custom `goamp-audio://` URI scheme — streaming audio for the autoplay queue.
//!
//! AutoplayFeature fills the Webamp queue instantly with
//! `goamp-audio://localhost/<videoId>` URLs (metadata only). When the webview's
//! <audio> element loads one — i.e. when that track is played — this handler:
//!
//!   1. Fast path: if a previous background download already cached the file,
//!      serves it from disk (with Range).
//!   2. Otherwise: resolves the direct googlevideo CDN URL (yt-dlp -g, cached
//!      in memory) and PROXIES the requested byte range from it. The webview
//!      drives chunked streaming by requesting successive ranges — playback
//!      starts in ~1-2s, no full download needed.
//!   3. In parallel, kicks off a one-off background download so the next play
//!      (or a replay) hits the instant disk cache.

use std::borrow::Cow;
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use once_cell::sync::Lazy;
use tauri::http::{Request, Response};
use tauri::{AppHandle, UriSchemeContext, UriSchemeResponder, Wry};

/// Per-request byte cap — the <audio> element drives chunked streaming by
/// requesting successive ranges.
const CHUNK: u64 = 1024 * 1024;
/// googlevideo URLs expire (~6h) — refresh a bit early.
const URL_TTL: Duration = Duration::from_secs(5 * 3600);

struct CachedUrl {
    url: String,
    at: Instant,
}

/// Resolved direct CDN URLs — avoids re-running yt-dlp for every Range request.
static URL_CACHE: Lazy<Mutex<HashMap<String, CachedUrl>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
/// Video ids whose background cache download is already in progress.
static CACHING: Lazy<Mutex<HashSet<String>>> = Lazy::new(|| Mutex::new(HashSet::new()));

/// Async URI-scheme handler registered for the `goamp-audio` scheme.
pub fn handle(
    ctx: UriSchemeContext<'_, Wry>,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let app = ctx.app_handle().clone();
    let uri = request.uri().to_string();
    let range = request
        .headers()
        .get("range")
        .and_then(|v| v.to_str().ok())
        .map(String::from);
    tauri::async_runtime::spawn(async move {
        responder.respond(serve(&app, &uri, range.as_deref()).await);
    });
}

async fn serve(app: &AppHandle, uri: &str, range: Option<&str>) -> Response<Cow<'static, [u8]>> {
    let video_id = video_id_from_uri(uri);
    if video_id.is_empty() {
        return err(400, "missing video id");
    }

    // 1. Fast path — a background download already cached the full file.
    if let Some(path) = crate::commands::youtube::cached_audio_path(app, &video_id) {
        return serve_file(&path, range);
    }

    // 2. Resolve the direct CDN URL (in-memory cached; yt-dlp -g with retry).
    let cdn = match resolve_url(app, &video_id).await {
        Ok(u) => u,
        Err(e) => return err(502, &format!("resolve failed: {e}")),
    };

    // 3. Kick off a one-off background download for future instant playback.
    spawn_background_cache(app, &video_id);

    // Stream the requested range straight from googlevideo.
    proxy_range(&cdn, range).await
}

/// yt-dlp -g with an in-memory URL cache and one retry.
async fn resolve_url(app: &AppHandle, video_id: &str) -> Result<String, String> {
    {
        let cache = URL_CACHE.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(c) = cache.get(video_id) {
            if c.at.elapsed() < URL_TTL {
                return Ok(c.url.clone());
            }
        }
    }

    let mut last_err = String::from("unknown error");
    for _ in 0..2 {
        match crate::commands::youtube::extract_audio_stream_url(app.clone(), video_id.to_string())
            .await
        {
            Ok(url) => {
                let mut cache = URL_CACHE.lock().unwrap_or_else(|e| e.into_inner());
                cache.insert(
                    video_id.to_string(),
                    CachedUrl {
                        url: url.clone(),
                        at: Instant::now(),
                    },
                );
                return Ok(url);
            }
            Err(e) => last_err = e,
        }
    }
    Err(last_err)
}

/// Download the full audio to the on-disk cache once, in the background.
fn spawn_background_cache(app: &AppHandle, video_id: &str) {
    {
        let mut caching = CACHING.lock().unwrap_or_else(|e| e.into_inner());
        if caching.contains(video_id) {
            return;
        }
        caching.insert(video_id.to_string());
    }
    let app = app.clone();
    let vid = video_id.to_string();
    tauri::async_runtime::spawn(async move {
        let _ = crate::commands::youtube::extract_audio(app, vid.clone()).await;
        let mut caching = CACHING.lock().unwrap_or_else(|e| e.into_inner());
        caching.remove(&vid);
    });
}

/// Proxy a single byte range from the googlevideo CDN URL.
async fn proxy_range(cdn_url: &str, range: Option<&str>) -> Response<Cow<'static, [u8]>> {
    let (start, end_opt) = parse_range(range);
    let req_end = end_opt
        .unwrap_or(u64::MAX)
        .min(start.saturating_add(CHUNK - 1));
    let range_header = format!("bytes={start}-{req_end}");

    let resp = match crate::http::CLIENT
        .get(cdn_url)
        .header("Range", &range_header)
        .header("User-Agent", "Mozilla/5.0")
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => return err(502, &format!("upstream request: {e}")),
    };

    let upstream_status = resp.status().as_u16();
    let content_range = header_str(resp.headers().get("content-range"));
    let content_type =
        header_str(resp.headers().get("content-type")).unwrap_or_else(|| "audio/webm".to_string());

    let bytes = match resp.bytes().await {
        Ok(b) => b.to_vec(),
        Err(e) => return err(502, &format!("upstream body: {e}")),
    };

    let status = if upstream_status == 200 {
        206
    } else {
        upstream_status
    };
    let mut builder = Response::builder()
        .status(status)
        .header("Content-Type", content_type)
        .header("Accept-Ranges", "bytes")
        .header("Access-Control-Allow-Origin", "*");
    if let Some(cr) = content_range {
        builder = builder.header("Content-Range", cr);
    }
    builder
        .body(Cow::Owned(bytes))
        .unwrap_or_else(|_| err(500, "failed to build response"))
}

/// Serve a cached file from disk, honouring Range.
fn serve_file(path: &str, range: Option<&str>) -> Response<Cow<'static, [u8]>> {
    let data = match std::fs::read(path) {
        Ok(d) => d,
        Err(e) => return err(404, &format!("cache read: {e}")),
    };
    let total = data.len() as u64;
    let ct = content_type(path);

    let Some(raw) = range else {
        return Response::builder()
            .status(200)
            .header("Content-Type", ct)
            .header("Accept-Ranges", "bytes")
            .header("Access-Control-Allow-Origin", "*")
            .body(Cow::Owned(data))
            .unwrap_or_else(|_| err(500, "build"));
    };

    let (start, end_opt) = parse_range(Some(raw));
    if start >= total {
        return err(416, "range not satisfiable");
    }
    let end = end_opt
        .unwrap_or(u64::MAX)
        .min(start.saturating_add(CHUNK - 1))
        .min(total - 1);
    let slice = data[start as usize..=end as usize].to_vec();

    Response::builder()
        .status(206)
        .header("Content-Type", ct)
        .header("Accept-Ranges", "bytes")
        .header("Access-Control-Allow-Origin", "*")
        .header("Content-Range", format!("bytes {start}-{end}/{total}"))
        .body(Cow::Owned(slice))
        .unwrap_or_else(|_| err(500, "build"))
}

/// Parse `Range: bytes=START-END` → (start, optional end).
fn parse_range(range: Option<&str>) -> (u64, Option<u64>) {
    let Some(spec) = range.and_then(|r| r.trim().strip_prefix("bytes=")) else {
        return (0, None);
    };
    let mut parts = spec.split('-');
    let start = parts
        .next()
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or(0);
    let end = parts.next().and_then(|s| {
        let t = s.trim();
        if t.is_empty() {
            None
        } else {
            t.parse().ok()
        }
    });
    (start, end)
}

fn header_str(v: Option<&tauri::http::HeaderValue>) -> Option<String> {
    v.and_then(|h| h.to_str().ok()).map(String::from)
}

/// The video id is the last path segment of the request URI.
fn video_id_from_uri(uri: &str) -> String {
    uri.split(['?', '#'])
        .next()
        .unwrap_or("")
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or("")
        .to_string()
}

fn content_type(path: &str) -> &'static str {
    let p = path.to_ascii_lowercase();
    if p.ends_with(".opus") || p.ends_with(".ogg") {
        "audio/ogg"
    } else if p.ends_with(".m4a") || p.ends_with(".mp4") || p.ends_with(".aac") {
        "audio/mp4"
    } else if p.ends_with(".webm") {
        "audio/webm"
    } else if p.ends_with(".mp3") {
        "audio/mpeg"
    } else if p.ends_with(".wav") {
        "audio/wav"
    } else {
        "application/octet-stream"
    }
}

fn err(status: u16, msg: &str) -> Response<Cow<'static, [u8]>> {
    Response::builder()
        .status(status)
        .header("Access-Control-Allow-Origin", "*")
        .header("Content-Type", "text/plain")
        .body(Cow::Owned(msg.as_bytes().to_vec()))
        .unwrap_or_else(|_| {
            Response::builder()
                .status(500)
                .body(Cow::Owned(Vec::new()))
                .expect("static empty response")
        })
}
