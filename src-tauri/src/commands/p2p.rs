use serde::{Deserialize, Serialize};

const NODE_PORT: u16 = 7472;

fn node_url(path: &str) -> String {
    format!("http://localhost:{NODE_PORT}{path}")
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NodeHealth {
    pub status: String,
    pub peer_count: u32,
    pub uptime_secs: u64,
    pub version: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PeerInfo {
    pub id: String,
    pub addrs: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PeersResponse {
    pub peers: Vec<PeerInfo>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CatalogTrack {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub source: String,
    pub duration: f64,
}

#[tauri::command]
pub async fn p2p_health() -> Result<NodeHealth, String> {
    let resp = crate::http::CLIENT
        .get(node_url("/health"))
        .send()
        .await
        .map_err(|e| format!("p2p_health: {e}"))?;
    resp.json::<NodeHealth>()
        .await
        .map_err(|e| format!("p2p_health parse: {e}"))
}

#[tauri::command]
pub async fn p2p_peers() -> Result<Vec<PeerInfo>, String> {
    let resp = crate::http::CLIENT
        .get(node_url("/peers"))
        .send()
        .await
        .map_err(|e| format!("p2p_peers: {e}"))?;
    let body = resp
        .json::<PeersResponse>()
        .await
        .map_err(|e| format!("p2p_peers parse: {e}"))?;
    Ok(body.peers)
}

#[tauri::command]
pub async fn p2p_catalog_search(
    q: String,
    genres: Option<Vec<String>>,
    limit: Option<u32>,
) -> Result<Vec<CatalogTrack>, String> {
    let mut url = format!(
        "{}/catalog/search?q={}",
        node_url(""),
        urlencoding::encode(&q)
    );
    if let Some(gs) = &genres {
        if !gs.is_empty() {
            url.push_str(&format!("&genre={}", gs.join(",")));
        }
    }
    url.push_str(&format!("&limit={}", limit.unwrap_or(20)));

    let resp = crate::http::CLIENT
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("p2p_catalog_search: {e}"))?;

    #[derive(Deserialize)]
    struct SearchResp {
        tracks: Vec<CatalogTrack>,
    }
    let body = resp
        .json::<SearchResp>()
        .await
        .map_err(|e| format!("p2p_catalog_search parse: {e}"))?;
    Ok(body.tracks)
}

#[tauri::command]
pub async fn p2p_catalog_announce(track_id: String) -> Result<(), String> {
    let resp = crate::http::CLIENT
        .post(node_url("/catalog/announce"))
        .json(&serde_json::json!({ "track_id": track_id }))
        .send()
        .await
        .map_err(|e| format!("p2p_catalog_announce: {e}"))?;

    if resp.status().is_success() {
        Ok(())
    } else {
        let body = resp.text().await.unwrap_or_default();
        Err(format!("announce failed: {body}"))
    }
}
