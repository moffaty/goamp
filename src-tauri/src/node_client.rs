// Runs two background tasks after the goamp-node sidecar is ready:
//   1. 5-minute timer: build TasteProfile → POST /profiles/sync
//   2. WS listener on ws://localhost:7472/events:
//      on "profile:synced" → GET /profiles/peers → INSERT INTO peer_profiles → emit to frontend

use std::time::Duration;

use futures_util::StreamExt;
use tauri::{AppHandle, Emitter, Manager};
use tokio_tungstenite::tungstenite::Message;

const NODE_PORT: u16 = 7472;
const SYNC_INTERVAL_SECS: u64 = 300;

pub fn start(app: AppHandle) {
    let app1 = app.clone();
    let app2 = app.clone();

    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(SYNC_INTERVAL_SECS));
        interval.tick().await;
        loop {
            interval.tick().await;
            let profile = {
                let db = app1.state::<crate::db::Db>();
                let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
                crate::taste_profile::build_taste_profile(&conn, 200)
            };
            if let Err(e) = crate::aggregator::sync_to_node(&profile, NODE_PORT).await {
                eprintln!("[node_client] sync error: {e}");
            }
        }
    });

    tauri::async_runtime::spawn(async move {
        loop {
            match tokio_tungstenite::connect_async(format!("ws://localhost:{NODE_PORT}/events"))
                .await
            {
                Ok((mut ws, _)) => {
                    eprintln!("[node_client] WS connected to node");
                    while let Some(Ok(msg)) = ws.next().await {
                        if let Message::Text(text) = msg {
                            handle_ws_message(&app2, &text).await;
                        }
                    }
                    eprintln!("[node_client] WS disconnected");
                }
                Err(e) => {
                    eprintln!("[node_client] WS connect error: {e}");
                }
            }
            tokio::time::sleep(Duration::from_secs(5)).await;
        }
    });
}

async fn handle_ws_message(app: &AppHandle, text: &str) {
    let Ok(event) = serde_json::from_str::<serde_json::Value>(text) else {
        return;
    };
    if event["type"].as_str() != Some("profile:synced") {
        return;
    }

    let peer_count = event["payload"]["peer_count"].as_u64().unwrap_or(0) as u32;

    match crate::aggregator::fetch_peer_profiles(NODE_PORT).await {
        Ok(profiles) => {
            let db = app.state::<crate::db::Db>();
            let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
            for (hash, data) in &profiles {
                crate::aggregator::store_peer_profile(&conn, hash, data);
            }
        }
        Err(e) => eprintln!("[node_client] fetch_peer_profiles error: {e}"),
    }

    let _ = app.emit("goamp-node:profile-synced", peer_count);
}
