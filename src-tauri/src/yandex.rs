use reqwest::Client;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::db::Db;
use crate::md5::md5_hex;

const YA_API: &str = "https://api.music.yandex.net:443";
const YA_TOKEN_SETTING: &str = "yandex_token";
const YA_UID_SETTING: &str = "yandex_uid";
const YA_OAUTH_CLIENT_ID: &str = "23cabbbdc6cd418abb4b39c32c41195d";
const MD5_SALT: &str = "XGRlBW9FXlekgbPrRHuSiA";

// --- Types ---

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct YandexTrack {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration: f64,
    pub cover: String,
    pub available: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct YandexStation {
    pub id: String,
    pub name: String,
    pub icon: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct YandexPlaylist {
    pub kind: i64,
    pub title: String,
    pub track_count: i64,
    pub cover: String,
    pub owner: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct YandexAccount {
    pub uid: String,
    pub login: String,
    pub display_name: String,
    pub has_plus: bool,
}

// --- Internal API response types ---

#[derive(Debug, Deserialize)]
struct ApiResult<T> {
    result: T,
}

#[derive(Debug, Deserialize)]
struct AccountStatus {
    account: AccountInfo,
    plus: Option<PlusInfo>,
}

#[derive(Debug, Deserialize)]
struct AccountInfo {
    uid: i64,
    login: Option<String>,
    #[serde(rename = "displayName")]
    display_name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PlusInfo {
    #[serde(rename = "hasPlus")]
    has_plus: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct SearchResult {
    tracks: Option<SearchTracks>,
}

#[derive(Debug, Deserialize)]
struct SearchTracks {
    results: Vec<ApiTrack>,
}

#[derive(Debug, Deserialize)]
struct ApiTrack {
    id: serde_json::Value,
    title: Option<String>,
    artists: Option<Vec<ApiArtist>>,
    albums: Option<Vec<ApiAlbum>>,
    #[serde(rename = "durationMs")]
    duration_ms: Option<i64>,
    #[serde(rename = "coverUri")]
    cover_uri: Option<String>,
    available: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct ApiArtist {
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ApiAlbum {
    title: Option<String>,
}

#[derive(Debug, Deserialize)]
struct DownloadInfoResult {
    result: Vec<DownloadInfoEntry>,
}

#[derive(Debug, Deserialize)]
struct DownloadInfoEntry {
    codec: Option<String>,
    #[serde(rename = "bitrateInKbps")]
    bitrate_in_kbps: Option<i32>,
    #[serde(rename = "downloadInfoUrl")]
    download_info_url: String,
    preview: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct DownloadFileInfo {
    host: String,
    path: String,
    ts: String,
    s: String,
}

#[derive(Debug, Deserialize)]
struct StationList {
    result: Vec<StationEntry>,
}

#[derive(Debug, Deserialize)]
struct StationEntry {
    station: StationInfo,
}

#[derive(Debug, Deserialize)]
struct StationInfo {
    id: StationId,
    name: Option<String>,
    icon: Option<StationIcon>,
}

#[derive(Debug, Deserialize)]
struct StationId {
    #[serde(rename = "type")]
    type_: String,
    tag: String,
}

#[derive(Debug, Deserialize)]
struct StationIcon {
    #[serde(rename = "imageUrl")]
    image_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct StationTracksResult {
    result: StationTracksData,
}

#[derive(Debug, Deserialize)]
struct StationTracksData {
    sequence: Vec<SequenceItem>,
}

#[derive(Debug, Deserialize)]
struct SequenceItem {
    track: ApiTrack,
}

#[derive(Debug, Deserialize)]
struct PlaylistListResult {
    result: Vec<ApiPlaylistShort>,
}

#[derive(Debug, Deserialize)]
struct ApiPlaylistShort {
    kind: i64,
    title: Option<String>,
    #[serde(rename = "trackCount")]
    track_count: Option<i64>,
    cover: Option<ApiCover>,
    owner: Option<ApiOwner>,
}

#[derive(Debug, Deserialize)]
struct ApiCover {
    uri: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ApiOwner {
    login: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PlaylistResult {
    result: ApiPlaylistFull,
}

#[derive(Debug, Deserialize)]
struct ApiPlaylistFull {
    tracks: Option<Vec<PlaylistTrackEntry>>,
}

#[derive(Debug, Deserialize)]
struct PlaylistTrackEntry {
    track: Option<ApiTrack>,
}

// --- Helpers ---

fn get_setting(db: &Db, key: &str) -> Option<String> {
    let conn = db.0.lock().unwrap();
    conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| {
        row.get(0)
    })
    .ok()
}

fn set_setting(db: &Db, key: &str, value: &str) {
    let conn = db.0.lock().unwrap();
    let _ = conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        [key, value],
    );
}

fn ya_client(token: &str) -> Client {
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert("Authorization", format!("OAuth {}", token).parse().unwrap());
    headers.insert("Accept-Language", "ru".parse().unwrap());
    Client::builder()
        .default_headers(headers)
        .build()
        .unwrap_or_else(|_| Client::new())
}

fn api_track_to_result(t: &ApiTrack) -> YandexTrack {
    let id = match &t.id {
        serde_json::Value::Number(n) => n.to_string(),
        serde_json::Value::String(s) => s.clone(),
        _ => String::new(),
    };
    let artist = t
        .artists
        .as_ref()
        .and_then(|a| a.first())
        .and_then(|a| a.name.as_ref())
        .cloned()
        .unwrap_or_default();
    let album = t
        .albums
        .as_ref()
        .and_then(|a| a.first())
        .and_then(|a| a.title.as_ref())
        .cloned()
        .unwrap_or_default();
    let duration = t.duration_ms.unwrap_or(0) as f64 / 1000.0;
    let cover = t
        .cover_uri
        .as_ref()
        .map(|c| format!("https://{}", c.replace("%%", "200x200")))
        .unwrap_or_default();
    YandexTrack {
        id,
        title: t.title.clone().unwrap_or_default(),
        artist,
        album,
        duration,
        cover,
        available: t.available.unwrap_or(false),
    }
}

// --- Commands ---

/// Save Yandex OAuth token
#[tauri::command]
pub fn yandex_save_token(app: tauri::AppHandle, token: String) -> Result<(), String> {
    let db = app.state::<Db>();
    set_setting(&db, YA_TOKEN_SETTING, &token);
    Ok(())
}

/// Open OAuth window and auto-capture token from redirect
#[tauri::command]
pub async fn yandex_oauth_login(app: tauri::AppHandle) -> Result<(), String> {
    let oauth_url = format!(
        "https://oauth.yandex.ru/authorize?response_type=token&client_id={}",
        YA_OAUTH_CLIENT_ID
    );

    let app_handle = app.clone();
    let _win = WebviewWindowBuilder::new(
        &app,
        "yandex-auth",
        WebviewUrl::External(oauth_url.parse().unwrap()),
    )
    .title("Yandex Music — Login")
    .inner_size(600.0, 700.0)
    .on_navigation(move |url| {
        let url_str = url.to_string();
        // Yandex redirects to https://music.yandex.ru/#access_token=TOKEN&...
        if let Some(fragment) = url.fragment() {
            if fragment.contains("access_token=") {
                let token: String = fragment
                    .split('&')
                    .find(|p: &&str| p.starts_with("access_token="))
                    .and_then(|p: &str| p.strip_prefix("access_token="))
                    .unwrap_or("")
                    .to_string();

                if !token.is_empty() {
                    let db = app_handle.state::<Db>();
                    set_setting(&db, YA_TOKEN_SETTING, &token);
                    eprintln!("[GOAMP] Yandex OAuth token captured");
                    let _ = app_handle.emit("yandex-auth-success", &token);
                    if let Some(w) = app_handle.get_webview_window("yandex-auth") {
                        let _ = w.close();
                    }
                }
                return false;
            }
        }
        eprintln!("[GOAMP] Yandex auth navigating: {}", url_str);
        true
    })
    .build()
    .map_err(|e| format!("failed to create auth window: {e}"))?;

    Ok(())
}

/// Check if Yandex is authenticated, return account info
#[tauri::command]
pub async fn yandex_get_status(app: tauri::AppHandle) -> Result<Option<YandexAccount>, String> {
    let db = app.state::<Db>();
    let token = match get_setting(&db, YA_TOKEN_SETTING) {
        Some(t) if !t.is_empty() => t,
        _ => return Ok(None),
    };

    let client = ya_client(&token);
    let resp = client
        .get(format!("{}/account/status", YA_API))
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;

    let body = resp.text().await.map_err(|e| format!("read failed: {e}"))?;
    let parsed: ApiResult<AccountStatus> =
        serde_json::from_str(&body).map_err(|e| format!("parse error: {e}"))?;

    let uid = parsed.result.account.uid.to_string();
    // Save UID for playlist/rotor operations
    set_setting(&db, YA_UID_SETTING, &uid);

    Ok(Some(YandexAccount {
        uid,
        login: parsed.result.account.login.unwrap_or_default(),
        display_name: parsed.result.account.display_name.unwrap_or_default(),
        has_plus: parsed.result.plus.and_then(|p| p.has_plus).unwrap_or(false),
    }))
}

/// Disconnect Yandex account
#[tauri::command]
pub fn yandex_logout(app: tauri::AppHandle) -> Result<(), String> {
    let db = app.state::<Db>();
    let conn = db.0.lock().unwrap();
    let _ = conn.execute("DELETE FROM settings WHERE key LIKE 'yandex_%'", []);
    Ok(())
}

/// Search tracks on Yandex Music
#[tauri::command]
pub async fn yandex_search(
    app: tauri::AppHandle,
    query: String,
    page: Option<u32>,
) -> Result<Vec<YandexTrack>, String> {
    let db = app.state::<Db>();
    let token = get_setting(&db, YA_TOKEN_SETTING).ok_or("not authenticated")?;

    let client = ya_client(&token);
    let resp = client
        .get(format!("{}/search", YA_API))
        .query(&[
            ("text", query.as_str()),
            ("type", "track"),
            ("page", &page.unwrap_or(0).to_string()),
            ("nococrrect", "false"),
        ])
        .send()
        .await
        .map_err(|e| format!("search failed: {e}"))?;

    let body = resp.text().await.map_err(|e| format!("read failed: {e}"))?;
    let parsed: ApiResult<SearchResult> =
        serde_json::from_str(&body).map_err(|e| format!("parse error: {e} body: {body}"))?;

    let tracks = parsed
        .result
        .tracks
        .map(|t| t.results.iter().map(api_track_to_result).collect())
        .unwrap_or_default();

    Ok(tracks)
}

/// Get direct MP3 URL for a Yandex Music track
#[tauri::command]
pub async fn yandex_get_track_url(
    app: tauri::AppHandle,
    track_id: String,
) -> Result<String, String> {
    let db = app.state::<Db>();
    let token = get_setting(&db, YA_TOKEN_SETTING).ok_or("not authenticated")?;

    let client = ya_client(&token);

    // Step 1: Get download info
    let resp = client
        .get(format!("{}/tracks/{}/download-info", YA_API, track_id))
        .send()
        .await
        .map_err(|e| format!("download-info failed: {e}"))?;

    let body = resp.text().await.map_err(|e| format!("read failed: {e}"))?;
    let info: DownloadInfoResult =
        serde_json::from_str(&body).map_err(|e| format!("parse error: {e}"))?;

    // Pick best MP3 entry (non-preview, highest bitrate)
    let entry = info
        .result
        .iter()
        .filter(|e| e.codec.as_deref() == Some("mp3") && !e.preview.unwrap_or(false))
        .max_by_key(|e| e.bitrate_in_kbps.unwrap_or(0))
        .or_else(|| info.result.first())
        .ok_or("no download info available")?;

    // Step 2: Get file info from downloadInfoUrl
    let file_resp = client
        .get(&entry.download_info_url)
        .query(&[("format", "json")])
        .send()
        .await
        .map_err(|e| format!("file info failed: {e}"))?;

    let file_body = file_resp
        .text()
        .await
        .map_err(|e| format!("read failed: {e}"))?;
    let file_info: DownloadFileInfo =
        serde_json::from_str(&file_body).map_err(|e| format!("parse error: {e}"))?;

    // Step 3: Construct signed URL
    let sign_input = format!("{}{}{}", MD5_SALT, &file_info.path[1..], file_info.s);
    let hash = md5_hex(&sign_input);
    let url = format!(
        "https://{}/get-mp3/{}/{}{}",
        file_info.host, hash, file_info.ts, file_info.path
    );

    eprintln!("[GOAMP] Yandex track URL: {} (track {})", url, track_id);
    Ok(url)
}

/// List radio stations (genre stations + user stations)
#[tauri::command]
pub async fn yandex_list_stations(app: tauri::AppHandle) -> Result<Vec<YandexStation>, String> {
    let db = app.state::<Db>();
    let token = get_setting(&db, YA_TOKEN_SETTING).ok_or("not authenticated")?;

    let client = ya_client(&token);
    let resp = client
        .get(format!("{}/rotor/stations/list", YA_API))
        .query(&[("language", "ru")])
        .send()
        .await
        .map_err(|e| format!("stations failed: {e}"))?;

    let body = resp.text().await.map_err(|e| format!("read failed: {e}"))?;
    let parsed: StationList =
        serde_json::from_str(&body).map_err(|e| format!("parse error: {e}"))?;

    let stations = parsed
        .result
        .iter()
        .map(|s| {
            let id = format!("{}:{}", s.station.id.type_, s.station.id.tag);
            let icon = s
                .station
                .icon
                .as_ref()
                .and_then(|i| i.image_url.as_ref())
                .map(|u| format!("https://{}", u.replace("%%", "100x100")))
                .unwrap_or_default();
            YandexStation {
                id,
                name: s.station.name.clone().unwrap_or_default(),
                icon,
            }
        })
        .collect();

    Ok(stations)
}

/// Get tracks from a radio station (My Wave = "user:onyourwave")
#[tauri::command]
pub async fn yandex_station_tracks(
    app: tauri::AppHandle,
    station_id: String,
    last_track_id: Option<String>,
) -> Result<Vec<YandexTrack>, String> {
    let db = app.state::<Db>();
    let token = get_setting(&db, YA_TOKEN_SETTING).ok_or("not authenticated")?;

    let client = ya_client(&token);

    // If first request, send radioStarted feedback
    if last_track_id.is_none() {
        let _ = client
            .post(format!("{}/rotor/station/{}/feedback", YA_API, station_id))
            .query(&[("batch-id", "")])
            .json(&serde_json::json!({
                "type": "radioStarted",
                "from": "goamp",
                "timestamp": chrono_timestamp()
            }))
            .send()
            .await;
    }

    // Fetch tracks batch
    let url = format!("{}/rotor/station/{}/tracks", YA_API, station_id);
    let queue = last_track_id.unwrap_or_default();
    let resp = client
        .get(&url)
        .query(&[("settings2", "true"), ("queue", &queue)])
        .send()
        .await
        .map_err(|e| format!("station tracks failed: {e}"))?;

    let body = resp.text().await.map_err(|e| format!("read failed: {e}"))?;
    let parsed: StationTracksResult =
        serde_json::from_str(&body).map_err(|e| format!("parse error: {e} body: {body}"))?;

    let tracks = parsed
        .result
        .sequence
        .iter()
        .map(|s| api_track_to_result(&s.track))
        .filter(|t| t.available)
        .collect();

    Ok(tracks)
}

/// List user's playlists on Yandex Music
#[tauri::command]
pub async fn yandex_list_playlists(app: tauri::AppHandle) -> Result<Vec<YandexPlaylist>, String> {
    let db = app.state::<Db>();
    let token = get_setting(&db, YA_TOKEN_SETTING).ok_or("not authenticated")?;
    let uid = get_setting(&db, YA_UID_SETTING).ok_or("uid not found, re-authenticate")?;

    let client = ya_client(&token);
    let resp = client
        .get(format!("{}/users/{}/playlists/list", YA_API, uid))
        .send()
        .await
        .map_err(|e| format!("playlists failed: {e}"))?;

    let body = resp.text().await.map_err(|e| format!("read failed: {e}"))?;
    let parsed: PlaylistListResult =
        serde_json::from_str(&body).map_err(|e| format!("parse error: {e}"))?;

    let playlists = parsed
        .result
        .iter()
        .map(|p| {
            let cover = p
                .cover
                .as_ref()
                .and_then(|c| c.uri.as_ref())
                .map(|u| format!("https://{}", u.replace("%%", "200x200")))
                .unwrap_or_default();
            YandexPlaylist {
                kind: p.kind,
                title: p.title.clone().unwrap_or_default(),
                track_count: p.track_count.unwrap_or(0),
                cover,
                owner: p
                    .owner
                    .as_ref()
                    .and_then(|o| o.login.as_ref())
                    .cloned()
                    .unwrap_or(uid.clone()),
            }
        })
        .collect();

    Ok(playlists)
}

/// Get tracks from a Yandex Music playlist
#[tauri::command]
pub async fn yandex_get_playlist_tracks(
    app: tauri::AppHandle,
    owner: String,
    kind: i64,
) -> Result<Vec<YandexTrack>, String> {
    let db = app.state::<Db>();
    let token = get_setting(&db, YA_TOKEN_SETTING).ok_or("not authenticated")?;

    let client = ya_client(&token);
    let resp = client
        .get(format!("{}/users/{}/playlists/{}", YA_API, owner, kind))
        .send()
        .await
        .map_err(|e| format!("playlist tracks failed: {e}"))?;

    let body = resp.text().await.map_err(|e| format!("read failed: {e}"))?;
    let parsed: PlaylistResult =
        serde_json::from_str(&body).map_err(|e| format!("parse error: {e}"))?;

    let tracks = parsed
        .result
        .tracks
        .unwrap_or_default()
        .iter()
        .filter_map(|e| e.track.as_ref().map(api_track_to_result))
        .filter(|t| t.available)
        .collect();

    Ok(tracks)
}

/// Import a Yandex playlist into GOAMP local playlists
#[tauri::command]
pub async fn yandex_import_playlist(
    app: tauri::AppHandle,
    owner: String,
    kind: i64,
    name: String,
) -> Result<String, String> {
    // Get tracks from Yandex
    let tracks = yandex_get_playlist_tracks(app.clone(), owner, kind).await?;

    // Create local playlist
    let db = app.state::<Db>();
    let playlist_id = uuid::Uuid::new_v4().to_string();
    {
        let conn = db.0.lock().unwrap();
        conn.execute(
            "INSERT INTO playlists (id, name) VALUES (?1, ?2)",
            [&playlist_id, &name],
        )
        .map_err(|e| format!("create playlist failed: {e}"))?;

        for (i, track) in tracks.iter().enumerate() {
            let track_row_id = uuid::Uuid::new_v4().to_string();
            conn.execute(
                "INSERT INTO playlist_tracks (id, playlist_id, position, title, artist, duration, source, source_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                rusqlite::params![
                    track_row_id,
                    playlist_id,
                    i as i64,
                    track.title,
                    track.artist,
                    track.duration,
                    "yandex",
                    track.id,
                ],
            ).map_err(|e| format!("insert track failed: {e}"))?;
        }
    }

    eprintln!(
        "[GOAMP] Imported Yandex playlist '{}': {} tracks",
        name,
        tracks.len()
    );
    Ok(playlist_id)
}

fn chrono_timestamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();
    // ISO 8601 approximate
    format!("{}Z", secs)
}
