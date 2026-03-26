use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use tauri::Manager;

use crate::db::Db;
use crate::md5::md5_hex;

const LASTFM_API_URL: &str = "https://ws.audioscrobbler.com/2.0/";
const LASTFM_API_KEY_SETTING: &str = "lastfm_api_key";
const LASTFM_SECRET_SETTING: &str = "lastfm_secret";
const LASTFM_SESSION_SETTING: &str = "lastfm_session_key";

#[derive(Debug, Serialize, Deserialize)]
pub struct LastfmSession {
    pub name: String,
    pub key: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct AuthSessionResponse {
    session: LastfmSession,
}

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

fn api_sig(params: &BTreeMap<&str, &str>, secret: &str) -> String {
    let mut sig_input = String::new();
    for (k, v) in params {
        sig_input.push_str(k);
        sig_input.push_str(v);
    }
    sig_input.push_str(secret);
    md5_hex(&sig_input)
}

/// Get Last.fm auth URL for user to visit
#[tauri::command]
pub fn lastfm_get_auth_url(app: tauri::AppHandle) -> Result<String, String> {
    let db = app.state::<Db>();
    let api_key = get_setting(&db, LASTFM_API_KEY_SETTING)
        .ok_or("Last.fm API key not set. Go to Settings to configure.")?;

    Ok(format!("https://www.last.fm/api/auth/?api_key={}", api_key))
}

/// Exchange token for session key after user authorizes
#[tauri::command]
pub async fn lastfm_auth(app: tauri::AppHandle, token: String) -> Result<LastfmSession, String> {
    let db = app.state::<Db>();
    let api_key = get_setting(&db, LASTFM_API_KEY_SETTING).ok_or("Last.fm API key not set")?;
    let secret = get_setting(&db, LASTFM_SECRET_SETTING).ok_or("Last.fm secret not set")?;

    let mut params = BTreeMap::new();
    params.insert("api_key", api_key.as_str());
    params.insert("method", "auth.getSession");
    params.insert("token", token.as_str());

    let sig = api_sig(&params, &secret);

    let client = Client::new();
    let resp = client
        .post(LASTFM_API_URL)
        .form(&[
            ("method", "auth.getSession"),
            ("api_key", &api_key),
            ("token", &token),
            ("api_sig", &sig),
            ("format", "json"),
        ])
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;

    let body = resp.text().await.map_err(|e| format!("read failed: {e}"))?;

    let parsed: AuthSessionResponse =
        serde_json::from_str(&body).map_err(|e| format!("parse error: {e} body: {body}"))?;

    set_setting(&db, LASTFM_SESSION_SETTING, &parsed.session.key);
    eprintln!("[GOAMP] Last.fm authenticated as: {}", parsed.session.name);

    Ok(parsed.session)
}

/// Send Now Playing notification
#[tauri::command]
pub async fn lastfm_now_playing(
    app: tauri::AppHandle,
    artist: String,
    title: String,
    duration: Option<u32>,
) -> Result<(), String> {
    let db = app.state::<Db>();
    let api_key = get_setting(&db, LASTFM_API_KEY_SETTING).ok_or("no api key")?;
    let secret = get_setting(&db, LASTFM_SECRET_SETTING).ok_or("no secret")?;
    let sk = get_setting(&db, LASTFM_SESSION_SETTING).ok_or("not authenticated")?;

    let dur_str = duration.map(|d| d.to_string()).unwrap_or_default();

    let mut params = BTreeMap::new();
    params.insert("api_key", api_key.as_str());
    params.insert("artist", artist.as_str());
    params.insert("method", "track.updateNowPlaying");
    params.insert("sk", sk.as_str());
    params.insert("track", title.as_str());
    if !dur_str.is_empty() {
        params.insert("duration", dur_str.as_str());
    }

    let sig = api_sig(&params, &secret);

    let mut form = vec![
        ("method", "track.updateNowPlaying"),
        ("api_key", &api_key),
        ("artist", &artist),
        ("track", &title),
        ("sk", &sk),
        ("api_sig", &sig),
        ("format", "json"),
    ];
    if !dur_str.is_empty() {
        form.push(("duration", &dur_str));
    }

    let client = Client::new();
    client
        .post(LASTFM_API_URL)
        .form(&form)
        .send()
        .await
        .map_err(|e| format!("now_playing failed: {e}"))?;

    Ok(())
}

/// Scrobble a track (call after 50% played or 4 minutes)
#[tauri::command]
pub async fn lastfm_scrobble(
    app: tauri::AppHandle,
    artist: String,
    title: String,
    timestamp: u64,
) -> Result<(), String> {
    let db = app.state::<Db>();
    let api_key = get_setting(&db, LASTFM_API_KEY_SETTING).ok_or("no api key")?;
    let secret = get_setting(&db, LASTFM_SECRET_SETTING).ok_or("no secret")?;
    let sk = get_setting(&db, LASTFM_SESSION_SETTING).ok_or("not authenticated")?;

    let ts_str = timestamp.to_string();

    let mut params = BTreeMap::new();
    params.insert("api_key", api_key.as_str());
    params.insert("artist[0]", artist.as_str());
    params.insert("method", "track.scrobble");
    params.insert("sk", sk.as_str());
    params.insert("timestamp[0]", ts_str.as_str());
    params.insert("track[0]", title.as_str());

    let sig = api_sig(&params, &secret);

    let client = Client::new();
    let resp = client
        .post(LASTFM_API_URL)
        .form(&[
            ("method", "track.scrobble"),
            ("api_key", &api_key),
            ("artist[0]", &artist),
            ("track[0]", &title),
            ("timestamp[0]", &ts_str),
            ("sk", &sk),
            ("api_sig", &sig),
            ("format", "json"),
        ])
        .send()
        .await
        .map_err(|e| format!("scrobble failed: {e}"))?;

    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("scrobble error: {body}"));
    }

    Ok(())
}

/// Save/get Last.fm settings
#[tauri::command]
pub fn lastfm_save_settings(
    app: tauri::AppHandle,
    api_key: String,
    secret: String,
) -> Result<(), String> {
    let db = app.state::<Db>();
    set_setting(&db, LASTFM_API_KEY_SETTING, &api_key);
    set_setting(&db, LASTFM_SECRET_SETTING, &secret);
    Ok(())
}

#[tauri::command]
pub fn lastfm_get_status(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let db = app.state::<Db>();
    Ok(get_setting(&db, LASTFM_SESSION_SETTING))
}
