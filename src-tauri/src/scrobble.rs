use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use tauri::Manager;

use crate::db::Db;

const LASTFM_API_URL: &str = "https://ws.audioscrobbler.com/2.0/";
// Users should set their own API key via settings
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

fn md5_hex(input: &str) -> String {
    // Simple MD5 — use a proper implementation
    // For now using a basic approach with reqwest's dependency chain
    format!("{:x}", md5_compute(input))
}

fn md5_compute(input: &str) -> u128 {
    // Minimal MD5 for Last.fm API signature
    // Last.fm requires MD5 — we implement it inline to avoid extra deps
    let bytes = input.as_bytes();
    let mut state: [u32; 4] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];

    let orig_len = bytes.len();
    let mut padded = bytes.to_vec();
    padded.push(0x80);
    while padded.len() % 64 != 56 {
        padded.push(0);
    }
    let bit_len = (orig_len as u64) * 8;
    padded.extend_from_slice(&bit_len.to_le_bytes());

    static S: [u32; 64] = [
        7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5,
        9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10,
        15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
    ];
    static K: [u32; 64] = [
        0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613,
        0xfd469501, 0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193,
        0xa679438e, 0x49b40821, 0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d,
        0x02441453, 0xd8a1e681, 0xe7d3fbc8, 0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed,
        0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a, 0xfffa3942, 0x8771f681, 0x6d9d6122,
        0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70, 0x289b7ec6, 0xeaa127fa,
        0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665, 0xf4292244,
        0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
        0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb,
        0xeb86d391,
    ];

    for chunk in padded.chunks(64) {
        let mut m = [0u32; 16];
        for (i, c) in chunk.chunks(4).enumerate() {
            m[i] = u32::from_le_bytes([c[0], c[1], c[2], c[3]]);
        }

        let [mut a, mut b, mut c, mut d] = state;

        for i in 0..64 {
            let (f, g) = match i {
                0..=15 => ((b & c) | ((!b) & d), i),
                16..=31 => ((d & b) | ((!d) & c), (5 * i + 1) % 16),
                32..=47 => (b ^ c ^ d, (3 * i + 5) % 16),
                _ => (c ^ (b | (!d)), (7 * i) % 16),
            };

            let temp = d;
            d = c;
            c = b;
            b = b.wrapping_add(
                (a.wrapping_add(f).wrapping_add(K[i]).wrapping_add(m[g])).rotate_left(S[i]),
            );
            a = temp;
        }

        state[0] = state[0].wrapping_add(a);
        state[1] = state[1].wrapping_add(b);
        state[2] = state[2].wrapping_add(c);
        state[3] = state[3].wrapping_add(d);
    }

    let mut result = [0u8; 16];
    for (i, &s) in state.iter().enumerate() {
        result[i * 4..i * 4 + 4].copy_from_slice(&s.to_le_bytes());
    }

    u128::from_be_bytes(result)
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

    // Save session key
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
