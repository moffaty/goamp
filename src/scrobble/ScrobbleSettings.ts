import {
  lastfmSaveSettings,
  lastfmGetAuthUrl,
  lastfmAuth,
  lastfmGetStatus,
} from "./scrobble-service";

let panel: HTMLDivElement | null = null;
let visible = false;

export function initScrobbleSettings() {
  // Panel created on first toggle
}

export function toggleScrobbleSettings() {
  if (!panel) createPanel();
  visible = !visible;
  panel!.style.display = visible ? "flex" : "none";
  if (visible) refreshStatus();
}

function createPanel() {
  panel = document.createElement("div");
  panel.id = "scrobble-settings-overlay";
  panel.style.cssText = `
    display: none; position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
    width: 420px; background: #1a1a2e; border: 2px solid #444; border-radius: 8px;
    color: #0f0; font-family: 'MS Sans Serif', 'Tahoma', sans-serif; font-size: 11px;
    z-index: 10000; flex-direction: column; padding: 0;
    box-shadow: 0 4px 20px rgba(0,0,0,0.8);
  `;

  panel.innerHTML = `
    <div style="background:#2a2a4a; padding:6px 10px; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #444;">
      <span style="font-weight:bold; color:#0f0;">Last.fm Scrobbling</span>
      <button id="scrobble-close" style="background:none; border:none; color:#888; cursor:pointer; font-size:14px;">✕</button>
    </div>
    <div style="padding: 12px;">
      <div id="scrobble-status" style="margin-bottom: 10px; padding: 6px 8px; background: #111; border: 1px solid #333; border-radius: 4px;"></div>

      <div style="margin-bottom: 8px;">
        <label style="display:block; margin-bottom:3px; color:#aaa;">API Key</label>
        <input id="scrobble-api-key" type="text" placeholder="Your Last.fm API key" style="width:100%; box-sizing:border-box; padding:4px 6px; background:#111; border:1px solid #444; color:#0f0; font-family:inherit; font-size:11px; border-radius:3px;" />
      </div>
      <div style="margin-bottom: 10px;">
        <label style="display:block; margin-bottom:3px; color:#aaa;">Shared Secret</label>
        <input id="scrobble-secret" type="password" placeholder="Your Last.fm shared secret" style="width:100%; box-sizing:border-box; padding:4px 6px; background:#111; border:1px solid #444; color:#0f0; font-family:inherit; font-size:11px; border-radius:3px;" />
      </div>
      <div style="display:flex; gap:6px; margin-bottom:10px;">
        <button id="scrobble-save-keys" style="flex:1; padding:5px; background:#333; border:1px solid #555; color:#0f0; cursor:pointer; font-family:inherit; font-size:11px; border-radius:3px;">Save Keys</button>
        <button id="scrobble-auth" style="flex:1; padding:5px; background:#333; border:1px solid #555; color:#0f0; cursor:pointer; font-family:inherit; font-size:11px; border-radius:3px;">Authorize</button>
      </div>
      <div id="scrobble-auth-flow" style="display:none;">
        <div style="margin-bottom:6px; color:#aaa;">Paste the token from the Last.fm page:</div>
        <div style="display:flex; gap:6px;">
          <input id="scrobble-token" type="text" placeholder="Token" style="flex:1; padding:4px 6px; background:#111; border:1px solid #444; color:#0f0; font-family:inherit; font-size:11px; border-radius:3px;" />
          <button id="scrobble-confirm" style="padding:5px 10px; background:#333; border:1px solid #555; color:#0f0; cursor:pointer; font-family:inherit; font-size:11px; border-radius:3px;">Confirm</button>
        </div>
      </div>
      <div style="margin-top:10px; color:#666; font-size:10px;">
        Get your API key at <span style="color:#888;">last.fm/api/account/create</span><br>
        Scrobbles after 50% played or 4 minutes.
      </div>
    </div>
  `;

  document.body.appendChild(panel);

  panel.querySelector("#scrobble-close")!.addEventListener("click", () => {
    toggleScrobbleSettings();
  });

  panel.querySelector("#scrobble-save-keys")!.addEventListener("click", async () => {
    const apiKey = (panel!.querySelector("#scrobble-api-key") as HTMLInputElement).value.trim();
    const secret = (panel!.querySelector("#scrobble-secret") as HTMLInputElement).value.trim();
    if (!apiKey || !secret) return;
    try {
      await lastfmSaveSettings(apiKey, secret);
      setStatus("Keys saved", "#0f0");
    } catch (e) {
      setStatus(`Error: ${e}`, "#f00");
    }
  });

  panel.querySelector("#scrobble-auth")!.addEventListener("click", async () => {
    try {
      const url = await lastfmGetAuthUrl();
      window.open(url, "_blank");
      panel!.querySelector<HTMLDivElement>("#scrobble-auth-flow")!.style.display = "block";
      setStatus("Authorize in browser, then paste token below", "#ff0");
    } catch (e) {
      setStatus(`Error: ${e}`, "#f00");
    }
  });

  panel.querySelector("#scrobble-confirm")!.addEventListener("click", async () => {
    const token = (panel!.querySelector("#scrobble-token") as HTMLInputElement).value.trim();
    if (!token) return;
    try {
      const session = await lastfmAuth(token);
      setStatus(`Authenticated as: ${session.name}`, "#0f0");
      panel!.querySelector<HTMLDivElement>("#scrobble-auth-flow")!.style.display = "none";
      localStorage.setItem("goamp_lastfm_enabled", "1");
    } catch (e) {
      setStatus(`Auth failed: ${e}`, "#f00");
    }
  });
}

function setStatus(text: string, color: string) {
  const el = panel?.querySelector("#scrobble-status");
  if (el) {
    (el as HTMLDivElement).textContent = text;
    (el as HTMLDivElement).style.color = color;
  }
}

async function refreshStatus() {
  try {
    const sessionKey = await lastfmGetStatus();
    if (sessionKey) {
      setStatus("Connected to Last.fm", "#0f0");
    } else {
      setStatus("Not connected", "#888");
    }
  } catch {
    setStatus("Not connected", "#888");
  }
}
