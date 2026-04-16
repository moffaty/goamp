import { openUrl } from "@tauri-apps/plugin-opener";
import { scrobble } from "../services/index";

let panel: HTMLDivElement | null = null;
let visible = false;

export function initScrobbleSettings() {
  // Panel created on first toggle
}

export function toggleScrobbleSettings() {
  if (!panel) createPanel();
  if (!panel) return;
  visible = !visible;
  panel.style.display = visible ? "flex" : "none";
  if (visible) refreshAllStatus();
}

function createPanel() {
  panel = document.createElement("div");
  panel.id = "scrobble-settings-overlay";
  panel.style.cssText = `
    display: none; position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
    width: 460px; max-height: 80vh; background: #1a1a2e; border: 2px solid #444; border-radius: 8px;
    color: #0f0; font-family: 'MS Sans Serif', 'Tahoma', sans-serif; font-size: 11px;
    z-index: 10000; flex-direction: column; padding: 0;
    box-shadow: 0 4px 20px rgba(0,0,0,0.8);
  `;

  panel.innerHTML = `
    <div style="background:#2a2a4a; padding:6px 10px; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #444;">
      <span style="font-weight:bold; color:#0f0;">Scrobbling Settings</span>
      <button id="scrobble-close" style="background:none; border:none; color:#888; cursor:pointer; font-size:14px;">✕</button>
    </div>
    <div style="padding: 12px; overflow-y: auto; max-height: calc(80vh - 40px);">
      <!-- Queue status -->
      <div id="scrobble-queue-bar" style="margin-bottom:10px; padding:6px 8px; background:#111; border:1px solid #333; border-radius:4px; display:flex; justify-content:space-between; align-items:center;">
        <span id="scrobble-queue-text" style="color:#888;"></span>
        <button id="scrobble-flush-btn" style="padding:2px 8px; background:#333; border:1px solid #555; color:#fc0; cursor:pointer; font-size:10px; border-radius:2px; display:none;">Flush</button>
      </div>

      <!-- Last.fm section -->
      <div style="border:1px solid #333; border-radius:4px; padding:10px; margin-bottom:10px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <span style="font-weight:bold; color:#d51007;">Last.fm</span>
          <span id="lastfm-status-badge" style="font-size:10px; color:#888;"></span>
        </div>
        <div style="margin-bottom: 8px;">
          <label style="display:block; margin-bottom:3px; color:#aaa;">API Key</label>
          <input id="scrobble-api-key" type="text" placeholder="Your Last.fm API key" style="width:100%; box-sizing:border-box; padding:4px 6px; background:#111; border:1px solid #444; color:#0f0; font-family:inherit; font-size:11px; border-radius:3px;" />
        </div>
        <div style="margin-bottom: 8px;">
          <label style="display:block; margin-bottom:3px; color:#aaa;">Shared Secret</label>
          <input id="scrobble-secret" type="password" placeholder="Your Last.fm shared secret" style="width:100%; box-sizing:border-box; padding:4px 6px; background:#111; border:1px solid #444; color:#0f0; font-family:inherit; font-size:11px; border-radius:3px;" />
        </div>
        <div style="display:flex; gap:6px; margin-bottom:8px;">
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
        <div id="lastfm-msg" style="color:#888; margin-top:4px; font-size:10px;"></div>
        <div style="margin-top:6px; color:#666; font-size:10px;">
          Get your API key at <span style="color:#888;">last.fm/api/account/create</span>
        </div>
      </div>

      <!-- ListenBrainz section -->
      <div style="border:1px solid #333; border-radius:4px; padding:10px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <span style="font-weight:bold; color:#eb743b;">ListenBrainz</span>
          <span id="lb-status-badge" style="font-size:10px; color:#888;"></span>
        </div>
        <div style="margin-bottom:8px;">
          <label style="display:block; margin-bottom:3px; color:#aaa;">User Token</label>
          <div style="display:flex; gap:6px;">
            <input id="lb-token" type="text" placeholder="Your ListenBrainz user token" style="flex:1; padding:4px 6px; background:#111; border:1px solid #444; color:#eb743b; font-family:inherit; font-size:11px; border-radius:3px;" />
            <button id="lb-save" style="padding:5px 10px; background:#333; border:1px solid #555; color:#eb743b; cursor:pointer; font-family:inherit; font-size:11px; border-radius:3px;">Connect</button>
          </div>
        </div>
        <div style="display:flex; gap:6px; align-items:center;">
          <button id="lb-logout" style="padding:3px 8px; background:#333; border:1px solid #555; color:#888; cursor:pointer; font-size:10px; border-radius:2px; display:none;">Disconnect</button>
        </div>
        <div id="lb-msg" style="color:#888; margin-top:4px; font-size:10px;"></div>
        <div style="margin-top:6px; color:#666; font-size:10px;">
          Get your token at <span style="color:#888;">listenbrainz.org/settings</span>
        </div>
      </div>

      <div style="margin-top:10px; color:#666; font-size:10px; text-align:center;">
        Scrobbles after 50% played or 4 minutes. Failed scrobbles are queued for retry.
      </div>
    </div>
  `;

  document.body.appendChild(panel);

  // ─── Close ───
  panel.querySelector("#scrobble-close")!.addEventListener("click", () => {
    toggleScrobbleSettings();
  });

  // ─── Queue flush ───
  panel.querySelector("#scrobble-flush-btn")!.addEventListener("click", async () => {
    const btn = panel?.querySelector("#scrobble-flush-btn") as HTMLButtonElement | null;
    if (btn) btn.textContent = "...";
    try {
      const count = await scrobble.flushQueue();
      if (btn) btn.textContent = count > 0 ? `Flushed ${count}` : "Nothing to flush";
      setTimeout(() => refreshAllStatus(), 1000);
    } catch (e) {
      if (btn) btn.textContent = "Error";
      console.error("[GOAMP] Flush failed:", e);
    }
  });

  // ─── Last.fm: Save keys ───
  panel.querySelector("#scrobble-save-keys")!.addEventListener("click", async () => {
    const apiKey = (panel?.querySelector("#scrobble-api-key") as HTMLInputElement | null)?.value.trim() ?? "";
    const secret = (panel?.querySelector("#scrobble-secret") as HTMLInputElement | null)?.value.trim() ?? "";
    if (!apiKey || !secret) return;
    try {
      await scrobble.lastfmSaveSettings(apiKey, secret);
      setMsg("lastfm-msg", "Keys saved", "#0f0");
    } catch (e) {
      setMsg("lastfm-msg", `Error: ${e}`, "#f00");
    }
  });

  // ─── Last.fm: Authorize ───
  panel.querySelector("#scrobble-auth")!.addEventListener("click", async () => {
    try {
      const url = await scrobble.lastfmGetAuthUrl();
      openUrl(url);
      const authFlow = panel?.querySelector<HTMLDivElement>("#scrobble-auth-flow");
      if (authFlow) authFlow.style.display = "block";
      setMsg("lastfm-msg", "Authorize in browser, then paste token below", "#ff0");
    } catch (e) {
      setMsg("lastfm-msg", `Error: ${e}`, "#f00");
    }
  });

  // ─── Last.fm: Confirm token ───
  panel.querySelector("#scrobble-confirm")!.addEventListener("click", async () => {
    const token = (panel?.querySelector("#scrobble-token") as HTMLInputElement | null)?.value.trim() ?? "";
    if (!token) return;
    try {
      const session = await scrobble.lastfmAuth(token);
      setMsg("lastfm-msg", `Authenticated as: ${session.name}`, "#0f0");
      const authFlow = panel?.querySelector<HTMLDivElement>("#scrobble-auth-flow");
      if (authFlow) authFlow.style.display = "none";
      localStorage.setItem("goamp_lastfm_enabled", "1");
      refreshAllStatus();
    } catch (e) {
      setMsg("lastfm-msg", `Auth failed: ${e}`, "#f00");
    }
  });

  // ─── ListenBrainz: Save token ───
  panel.querySelector("#lb-save")!.addEventListener("click", async () => {
    const token = (panel?.querySelector("#lb-token") as HTMLInputElement | null)?.value.trim() ?? "";
    if (!token) return;
    const btn = panel?.querySelector("#lb-save") as HTMLButtonElement | null;
    if (btn) btn.textContent = "...";
    try {
      const username = await scrobble.listenbrainzSaveToken(token);
      setMsg("lb-msg", `Connected as: ${username}`, "#0f0");
      localStorage.setItem("goamp_lb_enabled", "1");
      if (btn) btn.textContent = "Connect";
      refreshAllStatus();
    } catch (e) {
      setMsg("lb-msg", `Error: ${e}`, "#f00");
      if (btn) btn.textContent = "Connect";
    }
  });

  // ─── ListenBrainz: Logout ───
  panel.querySelector("#lb-logout")!.addEventListener("click", async () => {
    await scrobble.listenbrainzLogout();
    localStorage.removeItem("goamp_lb_enabled");
    setMsg("lb-msg", "Disconnected", "#888");
    refreshAllStatus();
  });
}

function setMsg(id: string, text: string, color: string) {
  const el = panel?.querySelector(`#${id}`);
  if (el) {
    (el as HTMLDivElement).textContent = text;
    (el as HTMLDivElement).style.color = color;
  }
}

async function refreshAllStatus() {
  // Last.fm status
  try {
    const sessionKey = await scrobble.lastfmGetStatus();
    const badge = panel?.querySelector("#lastfm-status-badge") as HTMLSpanElement;
    if (badge) {
      if (sessionKey) {
        badge.textContent = "Connected";
        badge.style.color = "#0f0";
      } else {
        badge.textContent = "Not connected";
        badge.style.color = "#888";
      }
    }
  } catch {
    // ignore
  }

  // ListenBrainz status
  try {
    const username = await scrobble.listenbrainzGetStatus();
    const badge = panel?.querySelector("#lb-status-badge") as HTMLSpanElement;
    const logoutBtn = panel?.querySelector("#lb-logout") as HTMLButtonElement;
    if (badge) {
      if (username) {
        badge.textContent = username;
        badge.style.color = "#0f0";
        if (logoutBtn) logoutBtn.style.display = "inline-block";
      } else {
        badge.textContent = "Not connected";
        badge.style.color = "#888";
        if (logoutBtn) logoutBtn.style.display = "none";
      }
    }
  } catch {
    // ignore
  }

  // Queue status
  try {
    const status = await scrobble.getStatus();
    const text = panel?.querySelector("#scrobble-queue-text") as HTMLSpanElement;
    const flushBtn = panel?.querySelector("#scrobble-flush-btn") as HTMLButtonElement;
    if (text) {
      if (status.queue_count > 0) {
        text.textContent = `${status.queue_count} scrobble(s) queued`;
        text.style.color = "#fc0";
        if (flushBtn) {
          flushBtn.style.display = "inline-block";
          flushBtn.textContent = "Flush";
        }
      } else {
        text.textContent = "No queued scrobbles";
        text.style.color = "#888";
        if (flushBtn) flushBtn.style.display = "none";
      }
    }
  } catch {
    // ignore
  }
}
