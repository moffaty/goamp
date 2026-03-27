use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{Emitter, Manager};
use yandex_music::model::playlist::PlaylistTracks;
use yandex_music::YandexMusicClient;

use crate::db::Db;

const YA_TOKEN_SETTING: &str = "yandex_token";
const YA_REFRESH_TOKEN_SETTING: &str = "yandex_refresh_token";
const YA_UID_SETTING: &str = "yandex_uid";
const YA_OAUTH_CLIENT_ID: &str = "23cabbbdc6cd418abb4b39c32c41195d";
const YA_OAUTH_CLIENT_SECRET: &str = "53bc75238f0c4d08a118e51fe9203300";

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
    pub kind: u32,
    pub title: String,
    pub track_count: u32,
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

#[derive(Debug, Serialize, Deserialize)]
pub struct DeviceCodeResponse {
    pub user_code: String,
    pub verification_url: String,
    pub interval: u64,
    pub device_code: String,
    pub expires_in: u64,
}

// --- OAuth Device Code Flow response types ---

#[derive(Debug, Deserialize)]
struct OAuthTokenResponse {
    access_token: Option<String>,
    refresh_token: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

#[derive(Debug, Deserialize)]
struct DeviceCodeApiResponse {
    device_code: String,
    user_code: String,
    verification_url: String,
    interval: u64,
    expires_in: u64,
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

fn make_client(token: &str) -> YandexMusicClient {
    YandexMusicClient::builder(token).build().unwrap()
}

fn track_to_result(t: &yandex_music::model::track::Track) -> YandexTrack {
    let id = t.id.clone();
    let title = t.title.clone().unwrap_or_default();
    let artist = t
        .artists
        .first()
        .and_then(|a| a.name.as_ref())
        .cloned()
        .unwrap_or_default();
    let album = t
        .albums
        .first()
        .and_then(|a| a.title.as_ref())
        .cloned()
        .unwrap_or_default();
    let duration = t.duration.map(|d| d.as_secs_f64()).unwrap_or(0.0);
    let cover = t
        .cover_uri
        .as_ref()
        .map(|c| format!("https://{}", c.replace("%%", "200x200")))
        .unwrap_or_default();
    YandexTrack {
        id,
        title,
        artist,
        album,
        duration,
        cover,
        available: t.available.unwrap_or(false),
    }
}

// --- Commands: OAuth Device Code Flow ---

#[tauri::command]
pub async fn yandex_request_device_code() -> Result<DeviceCodeResponse, String> {
    let client = Client::new();
    let resp = client
        .post("https://oauth.yandex.ru/device/code")
        .form(&[
            ("client_id", YA_OAUTH_CLIENT_ID),
            ("device_name", "GOAMP Music Player"),
        ])
        .send()
        .await
        .map_err(|e| format!("device code request failed: {e}"))?;

    let body = resp.text().await.map_err(|e| format!("read failed: {e}"))?;
    let parsed: DeviceCodeApiResponse =
        serde_json::from_str(&body).map_err(|e| format!("parse error: {e} body: {body}"))?;

    Ok(DeviceCodeResponse {
        user_code: parsed.user_code,
        verification_url: parsed.verification_url,
        interval: parsed.interval,
        device_code: parsed.device_code,
        expires_in: parsed.expires_in,
    })
}

#[tauri::command]
pub async fn yandex_poll_token(
    app: tauri::AppHandle,
    device_code: String,
) -> Result<String, String> {
    let client = Client::new();
    let resp = client
        .post("https://oauth.yandex.ru/token")
        .form(&[
            ("grant_type", "device_code"),
            ("code", &device_code),
            ("client_id", YA_OAUTH_CLIENT_ID),
            ("client_secret", YA_OAUTH_CLIENT_SECRET),
        ])
        .send()
        .await
        .map_err(|e| format!("token request failed: {e}"))?;

    let body = resp.text().await.map_err(|e| format!("read failed: {e}"))?;
    let parsed: OAuthTokenResponse =
        serde_json::from_str(&body).map_err(|e| format!("parse error: {e}"))?;

    if let Some(error) = &parsed.error {
        if error == "authorization_pending" {
            return Err("pending".into());
        }
        let desc = parsed.error_description.as_deref().unwrap_or("");
        return Err(format!("{}: {}", error, desc));
    }

    let token = parsed.access_token.ok_or("no access_token in response")?;

    let db = app.state::<Db>();
    set_setting(&db, YA_TOKEN_SETTING, &token);
    if let Some(refresh) = &parsed.refresh_token {
        set_setting(&db, YA_REFRESH_TOKEN_SETTING, refresh);
    }

    eprintln!("[GOAMP] Yandex OAuth token obtained via device code flow");
    let _ = app.emit("yandex-auth-success", &token);

    Ok("ok".into())
}

#[tauri::command]
pub async fn yandex_refresh_token(app: tauri::AppHandle) -> Result<(), String> {
    let db = app.state::<Db>();
    let refresh = get_setting(&db, YA_REFRESH_TOKEN_SETTING).ok_or("no refresh token")?;

    let client = Client::new();
    let resp = client
        .post("https://oauth.yandex.ru/token")
        .form(&[
            ("grant_type", "refresh_token"),
            ("refresh_token", &refresh),
            ("client_id", YA_OAUTH_CLIENT_ID),
            ("client_secret", YA_OAUTH_CLIENT_SECRET),
        ])
        .send()
        .await
        .map_err(|e| format!("refresh failed: {e}"))?;

    let body = resp.text().await.map_err(|e| format!("read failed: {e}"))?;
    let parsed: OAuthTokenResponse =
        serde_json::from_str(&body).map_err(|e| format!("parse error: {e}"))?;

    let token = parsed.access_token.ok_or("no access_token")?;
    set_setting(&db, YA_TOKEN_SETTING, &token);
    if let Some(new_refresh) = &parsed.refresh_token {
        set_setting(&db, YA_REFRESH_TOKEN_SETTING, new_refresh);
    }

    eprintln!("[GOAMP] Yandex token refreshed");
    Ok(())
}

#[tauri::command]
pub fn yandex_save_token(app: tauri::AppHandle, token: String) -> Result<(), String> {
    let db = app.state::<Db>();
    set_setting(&db, YA_TOKEN_SETTING, &token);
    Ok(())
}

// --- Commands: Account ---

#[tauri::command]
pub async fn yandex_get_status(app: tauri::AppHandle) -> Result<Option<YandexAccount>, String> {
    let db = app.state::<Db>();
    let token = match get_setting(&db, YA_TOKEN_SETTING) {
        Some(t) if !t.is_empty() => t,
        _ => return Ok(None),
    };

    let client = make_client(&token);
    let status = client
        .get_account_status()
        .await
        .map_err(|e| format!("account status failed: {e:?}"))?;

    let account = status.account;
    let uid = account.uid.map(|u| u.to_string()).unwrap_or_default();
    set_setting(&db, YA_UID_SETTING, &uid);

    Ok(Some(YandexAccount {
        uid,
        login: account.login.unwrap_or_default(),
        display_name: account.display_name.unwrap_or_default(),
        has_plus: status.plus.has_plus,
    }))
}

#[tauri::command]
pub fn yandex_logout(app: tauri::AppHandle) -> Result<(), String> {
    let db = app.state::<Db>();
    let conn = db.0.lock().unwrap();
    let _ = conn.execute("DELETE FROM settings WHERE key LIKE 'yandex_%'", []);
    Ok(())
}

// --- Commands: Search ---

#[tauri::command]
pub async fn yandex_search(
    app: tauri::AppHandle,
    query: String,
    page: Option<u32>,
) -> Result<Vec<YandexTrack>, String> {
    let db = app.state::<Db>();
    let token = get_setting(&db, YA_TOKEN_SETTING).ok_or("not authenticated")?;

    let client = make_client(&token);
    let options =
        yandex_music::api::search::get_search::SearchOptions::new(&query).page(page.unwrap_or(0));
    let result = client
        .search(&options)
        .await
        .map_err(|e| format!("search failed: {e:?}"))?;

    let tracks = result
        .tracks
        .map(|t| t.results.iter().map(track_to_result).collect::<Vec<_>>())
        .unwrap_or_default();

    Ok(tracks)
}

// --- Commands: Track URL ---

#[tauri::command]
pub async fn yandex_get_track_url(
    app: tauri::AppHandle,
    track_id: String,
) -> Result<String, String> {
    let db = app.state::<Db>();
    let token = get_setting(&db, YA_TOKEN_SETTING).ok_or("not authenticated")?;

    let client = make_client(&token);
    let options = yandex_music::api::track::get_file_info::GetFileInfoOptions::new(&track_id);
    let info = client
        .get_file_info(&options)
        .await
        .map_err(|e| format!("file info failed: {e:?}"))?;

    let url = info.url;
    eprintln!("[GOAMP] Yandex track URL: {} (track {})", url, track_id);
    Ok(url)
}

// --- Commands: Radio ---

#[tauri::command]
pub async fn yandex_list_stations(app: tauri::AppHandle) -> Result<Vec<YandexStation>, String> {
    let db = app.state::<Db>();
    let token = get_setting(&db, YA_TOKEN_SETTING).ok_or("not authenticated")?;

    let client = make_client(&token);
    let options =
        yandex_music::api::rotor::get_all_stations::GetAllStationsOptions::default().language("ru");
    let stations = client
        .get_all_stations(&options)
        .await
        .map_err(|e| format!("stations failed: {e:?}"))?;

    let result = stations
        .iter()
        .map(|s| {
            let station = &s.station;
            let id = format!("{}:{}", station.id.item_type, station.id.tag);
            let name = station.name.clone();
            let icon = format!(
                "https://{}",
                station.icon.image_url.replace("%%", "100x100")
            );
            YandexStation { id, name, icon }
        })
        .collect();

    Ok(result)
}

#[tauri::command]
pub async fn yandex_station_tracks(
    app: tauri::AppHandle,
    station_id: String,
    last_track_id: Option<String>,
) -> Result<Vec<YandexTrack>, String> {
    let db = app.state::<Db>();
    let token = get_setting(&db, YA_TOKEN_SETTING).ok_or("not authenticated")?;

    let client = make_client(&token);

    let mut options =
        yandex_music::api::rotor::get_station_tracks::GetStationTracksOptions::new(&station_id);
    if let Some(ref last) = last_track_id {
        options = options.queue(last);
    }

    let result = client
        .get_station_tracks(&options)
        .await
        .map_err(|e| format!("station tracks failed: {e:?}"))?;

    let tracks = result
        .sequence
        .iter()
        .map(|s| track_to_result(&s.track))
        .filter(|t| t.available)
        .collect();

    Ok(tracks)
}

// --- Commands: Playlists ---

#[tauri::command]
pub async fn yandex_list_playlists(app: tauri::AppHandle) -> Result<Vec<YandexPlaylist>, String> {
    let db = app.state::<Db>();
    let token = get_setting(&db, YA_TOKEN_SETTING).ok_or("not authenticated")?;
    let uid = get_setting(&db, YA_UID_SETTING).ok_or("uid not found, re-authenticate")?;

    let client = make_client(&token);
    let uid_num: u64 = uid.parse().unwrap_or(0);
    let options =
        yandex_music::api::playlist::get_all_playlists::GetAllPlaylistsOptions::new(uid_num);
    let playlists = client
        .get_all_playlists(&options)
        .await
        .map_err(|e| format!("playlists failed: {e:?}"))?;

    let result = playlists
        .iter()
        .map(|p| {
            let cover = p
                .cover
                .uri
                .as_ref()
                .map(|u| format!("https://{}", u.replace("%%", "200x200")))
                .unwrap_or_default();
            YandexPlaylist {
                kind: p.kind,
                title: p.title.clone(),
                track_count: p.track_count,
                cover,
                owner: p.owner.login.clone(),
            }
        })
        .collect();

    Ok(result)
}

#[tauri::command]
pub async fn yandex_get_playlist_tracks(
    app: tauri::AppHandle,
    owner: String,
    kind: u32,
) -> Result<Vec<YandexTrack>, String> {
    let db = app.state::<Db>();
    let token = get_setting(&db, YA_TOKEN_SETTING).ok_or("not authenticated")?;

    let client = make_client(&token);
    let owner_num: u64 = owner.parse().unwrap_or(0);
    let options =
        yandex_music::api::playlist::get_playlist::GetPlaylistOptions::new(owner_num, kind);
    let playlist = client
        .get_playlist(&options)
        .await
        .map_err(|e| format!("playlist failed: {e:?}"))?;

    let tracks = match &playlist.tracks {
        Some(PlaylistTracks::Full(tracks)) => tracks
            .iter()
            .map(track_to_result)
            .filter(|t| t.available)
            .collect(),
        Some(PlaylistTracks::WithInfo(tracks)) => tracks
            .iter()
            .map(|t| track_to_result(&t.track))
            .filter(|t| t.available)
            .collect(),
        _ => Vec::new(),
    };

    Ok(tracks)
}

#[tauri::command]
pub async fn yandex_import_playlist(
    app: tauri::AppHandle,
    owner: String,
    kind: u32,
    name: String,
) -> Result<String, String> {
    let tracks = yandex_get_playlist_tracks(app.clone(), owner, kind).await?;

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
                "INSERT INTO playlist_tracks (id, playlist_id, position, title, artist, duration, source, source_id, album, cover) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                rusqlite::params![
                    track_row_id,
                    playlist_id,
                    i as i64,
                    track.title,
                    track.artist,
                    track.duration,
                    "yandex",
                    track.id,
                    track.album,
                    track.cover,
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

// --- Commands: Download ---

fn yandex_cache_dir(app: &tauri::AppHandle) -> PathBuf {
    let base = app
        .path()
        .app_cache_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("goamp"));
    let dir = base.join("yandex_cache");
    let _ = fs::create_dir_all(&dir);
    dir
}

#[tauri::command]
pub async fn yandex_download_track(
    app: tauri::AppHandle,
    track_id: String,
    title: String,
    artist: String,
) -> Result<String, String> {
    let db = app.state::<Db>();
    let token = get_setting(&db, YA_TOKEN_SETTING).ok_or("not authenticated")?;

    let cache_dir = yandex_cache_dir(&app);
    let safe_name = format!(
        "{} - {}",
        artist.replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "_"),
        title.replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "_")
    );
    let dest = cache_dir.join(format!("{}_{}.mp3", safe_name, track_id));

    // Check if already cached
    if dest.exists() {
        eprintln!("[GOAMP] Yandex track already cached: {}", dest.display());
        return Ok(dest.to_string_lossy().to_string());
    }

    // Get stream URL
    let client = make_client(&token);
    let options = yandex_music::api::track::get_file_info::GetFileInfoOptions::new(&track_id);
    let info = client
        .get_file_info(&options)
        .await
        .map_err(|e| format!("file info failed: {e:?}"))?;

    // Download the file
    let http = Client::new();
    let resp = http
        .get(&info.url)
        .send()
        .await
        .map_err(|e| format!("download failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("download HTTP {}", resp.status()));
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("read failed: {e}"))?;

    fs::write(&dest, &bytes).map_err(|e| format!("save failed: {e}"))?;

    eprintln!(
        "[GOAMP] Downloaded Yandex track: {} ({} bytes)",
        dest.display(),
        bytes.len()
    );
    Ok(dest.to_string_lossy().to_string())
}

#[derive(Debug, Serialize, Clone)]
pub struct DownloadProgress {
    pub track_id: String,
    pub index: usize,
    pub total: usize,
    pub status: String, // "downloading", "done", "error"
    pub path: Option<String>,
}

#[tauri::command]
pub async fn yandex_download_playlist(
    app: tauri::AppHandle,
    owner: String,
    kind: u32,
) -> Result<Vec<String>, String> {
    let tracks = yandex_get_playlist_tracks(app.clone(), owner, kind).await?;
    let total = tracks.len();
    let mut paths = Vec::new();

    for (i, track) in tracks.iter().enumerate() {
        let _ = app.emit(
            "yandex-download-progress",
            DownloadProgress {
                track_id: track.id.clone(),
                index: i,
                total,
                status: "downloading".into(),
                path: None,
            },
        );

        match yandex_download_track(
            app.clone(),
            track.id.clone(),
            track.title.clone(),
            track.artist.clone(),
        )
        .await
        {
            Ok(path) => {
                let _ = app.emit(
                    "yandex-download-progress",
                    DownloadProgress {
                        track_id: track.id.clone(),
                        index: i,
                        total,
                        status: "done".into(),
                        path: Some(path.clone()),
                    },
                );
                paths.push(path);
            }
            Err(e) => {
                let _ = app.emit(
                    "yandex-download-progress",
                    DownloadProgress {
                        track_id: track.id.clone(),
                        index: i,
                        total,
                        status: "error".into(),
                        path: None,
                    },
                );
                eprintln!("[GOAMP] Download failed for {}: {}", track.id, e);
            }
        }
    }

    eprintln!(
        "[GOAMP] Downloaded {}/{} tracks from playlist",
        paths.len(),
        total
    );
    Ok(paths)
}

// --- Commands: Liked Tracks ---

#[tauri::command]
pub async fn yandex_get_liked_tracks(app: tauri::AppHandle) -> Result<Vec<YandexTrack>, String> {
    let db = app.state::<Db>();
    let token = get_setting(&db, YA_TOKEN_SETTING).ok_or("not authenticated")?;
    let uid = get_setting(&db, YA_UID_SETTING).ok_or("uid not found")?;
    let uid_num: u64 = uid.parse().unwrap_or(0);

    let client = make_client(&token);
    let options = yandex_music::api::track::get_liked_tracks::GetLikedTracksOptions::new(uid_num);
    let liked = client
        .get_liked_tracks(&options)
        .await
        .map_err(|e| format!("liked tracks failed: {e:?}"))?;

    // liked returns track IDs, need to fetch full track info
    let track_ids: Vec<String> = liked.tracks.iter().map(|t| t.id.clone()).collect();

    if track_ids.is_empty() {
        return Ok(Vec::new());
    }

    // Batch fetch tracks (up to 100 at a time)
    let mut all_tracks = Vec::new();
    for chunk in track_ids.chunks(100) {
        let ids: Vec<&str> = chunk.iter().map(|s: &String| s.as_str()).collect();
        let options = yandex_music::api::track::get_tracks::GetTracksOptions::new(ids);
        let tracks = client
            .get_tracks(&options)
            .await
            .map_err(|e| format!("get tracks failed: {e:?}"))?;

        all_tracks.extend(tracks.iter().map(track_to_result).filter(|t| t.available));
    }

    Ok(all_tracks)
}

// --- Commands: Batch URL resolve ---

#[tauri::command]
pub async fn yandex_get_track_urls(
    app: tauri::AppHandle,
    track_ids: Vec<String>,
) -> Result<Vec<String>, String> {
    let db = app.state::<Db>();
    let token = get_setting(&db, YA_TOKEN_SETTING).ok_or("not authenticated")?;

    let client = make_client(&token);
    let mut urls = Vec::with_capacity(track_ids.len());

    for id in &track_ids {
        let options = yandex_music::api::track::get_file_info::GetFileInfoOptions::new(id);
        match client.get_file_info(&options).await {
            Ok(info) => urls.push(info.url),
            Err(e) => {
                eprintln!("[GOAMP] Failed to get URL for track {}: {e:?}", id);
                urls.push(String::new());
            }
        }
    }

    Ok(urls)
}

// --- Commands: OAuth WebView ---

#[tauri::command]
pub async fn yandex_open_oauth_window(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::WebviewWindowBuilder;

    // Close existing oauth window if open
    if let Some(existing) = app.get_webview_window("yandex-oauth") {
        let _ = existing.close();
    }

    let url = format!(
        "https://oauth.yandex.ru/authorize?response_type=token&client_id={}",
        YA_OAUTH_CLIENT_ID
    );
    let parsed_url = tauri::WebviewUrl::External(url.parse().map_err(|e| e.to_string())?);

    let app_clone = app.clone();
    WebviewWindowBuilder::new(&app, "yandex-oauth", parsed_url)
        .title("Sign in with Yandex — GOAMP")
        .inner_size(520.0, 720.0)
        .center()
        .on_navigation(move |nav_url| {
            let url_str = nav_url.as_str();
            // Yandex implicit OAuth redirects to verification_code page with token in fragment
            if url_str.contains("verification_code") || url_str.contains("access_token=") {
                let fragment = nav_url.fragment().unwrap_or("").to_string();
                let token = fragment.split('&').find_map(|part| {
                    let mut kv = part.splitn(2, '=');
                    if kv.next() == Some("access_token") {
                        kv.next().map(|s| s.to_string())
                    } else {
                        None
                    }
                });
                if let Some(token) = token {
                    let app2 = app_clone.clone();
                    tauri::async_runtime::spawn(async move {
                        let db = app2.state::<Db>();
                        set_setting(&db, YA_TOKEN_SETTING, &token);
                        let _ = app2.emit("yandex-auth-success", ());
                        if let Some(win) = app2.get_webview_window("yandex-oauth") {
                            let _ = win.close();
                        }
                    });
                    return false; // prevent loading the verification_code page
                }
            }
            true
        })
        .build()
        .map_err(|e| e.to_string())?;

    Ok(())
}

// --- Commands: Like/Unlike tracks ---

#[tauri::command]
pub async fn yandex_like_track(
    app: tauri::AppHandle,
    track_id: String,
    like: bool,
) -> Result<(), String> {
    let db = app.state::<Db>();
    let token = get_setting(&db, YA_TOKEN_SETTING).ok_or("not authenticated")?;
    let uid = get_setting(&db, YA_UID_SETTING).ok_or("uid not found")?;
    let uid_num: u64 = uid.parse().unwrap_or(0);

    let client = make_client(&token);

    if like {
        let options = yandex_music::api::track::add_liked_tracks::AddLikedTracksOptions::new(
            uid_num,
            [track_id],
        );
        client
            .add_liked_tracks(&options)
            .await
            .map_err(|e| format!("like track failed: {e:?}"))?;
    } else {
        let options = yandex_music::api::track::remove_liked_tracks::RemoveLikedTracksOptions::new(
            uid_num,
            [track_id],
        );
        client
            .remove_liked_tracks(&options)
            .await
            .map_err(|e| format!("unlike track failed: {e:?}"))?;
    }

    Ok(())
}
