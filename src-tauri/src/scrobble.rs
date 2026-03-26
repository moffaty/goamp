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

const LB_API_URL: &str = "https://api.listenbrainz.org/1";
const LB_TOKEN_SETTING: &str = "listenbrainz_token";
const LB_USERNAME_SETTING: &str = "listenbrainz_username";

#[derive(Debug, Serialize, Deserialize)]
pub struct LastfmSession {
    pub name: String,
    pub key: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct AuthSessionResponse {
    session: LastfmSession,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ScrobbleStatus {
    pub lastfm: bool,
    pub listenbrainz: bool,
    pub queue_count: u32,
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

// ─── Queue helpers ───

fn queue_add(db: &Db, artist: &str, track: &str, timestamp: u64, duration: u32, service: &str) {
    let conn = db.0.lock().unwrap();
    let _ = conn.execute(
        "INSERT INTO scrobble_queue (artist, track, timestamp, duration, service) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![artist, track, timestamp, duration, service],
    );
}

fn queue_count(db: &Db) -> u32 {
    let conn = db.0.lock().unwrap();
    conn.query_row(
        "SELECT COUNT(*) FROM scrobble_queue WHERE status = 'pending'",
        [],
        |row| row.get(0),
    )
    .unwrap_or(0)
}

// ─── Last.fm commands ───

#[tauri::command]
pub fn lastfm_get_auth_url(app: tauri::AppHandle) -> Result<String, String> {
    let db = app.state::<Db>();
    let api_key = get_setting(&db, LASTFM_API_KEY_SETTING)
        .ok_or("Last.fm API key not set. Go to Settings to configure.")?;
    Ok(format!("https://www.last.fm/api/auth/?api_key={}", api_key))
}

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

#[tauri::command]
pub async fn lastfm_scrobble(
    app: tauri::AppHandle,
    artist: String,
    title: String,
    timestamp: u64,
    duration: Option<u32>,
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
    let result = client
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
        .await;

    match result {
        Ok(resp) if resp.status().is_success() => Ok(()),
        Ok(resp) => {
            let body = resp.text().await.unwrap_or_default();
            // Queue for retry
            queue_add(
                &db,
                &artist,
                &title,
                timestamp,
                duration.unwrap_or(0),
                "lastfm",
            );
            Err(format!("scrobble error (queued): {body}"))
        }
        Err(e) => {
            // Network error — queue for retry
            queue_add(
                &db,
                &artist,
                &title,
                timestamp,
                duration.unwrap_or(0),
                "lastfm",
            );
            Err(format!("scrobble failed (queued): {e}"))
        }
    }
}

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

// ─── ListenBrainz commands ───

#[tauri::command]
pub async fn listenbrainz_save_token(
    app: tauri::AppHandle,
    token: String,
) -> Result<String, String> {
    // Validate token
    let client = Client::new();
    let resp = client
        .get(format!("{}/validate-token", LB_API_URL))
        .header("Authorization", format!("Token {}", token))
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;

    let body = resp.text().await.map_err(|e| format!("read failed: {e}"))?;

    #[derive(Deserialize)]
    struct ValidateResponse {
        valid: bool,
        user_name: Option<String>,
    }

    let parsed: ValidateResponse =
        serde_json::from_str(&body).map_err(|e| format!("parse error: {e}"))?;

    if !parsed.valid {
        return Err("Invalid token".into());
    }

    let username = parsed.user_name.unwrap_or_default();
    let db = app.state::<Db>();
    set_setting(&db, LB_TOKEN_SETTING, &token);
    set_setting(&db, LB_USERNAME_SETTING, &username);

    eprintln!("[GOAMP] ListenBrainz authenticated as: {}", username);
    Ok(username)
}

#[tauri::command]
pub fn listenbrainz_get_status(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let db = app.state::<Db>();
    Ok(get_setting(&db, LB_USERNAME_SETTING))
}

#[tauri::command]
pub fn listenbrainz_logout(app: tauri::AppHandle) -> Result<(), String> {
    let db = app.state::<Db>();
    let conn = db.0.lock().unwrap();
    let _ = conn.execute("DELETE FROM settings WHERE key LIKE 'listenbrainz_%'", []);
    Ok(())
}

#[tauri::command]
pub async fn listenbrainz_now_playing(
    app: tauri::AppHandle,
    artist: String,
    title: String,
) -> Result<(), String> {
    let db = app.state::<Db>();
    let token = get_setting(&db, LB_TOKEN_SETTING).ok_or("not authenticated")?;

    let payload = serde_json::json!({
        "listen_type": "playing_now",
        "payload": [{
            "track_metadata": {
                "artist_name": artist,
                "track_name": title
            }
        }]
    });

    let client = Client::new();
    client
        .post(format!("{}/submit-listens", LB_API_URL))
        .header("Authorization", format!("Token {}", token))
        .header("Content-Type", "application/json")
        .body(payload.to_string())
        .send()
        .await
        .map_err(|e| format!("now_playing failed: {e}"))?;

    Ok(())
}

#[tauri::command]
pub async fn listenbrainz_scrobble(
    app: tauri::AppHandle,
    artist: String,
    title: String,
    timestamp: u64,
    duration: Option<u32>,
) -> Result<(), String> {
    let db = app.state::<Db>();
    let token = get_setting(&db, LB_TOKEN_SETTING).ok_or("not authenticated")?;

    let payload = serde_json::json!({
        "listen_type": "single",
        "payload": [{
            "listened_at": timestamp,
            "track_metadata": {
                "artist_name": artist,
                "track_name": title
            }
        }]
    });

    let client = Client::new();
    let result = client
        .post(format!("{}/submit-listens", LB_API_URL))
        .header("Authorization", format!("Token {}", token))
        .header("Content-Type", "application/json")
        .body(payload.to_string())
        .send()
        .await;

    match result {
        Ok(resp) if resp.status().is_success() => Ok(()),
        Ok(resp) => {
            let body = resp.text().await.unwrap_or_default();
            queue_add(
                &db,
                &artist,
                &title,
                timestamp,
                duration.unwrap_or(0),
                "listenbrainz",
            );
            Err(format!("listen submit error (queued): {body}"))
        }
        Err(e) => {
            queue_add(
                &db,
                &artist,
                &title,
                timestamp,
                duration.unwrap_or(0),
                "listenbrainz",
            );
            Err(format!("listen submit failed (queued): {e}"))
        }
    }
}

// ─── Scrobble queue ───

#[tauri::command]
pub fn scrobble_get_status(app: tauri::AppHandle) -> Result<ScrobbleStatus, String> {
    let db = app.state::<Db>();
    Ok(ScrobbleStatus {
        lastfm: get_setting(&db, LASTFM_SESSION_SETTING).is_some(),
        listenbrainz: get_setting(&db, LB_TOKEN_SETTING).is_some(),
        queue_count: queue_count(&db),
    })
}

#[tauri::command]
pub async fn scrobble_flush_queue(app: tauri::AppHandle) -> Result<u32, String> {
    let db = app.state::<Db>();

    // Read pending items (max 50 per flush)
    let items: Vec<(i64, String, String, u64, String)> = {
        let conn = db.0.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT id, artist, track, timestamp, service FROM scrobble_queue WHERE status = 'pending' ORDER BY id LIMIT 50",
            )
            .map_err(|e| format!("query failed: {e}"))?;
        let result = stmt
            .query_map([], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            })
            .map_err(|e| format!("query failed: {e}"))?
            .filter_map(|r| r.ok())
            .collect();
        result
    };

    if items.is_empty() {
        return Ok(0);
    }

    let client = Client::new();
    let mut flushed = 0u32;

    for (id, artist, track, timestamp, service) in &items {
        let ok = match service.as_str() {
            "lastfm" => flush_lastfm_item(&db, &client, artist, track, *timestamp)
                .await
                .is_ok(),
            "listenbrainz" => flush_lb_item(&db, &client, artist, track, *timestamp)
                .await
                .is_ok(),
            _ => false,
        };

        let conn = db.0.lock().unwrap();
        if ok {
            let _ = conn.execute("DELETE FROM scrobble_queue WHERE id = ?1", [id]);
            flushed += 1;
        } else {
            let _ = conn.execute(
                "UPDATE scrobble_queue SET attempts = attempts + 1 WHERE id = ?1",
                [id],
            );
        }
    }

    if flushed > 0 {
        eprintln!(
            "[GOAMP] Flushed {}/{} queued scrobbles",
            flushed,
            items.len()
        );
    }

    Ok(flushed)
}

async fn flush_lastfm_item(
    db: &Db,
    client: &Client,
    artist: &str,
    track: &str,
    timestamp: u64,
) -> Result<(), String> {
    let api_key = get_setting(db, LASTFM_API_KEY_SETTING).ok_or("no api key")?;
    let secret = get_setting(db, LASTFM_SECRET_SETTING).ok_or("no secret")?;
    let sk = get_setting(db, LASTFM_SESSION_SETTING).ok_or("not authenticated")?;

    let ts_str = timestamp.to_string();

    let mut params = BTreeMap::new();
    params.insert("api_key", api_key.as_str());
    params.insert("artist[0]", artist);
    params.insert("method", "track.scrobble");
    params.insert("sk", sk.as_str());
    params.insert("timestamp[0]", ts_str.as_str());
    params.insert("track[0]", track);

    let sig = api_sig(&params, &secret);

    let resp = client
        .post(LASTFM_API_URL)
        .form(&[
            ("method", "track.scrobble"),
            ("api_key", &api_key),
            ("artist[0]", artist),
            ("track[0]", track),
            ("timestamp[0]", &ts_str),
            ("sk", &sk),
            ("api_sig", &sig),
            ("format", "json"),
        ])
        .send()
        .await
        .map_err(|e| format!("{e}"))?;

    if resp.status().is_success() {
        Ok(())
    } else {
        Err("failed".into())
    }
}

async fn flush_lb_item(
    db: &Db,
    client: &Client,
    artist: &str,
    track: &str,
    timestamp: u64,
) -> Result<(), String> {
    let token = get_setting(db, LB_TOKEN_SETTING).ok_or("not authenticated")?;

    let payload = serde_json::json!({
        "listen_type": "single",
        "payload": [{
            "listened_at": timestamp,
            "track_metadata": {
                "artist_name": artist,
                "track_name": track
            }
        }]
    });

    let resp = client
        .post(format!("{}/submit-listens", LB_API_URL))
        .header("Authorization", format!("Token {}", token))
        .header("Content-Type", "application/json")
        .body(payload.to_string())
        .send()
        .await
        .map_err(|e| format!("{e}"))?;

    if resp.status().is_success() {
        Ok(())
    } else {
        Err("failed".into())
    }
}
