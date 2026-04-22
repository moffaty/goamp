//! Tauri commands glue frontend to goamp-node /account/* + local keychain.

use crate::account as acct;
use serde::{Deserialize, Serialize};
use serde_json::Value;

const NODE_BASE: &str = "http://127.0.0.1:7472";

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateAccountResult {
    pub mnemonic: String,
    pub account_pub: String,
    pub quiz_positions: Vec<u8>,
}

fn http() -> reqwest::blocking::Client {
    reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .expect("reqwest client")
}

fn pick_quiz_positions() -> Vec<u8> {
    use rand::seq::SliceRandom;
    let mut rng = rand::thread_rng();
    let mut all: Vec<u8> = (0..12).collect();
    all.shuffle(&mut rng);
    all.into_iter().take(3).collect()
}

#[tauri::command]
pub fn account_create(device_name: String, os: String) -> Result<CreateAccountResult, String> {
    let resp = http()
        .post(format!("{}/account/create", NODE_BASE))
        .json(&serde_json::json!({ "device_name": device_name, "os": os }))
        .send()
        .map_err(|e| format!("node request: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("node status: {}", resp.status()));
    }
    let body: Value = resp.json().map_err(|e| format!("decode: {}", e))?;
    let mnemonic = body["mnemonic"]
        .as_str()
        .ok_or("missing mnemonic")?
        .to_string();
    let account_pub = body["account_pub"]
        .as_str()
        .ok_or("missing account_pub")?
        .to_string();
    let sub_pub = body["sub_pub"]
        .as_str()
        .ok_or("missing sub_pub")?
        .to_string();
    let sub_sk = body["sub_sk"].as_str().ok_or("missing sub_sk")?.to_string();
    let state_key = body["state_key"]
        .as_str()
        .ok_or("missing state_key")?
        .to_string();

    acct::save_account(&acct::StoredAccount {
        account_pub: account_pub.clone(),
        sub_pub,
        sub_sk_b64: sub_sk,
        state_key_b64: state_key,
    })
    .map_err(|e| format!("keychain: {}", e))?;

    Ok(CreateAccountResult {
        mnemonic,
        account_pub,
        quiz_positions: pick_quiz_positions(),
    })
}

#[derive(Debug, Serialize)]
pub struct LoadAccountResult {
    pub account_pub: String,
    pub sub_pub: String,
    pub provisioned: bool,
}

#[tauri::command]
pub fn account_current() -> Result<Option<LoadAccountResult>, String> {
    let Some(pub_) = acct::current_account_pub().map_err(|e| e.to_string())? else {
        return Ok(None);
    };
    let a = acct::load_account(&pub_).map_err(|e| e.to_string())?;
    Ok(Some(LoadAccountResult {
        account_pub: a.account_pub,
        sub_pub: a.sub_pub,
        provisioned: true,
    }))
}

#[tauri::command]
pub fn account_forget(account_pub: String) -> Result<(), String> {
    acct::delete_account(&account_pub).map_err(|e| e.to_string())
}

#[derive(Debug, Serialize)]
pub struct RecoverAccountResult {
    pub account_pub: String,
    pub sub_pub: String,
    pub manifest_version: u64,
}

#[tauri::command]
pub fn account_recover(
    mnemonic: String,
    device_name: String,
    os: String,
    relay_url: String,
) -> Result<RecoverAccountResult, String> {
    let resp = http()
        .post(format!("{}/account/recover", NODE_BASE))
        .json(&serde_json::json!({
            "mnemonic": mnemonic,
            "device_name": device_name,
            "os": os,
            "relay_url": relay_url,
        }))
        .send()
        .map_err(|e| format!("node request: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("node status: {}", resp.status()));
    }
    let body: Value = resp.json().map_err(|e| format!("decode: {}", e))?;
    let account_pub = body["account_pub"]
        .as_str()
        .ok_or("missing account_pub")?
        .to_string();
    let sub_pub = body["sub_pub"]
        .as_str()
        .ok_or("missing sub_pub")?
        .to_string();
    let sub_sk = body["sub_sk"].as_str().ok_or("missing sub_sk")?.to_string();
    let state_key = body["state_key"]
        .as_str()
        .ok_or("missing state_key")?
        .to_string();
    let version = body["manifest_version"]
        .as_u64()
        .ok_or("missing manifest_version")?;

    acct::save_account(&acct::StoredAccount {
        account_pub: account_pub.clone(),
        sub_pub: sub_pub.clone(),
        sub_sk_b64: sub_sk,
        state_key_b64: state_key,
    })
    .map_err(|e| format!("keychain: {}", e))?;

    Ok(RecoverAccountResult {
        account_pub,
        sub_pub,
        manifest_version: version,
    })
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DeviceInfo {
    pub sub_pub: String,
    pub name: String,
    pub os: String,
    pub added_at: String,
}

#[derive(Debug, Serialize)]
pub struct DevicesList {
    pub devices: Vec<DeviceInfo>,
    pub version: u64,
}

#[tauri::command]
pub fn account_list_devices(account_pub: String, relay_url: String) -> Result<DevicesList, String> {
    let resp = http()
        .get(format!("{}/account/list-devices", NODE_BASE))
        .query(&[("account_pub", &account_pub), ("relay_url", &relay_url)])
        .send()
        .map_err(|e| format!("node request: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("node status: {}", resp.status()));
    }
    let body: Value = resp.json().map_err(|e| format!("decode: {}", e))?;
    let version = body["version"].as_u64().unwrap_or(0);
    let mut devices = Vec::new();
    if let Some(arr) = body["devices"].as_array() {
        for d in arr {
            devices.push(DeviceInfo {
                sub_pub: d["sub_pub"].as_str().unwrap_or("").to_string(),
                name: d["name"].as_str().unwrap_or("").to_string(),
                os: d["os"].as_str().unwrap_or("").to_string(),
                added_at: d["added_at"].as_str().unwrap_or("").to_string(),
            });
        }
    }
    Ok(DevicesList { devices, version })
}

#[tauri::command]
pub fn account_revoke_device(
    mnemonic: String,
    account_pub: String,
    sub_pub_to_revoke: String,
    reason: String,
    relay_url: String,
) -> Result<u64, String> {
    let a = acct::load_account(&account_pub).map_err(|e| format!("keychain: {}", e))?;
    let resp = http()
        .post(format!("{}/account/revoke", NODE_BASE))
        .json(&serde_json::json!({
            "mnemonic": mnemonic,
            "sub_sk_b64": a.sub_sk_b64,
            "sub_pub_to_revoke": sub_pub_to_revoke,
            "reason": reason,
            "relay_url": relay_url,
        }))
        .send()
        .map_err(|e| format!("node request: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("node status: {}", resp.status()));
    }
    let body: Value = resp.json().map_err(|e| format!("decode: {}", e))?;
    Ok(body["manifest_version"].as_u64().unwrap_or(0))
}
