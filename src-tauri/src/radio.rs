use crate::db::Db;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{Emitter, Manager};
use tokio::sync::Mutex as TokioMutex;

// ─── Types ───

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RadioStation {
    pub stationuuid: String,
    pub name: String,
    pub url: String,
    pub url_resolved: String,
    pub homepage: String,
    pub favicon: String,
    pub tags: String,
    pub country: String,
    pub countrycode: String,
    pub language: String,
    pub codec: String,
    pub bitrate: i32,
    pub votes: i32,
    pub clickcount: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RadioTag {
    pub name: String,
    pub stationcount: i32,
}

#[derive(Debug, Clone, Serialize)]
pub struct RadioNowPlaying {
    pub title: String,
    pub station_name: String,
    pub station_uuid: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct CachedSegment {
    pub index: usize,
    pub title: String,
    pub duration_secs: f64,
}

// ─── Stream state (managed by Tauri) ───

pub struct RadioStreamState {
    pub active: Arc<AtomicBool>,
    pub station: Arc<TokioMutex<Option<RadioStation>>>,
    pub current_title: Arc<TokioMutex<String>>,
    pub cache: Arc<TokioMutex<StreamCache>>,
    pub proxy_port: Arc<TokioMutex<Option<u16>>>,
}

impl RadioStreamState {
    pub fn new() -> Self {
        Self {
            active: Arc::new(AtomicBool::new(false)),
            station: Arc::new(TokioMutex::new(None)),
            current_title: Arc::new(TokioMutex::new(String::new())),
            cache: Arc::new(TokioMutex::new(StreamCache::new(10 * 1024 * 1024))), // ~10MB = ~10min at 128kbps
            proxy_port: Arc::new(TokioMutex::new(None)),
        }
    }
}

// ─── Ring buffer cache ───

pub struct StreamCache {
    buffer: VecDeque<u8>,
    max_size: usize,
    segments: Vec<SegmentMarker>,
}

struct SegmentMarker {
    title: String,
    byte_offset: usize,
    timestamp: std::time::Instant,
}

impl StreamCache {
    fn new(max_size: usize) -> Self {
        Self {
            buffer: VecDeque::with_capacity(max_size),
            max_size,
            segments: Vec::new(),
        }
    }

    pub fn push(&mut self, data: &[u8]) {
        self.buffer.extend(data);
        while self.buffer.len() > self.max_size {
            let excess = self.buffer.len() - self.max_size;
            self.buffer.drain(..excess);
            // Adjust offsets
            for m in &mut self.segments {
                m.byte_offset = m.byte_offset.saturating_sub(excess);
            }
            self.segments.retain(|m| m.byte_offset > 0);
        }
    }

    pub fn mark_track(&mut self, title: String) {
        self.segments.push(SegmentMarker {
            title,
            byte_offset: self.buffer.len(),
            timestamp: std::time::Instant::now(),
        });
    }

    pub fn list_segments(&self) -> Vec<CachedSegment> {
        self.segments
            .iter()
            .enumerate()
            .map(|(i, m)| {
                let end = self
                    .segments
                    .get(i + 1)
                    .map(|n| n.timestamp)
                    .unwrap_or_else(std::time::Instant::now);
                CachedSegment {
                    index: i,
                    title: m.title.clone(),
                    duration_secs: end.duration_since(m.timestamp).as_secs_f64(),
                }
            })
            .collect()
    }

    pub fn extract_segment(&self, index: usize) -> Option<Vec<u8>> {
        let start = self.segments.get(index)?.byte_offset;
        let end = self
            .segments
            .get(index + 1)
            .map(|m| m.byte_offset)
            .unwrap_or(self.buffer.len());
        if start >= self.buffer.len() || end > self.buffer.len() || start >= end {
            return None;
        }
        Some(self.buffer.range(start..end).copied().collect())
    }

    /// Extract the last N seconds of raw audio (based on bitrate estimate)
    pub fn extract_last_secs(&self, secs: f64, bitrate_kbps: i32) -> Vec<u8> {
        let bytes = (bitrate_kbps as f64 * 1000.0 / 8.0 * secs) as usize;
        let start = self.buffer.len().saturating_sub(bytes);
        self.buffer.range(start..).copied().collect()
    }

    pub fn clear(&mut self) {
        self.buffer.clear();
        self.segments.clear();
    }
}

// ─── radio-browser.info API ───

const RB_API: &str = "https://de1.api.radio-browser.info/json";

fn http_client() -> Client {
    Client::builder()
        .user_agent("GOAMP/1.0")
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .unwrap_or_default()
}

#[tauri::command]
pub async fn radio_search(
    query: String,
    tag: Option<String>,
    country: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<RadioStation>, String> {
    let client = http_client();
    let limit = limit.unwrap_or(50);

    let mut url = format!(
        "{}/stations/search?limit={}&order=clickcount&reverse=true",
        RB_API, limit
    );
    if !query.is_empty() {
        url.push_str(&format!("&name={}", urlencoding::encode(&query)));
    }
    if let Some(t) = &tag {
        url.push_str(&format!("&tag={}", urlencoding::encode(t)));
    }
    if let Some(c) = &country {
        url.push_str(&format!("&country={}", urlencoding::encode(c)));
    }

    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    let stations: Vec<RadioStation> = resp.json().await.map_err(|e| e.to_string())?;
    Ok(stations)
}

#[tauri::command]
pub async fn radio_top_stations(limit: Option<u32>) -> Result<Vec<RadioStation>, String> {
    let client = http_client();
    let limit = limit.unwrap_or(100);
    let url = format!("{}/stations/topvote?limit={}", RB_API, limit);
    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    let stations: Vec<RadioStation> = resp.json().await.map_err(|e| e.to_string())?;
    Ok(stations)
}

#[tauri::command]
pub async fn radio_by_tag(tag: String, limit: Option<u32>) -> Result<Vec<RadioStation>, String> {
    let client = http_client();
    let limit = limit.unwrap_or(50);
    let url = format!(
        "{}/stations/bytag/{}?limit={}&order=clickcount&reverse=true",
        RB_API,
        urlencoding::encode(&tag),
        limit
    );
    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    let stations: Vec<RadioStation> = resp.json().await.map_err(|e| e.to_string())?;
    Ok(stations)
}

#[tauri::command]
pub async fn radio_tags() -> Result<Vec<RadioTag>, String> {
    let client = http_client();
    let url = format!("{}/tags?order=stationcount&reverse=true&limit=200", RB_API);
    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    let tags: Vec<RadioTag> = resp.json().await.map_err(|e| e.to_string())?;
    // Filter out tags with very few stations
    Ok(tags.into_iter().filter(|t| t.stationcount >= 10).collect())
}

// ─── Favorite stations (DB) ───

#[tauri::command]
pub async fn radio_add_favorite(app: tauri::AppHandle, station_json: String) -> Result<(), String> {
    let db = app.state::<Db>();
    let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
    conn.execute(
        "INSERT OR REPLACE INTO radio_favorites (stationuuid, data) VALUES (?1, ?2)",
        rusqlite::params![
            serde_json::from_str::<RadioStation>(&station_json)
                .map_err(|e| e.to_string())?
                .stationuuid,
            station_json
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn radio_remove_favorite(
    app: tauri::AppHandle,
    stationuuid: String,
) -> Result<(), String> {
    let db = app.state::<Db>();
    let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
    conn.execute(
        "DELETE FROM radio_favorites WHERE stationuuid = ?1",
        [&stationuuid],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn radio_list_favorites(app: tauri::AppHandle) -> Result<Vec<RadioStation>, String> {
    let db = app.state::<Db>();
    let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
    let mut stmt = conn
        .prepare("SELECT data FROM radio_favorites ORDER BY added_at DESC")
        .map_err(|e| e.to_string())?;
    let stations: Vec<RadioStation> = stmt
        .query_map([], |row| {
            let json: String = row.get(0)?;
            Ok(
                serde_json::from_str(&json).unwrap_or_else(|_| RadioStation {
                    stationuuid: String::new(),
                    name: "?".to_string(),
                    url: String::new(),
                    url_resolved: String::new(),
                    homepage: String::new(),
                    favicon: String::new(),
                    tags: String::new(),
                    country: String::new(),
                    countrycode: String::new(),
                    language: String::new(),
                    codec: String::new(),
                    bitrate: 0,
                    votes: 0,
                    clickcount: 0,
                }),
            )
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(stations)
}

// ─── Custom stations ───

#[tauri::command]
pub async fn radio_add_custom(
    app: tauri::AppHandle,
    name: String,
    url: String,
    tags: Option<String>,
) -> Result<(), String> {
    let db = app.state::<Db>();
    let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO radio_custom (id, name, url, tags) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![id, name, url, tags.unwrap_or_default()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn radio_remove_custom(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let db = app.state::<Db>();
    let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
    conn.execute("DELETE FROM radio_custom WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn radio_list_custom(app: tauri::AppHandle) -> Result<Vec<RadioStation>, String> {
    let db = app.state::<Db>();
    let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
    let mut stmt = conn
        .prepare("SELECT id, name, url, tags FROM radio_custom ORDER BY added_at DESC")
        .map_err(|e| e.to_string())?;
    let stations: Vec<RadioStation> = stmt
        .query_map([], |row| {
            let id: String = row.get(0)?;
            let name: String = row.get(1)?;
            let url: String = row.get(2)?;
            let tags: String = row.get(3)?;
            Ok(RadioStation {
                stationuuid: format!("custom:{}", id),
                name,
                url: url.clone(),
                url_resolved: url,
                homepage: String::new(),
                favicon: String::new(),
                tags,
                country: String::new(),
                countrycode: String::new(),
                language: String::new(),
                codec: String::new(),
                bitrate: 128,
                votes: 0,
                clickcount: 0,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(stations)
}

// ─── Stream proxy ───

#[tauri::command]
pub async fn radio_play(app: tauri::AppHandle, station_json: String) -> Result<String, String> {
    let station: RadioStation = serde_json::from_str(&station_json).map_err(|e| e.to_string())?;
    let state = app.state::<RadioStreamState>();

    // Stop existing stream
    state.active.store(false, Ordering::SeqCst);
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;

    // Clear cache
    {
        let mut cache = state.cache.lock().await;
        cache.clear();
    }

    // Update station
    {
        let mut s = state.station.lock().await;
        *s = Some(station.clone());
    }
    {
        let mut t = state.current_title.lock().await;
        *t = String::new();
    }

    // Start proxy if not running
    let port = {
        let existing = state.proxy_port.lock().await;
        *existing
    };

    let port = if let Some(p) = port {
        p
    } else {
        let p = start_proxy_server(app.clone()).await?;
        let mut port_lock = state.proxy_port.lock().await;
        *port_lock = Some(p);
        p
    };

    // Start fetching stream in background
    state.active.store(true, Ordering::SeqCst);
    let active = state.active.clone();
    let cache = state.cache.clone();
    let current_title = state.current_title.clone();
    let app_handle = app.clone();
    let stream_url = if station.url_resolved.is_empty() {
        station.url.clone()
    } else {
        station.url_resolved.clone()
    };
    let station_name = station.name.clone();
    let station_uuid = station.stationuuid.clone();

    tokio::spawn(async move {
        if let Err(e) = stream_radio(
            &stream_url,
            &station_name,
            &station_uuid,
            active,
            cache,
            current_title,
            app_handle,
        )
        .await
        {
            eprintln!("[GOAMP] Radio stream error: {}", e);
        }
    });

    // Return proxy URL for Webamp
    Ok(format!("http://127.0.0.1:{}/stream", port))
}

#[tauri::command]
pub async fn radio_stop(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<RadioStreamState>();
    state.active.store(false, Ordering::SeqCst);
    {
        let mut s = state.station.lock().await;
        *s = None;
    }
    Ok(())
}

#[tauri::command]
pub async fn radio_now_playing(app: tauri::AppHandle) -> Result<Option<RadioNowPlaying>, String> {
    let state = app.state::<RadioStreamState>();
    if !state.active.load(Ordering::SeqCst) {
        return Ok(None);
    }
    let station = state.station.lock().await;
    let title = state.current_title.lock().await;
    Ok(station.as_ref().map(|s| RadioNowPlaying {
        title: title.clone(),
        station_name: s.name.clone(),
        station_uuid: s.stationuuid.clone(),
    }))
}

#[tauri::command]
pub async fn radio_list_cached(app: tauri::AppHandle) -> Result<Vec<CachedSegment>, String> {
    let state = app.state::<RadioStreamState>();
    let cache = state.cache.lock().await;
    Ok(cache.list_segments())
}

#[tauri::command]
pub async fn radio_save_segment(
    app: tauri::AppHandle,
    index: usize,
    title: Option<String>,
) -> Result<String, String> {
    let state = app.state::<RadioStreamState>();
    let cache = state.cache.lock().await;

    let data = cache
        .extract_segment(index)
        .ok_or("Segment not found or expired")?;
    let seg = cache
        .list_segments()
        .into_iter()
        .nth(index)
        .ok_or("Segment not found")?;

    drop(cache);

    let station = state.station.lock().await;
    let codec = station
        .as_ref()
        .map(|s| s.codec.to_lowercase())
        .unwrap_or_else(|| "mp3".to_string());
    drop(station);

    let ext = match codec.as_str() {
        "aac" | "aac+" => "aac",
        "ogg" => "ogg",
        "flac" => "flac",
        _ => "mp3",
    };

    let save_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("radio_saves");
    std::fs::create_dir_all(&save_dir).map_err(|e| e.to_string())?;

    let filename = sanitize_filename(&title.unwrap_or(seg.title));
    let path = save_dir.join(format!("{}.{}", filename, ext));
    std::fs::write(&path, &data).map_err(|e| e.to_string())?;

    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn radio_save_last_secs(
    app: tauri::AppHandle,
    secs: f64,
    title: Option<String>,
) -> Result<String, String> {
    let state = app.state::<RadioStreamState>();
    let cache = state.cache.lock().await;

    let station = state.station.lock().await;
    let bitrate = station.as_ref().map(|s| s.bitrate).unwrap_or(128);
    let codec = station
        .as_ref()
        .map(|s| s.codec.to_lowercase())
        .unwrap_or_else(|| "mp3".to_string());
    drop(station);

    let data = cache.extract_last_secs(secs, bitrate);
    drop(cache);

    if data.is_empty() {
        return Err("No cached audio".to_string());
    }

    let ext = match codec.as_str() {
        "aac" | "aac+" => "aac",
        "ogg" => "ogg",
        _ => "mp3",
    };

    let save_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("radio_saves");
    std::fs::create_dir_all(&save_dir).map_err(|e| e.to_string())?;

    let name =
        title.unwrap_or_else(|| format!("radio_{}", chrono::Utc::now().format("%Y%m%d_%H%M%S")));
    let filename = sanitize_filename(&name);
    let path = save_dir.join(format!("{}.{}", filename, ext));
    std::fs::write(&path, &data).map_err(|e| e.to_string())?;

    Ok(path.to_string_lossy().to_string())
}

fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => c,
        })
        .collect::<String>()
        .trim()
        .to_string()
}

// ─── ICY stream reader ───

async fn stream_radio(
    url: &str,
    station_name: &str,
    station_uuid: &str,
    active: Arc<AtomicBool>,
    cache: Arc<TokioMutex<StreamCache>>,
    current_title: Arc<TokioMutex<String>>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    // Connect with ICY metadata header
    let client = reqwest::Client::builder()
        .user_agent("GOAMP/1.0")
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get(url)
        .header("Icy-MetaData", "1")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    // Parse icy-metaint from headers
    let metaint: usize = resp
        .headers()
        .get("icy-metaint")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);

    eprintln!(
        "[GOAMP] Radio connected: {} (metaint={})",
        station_name, metaint
    );

    let mut stream = resp.bytes_stream();
    let mut audio_buf: Vec<u8> = Vec::with_capacity(16384);
    let mut bytes_until_meta: usize = metaint;
    let mut leftover: Vec<u8> = Vec::new();

    use futures_util::StreamExt;

    while active.load(Ordering::SeqCst) {
        let chunk = match stream.next().await {
            Some(Ok(c)) => c,
            Some(Err(e)) => {
                eprintln!("[GOAMP] Radio stream error: {}", e);
                break;
            }
            None => break,
        };

        let data = if leftover.is_empty() {
            chunk.to_vec()
        } else {
            let mut combined = std::mem::take(&mut leftover);
            combined.extend_from_slice(&chunk);
            combined
        };

        let mut pos = 0;

        if metaint == 0 {
            // No ICY metadata — just pass audio through
            let mut c = cache.lock().await;
            c.push(&data);
            // Push to proxy broadcast
            if let Some(tx) = PROXY_TX.get() {
                let _ = tx.send(data);
            }
            continue;
        }

        while pos < data.len() && active.load(Ordering::SeqCst) {
            if bytes_until_meta > 0 {
                let take = bytes_until_meta.min(data.len() - pos);
                audio_buf.extend_from_slice(&data[pos..pos + take]);
                pos += take;
                bytes_until_meta -= take;

                if bytes_until_meta == 0 && !audio_buf.is_empty() {
                    // Flush audio to cache and proxy
                    {
                        let mut c = cache.lock().await;
                        c.push(&audio_buf);
                    }
                    if let Some(tx) = PROXY_TX.get() {
                        let _ = tx.send(std::mem::take(&mut audio_buf));
                    } else {
                        audio_buf.clear();
                    }
                }
            } else {
                // Read metadata length byte
                if pos >= data.len() {
                    break;
                }
                let meta_len = data[pos] as usize * 16;
                pos += 1;

                if meta_len > 0 {
                    if pos + meta_len > data.len() {
                        // Need more data — save leftover
                        leftover = data[pos - 1..].to_vec();
                        // Revert: we need to re-read the length byte
                        break;
                    }
                    let meta_bytes = &data[pos..pos + meta_len];
                    pos += meta_len;

                    let meta_str = String::from_utf8_lossy(meta_bytes)
                        .trim_end_matches('\0')
                        .to_string();

                    if let Some(title) = parse_stream_title(&meta_str) {
                        let mut ct = current_title.lock().await;
                        if *ct != title {
                            eprintln!("[GOAMP] Radio track: {}", title);
                            *ct = title.clone();

                            // Mark segment in cache
                            {
                                let mut c = cache.lock().await;
                                c.mark_track(title.clone());
                            }

                            // Emit event to frontend
                            let _ = app.emit(
                                "radio-track-change",
                                RadioNowPlaying {
                                    title: title.clone(),
                                    station_name: station_name.to_string(),
                                    station_uuid: station_uuid.to_string(),
                                },
                            );
                        }
                    }
                }

                bytes_until_meta = metaint;
            }
        }

        // If we have remaining audio in buffer, flush it
        if !audio_buf.is_empty() && metaint == 0 {
            let mut c = cache.lock().await;
            c.push(&audio_buf);
            if let Some(tx) = PROXY_TX.get() {
                let _ = tx.send(std::mem::take(&mut audio_buf));
            } else {
                audio_buf.clear();
            }
        }
    }

    eprintln!("[GOAMP] Radio stream stopped");
    Ok(())
}

fn parse_stream_title(meta: &str) -> Option<String> {
    let start = meta.find("StreamTitle='")?;
    let rest = &meta[start + 13..];
    let end = rest.find("';")?;
    let title = rest[..end].trim().to_string();
    if title.is_empty() {
        None
    } else {
        Some(title)
    }
}

// ─── Local proxy HTTP server ───

use std::sync::OnceLock;
use tokio::sync::broadcast;

static PROXY_TX: OnceLock<broadcast::Sender<Vec<u8>>> = OnceLock::new();

async fn start_proxy_server(app: tauri::AppHandle) -> Result<u16, String> {
    use tokio::io::AsyncWriteExt;
    use tokio::net::TcpListener;

    let (tx, _) = broadcast::channel::<Vec<u8>>(256);
    let _ = PROXY_TX.set(tx.clone());

    // Bind to random available port
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();

    eprintln!("[GOAMP] Radio proxy listening on port {}", port);

    tokio::spawn(async move {
        loop {
            let (mut socket, _) = match listener.accept().await {
                Ok(s) => s,
                Err(_) => continue,
            };

            let tx_clone = tx.clone();
            let app_clone = app.clone();

            tokio::spawn(async move {
                // Read HTTP request (we only need to consume it)
                let mut req_buf = [0u8; 4096];
                let _ = tokio::io::AsyncReadExt::read(&mut socket, &mut req_buf).await;

                // Get content type from current station
                let content_type = {
                    let state = app_clone.state::<RadioStreamState>();
                    let station = state.station.lock().await;
                    station
                        .as_ref()
                        .map(|s| match s.codec.to_lowercase().as_str() {
                            "aac" | "aac+" => "audio/aac",
                            "ogg" => "audio/ogg",
                            "flac" => "audio/flac",
                            _ => "audio/mpeg",
                        })
                        .unwrap_or("audio/mpeg")
                        .to_string()
                };

                // Send HTTP response headers
                let headers = format!(
                    "HTTP/1.1 200 OK\r\n\
                     Content-Type: {}\r\n\
                     Cache-Control: no-cache\r\n\
                     Connection: close\r\n\
                     Access-Control-Allow-Origin: *\r\n\
                     \r\n",
                    content_type
                );

                if socket.write_all(headers.as_bytes()).await.is_err() {
                    return;
                }

                let mut rx = tx_clone.subscribe();
                loop {
                    match rx.recv().await {
                        Ok(data) => {
                            if socket.write_all(&data).await.is_err() {
                                break;
                            }
                        }
                        Err(broadcast::error::RecvError::Lagged(_)) => continue,
                        Err(_) => break,
                    }
                }
            });
        }
    });

    Ok(port)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_stream_title() {
        assert_eq!(
            parse_stream_title("StreamTitle='Artist - Song';StreamUrl='';"),
            Some("Artist - Song".to_string())
        );
        assert_eq!(parse_stream_title("StreamTitle='';"), None);
        assert_eq!(parse_stream_title("no metadata here"), None);
        assert_eq!(
            parse_stream_title("StreamTitle='Hello World';"),
            Some("Hello World".to_string())
        );
    }

    #[test]
    fn test_sanitize_filename() {
        assert_eq!(sanitize_filename("Artist - Song"), "Artist - Song");
        assert_eq!(sanitize_filename("A/B\\C:D*E"), "A_B_C_D_E");
        assert_eq!(sanitize_filename("  spaced  "), "spaced");
    }

    #[test]
    fn test_stream_cache() {
        let mut cache = StreamCache::new(1024);

        // Push some data
        cache.push(&[1, 2, 3, 4, 5]);
        assert_eq!(cache.buffer.len(), 5);

        // Mark a track
        cache.mark_track("Track 1".to_string());
        cache.push(&[6, 7, 8, 9, 10]);
        cache.mark_track("Track 2".to_string());
        cache.push(&[11, 12, 13]);

        let segments = cache.list_segments();
        assert_eq!(segments.len(), 2);
        assert_eq!(segments[0].title, "Track 1");
        assert_eq!(segments[1].title, "Track 2");

        // Extract segment
        let seg = cache.extract_segment(0);
        assert!(seg.is_some());
        assert_eq!(seg.unwrap(), vec![6, 7, 8, 9, 10]);

        // Extract last N seconds (approximation)
        let last = cache.extract_last_secs(1.0, 8); // 8kbps = 1000 bytes/sec
        assert!(!last.is_empty());
    }

    #[test]
    fn test_stream_cache_eviction() {
        let mut cache = StreamCache::new(10); // tiny cache

        cache.mark_track("First".to_string());
        cache.push(&[1, 2, 3, 4, 5]);
        cache.mark_track("Second".to_string());
        cache.push(&[6, 7, 8, 9, 10, 11, 12]); // will evict some

        // Buffer should not exceed max_size
        assert!(cache.buffer.len() <= 10);

        // Old segments with evicted data should be cleaned up
        let segments = cache.list_segments();
        // "First" segment might be evicted depending on exact offset tracking
        assert!(!segments.is_empty());
    }

    #[test]
    fn test_stream_cache_clear() {
        let mut cache = StreamCache::new(1024);
        cache.push(&[1, 2, 3]);
        cache.mark_track("Test".to_string());
        cache.clear();
        assert_eq!(cache.buffer.len(), 0);
        assert!(cache.segments.is_empty());
    }
}
