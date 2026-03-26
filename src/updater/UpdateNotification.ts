import { check } from "@tauri-apps/plugin-updater";

let banner: HTMLDivElement | null = null;

export async function checkForUpdates() {
  try {
    const update = await check();
    if (!update) return;

    showUpdateBanner(update.version, async () => {
      try {
        setBannerText("Downloading...");
        await update.downloadAndInstall((event) => {
          if (event.event === "Started" && event.data.contentLength) {
            setBannerText(`Downloading... (${Math.round(event.data.contentLength / 1024 / 1024)}MB)`);
          }
        });
        setBannerText("Installed! Restart to apply.");
      } catch (e) {
        setBannerText(`Update failed: ${e}`);
        console.error("[GOAMP] Update failed:", e);
      }
    });
  } catch (e) {
    console.warn("[GOAMP] Update check failed:", e);
  }
}

function showUpdateBanner(version: string, onInstall: () => void) {
  if (banner) return;

  banner = document.createElement("div");
  banner.id = "update-banner";
  banner.style.cssText = `
    position: fixed; bottom: 10px; right: 10px; z-index: 15000;
    background: #1a1a2e; border: 1px solid #fc0; border-radius: 6px;
    padding: 8px 12px; font-family: 'MS Sans Serif', 'Tahoma', sans-serif;
    font-size: 11px; color: #fc0; display: flex; align-items: center; gap: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.8);
  `;

  banner.innerHTML = `
    <span id="update-text">v${version} available</span>
    <button id="update-install" style="padding:3px 8px; background:#fc0; border:none; color:#000; cursor:pointer; font-family:inherit; font-size:10px; border-radius:3px; font-weight:bold;">Update</button>
    <button id="update-dismiss" style="background:none; border:none; color:#666; cursor:pointer; font-size:12px;">✕</button>
  `;

  document.body.appendChild(banner);

  banner.querySelector("#update-install")!.addEventListener("click", onInstall);
  banner.querySelector("#update-dismiss")!.addEventListener("click", () => {
    banner?.remove();
    banner = null;
  });
}

function setBannerText(text: string) {
  const el = banner?.querySelector("#update-text");
  if (el) el.textContent = text;
  const btn = banner?.querySelector("#update-install") as HTMLButtonElement;
  if (btn) btn.style.display = "none";
}
