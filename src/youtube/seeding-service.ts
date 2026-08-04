import { invoke } from "@tauri-apps/api/core";

/** Whether P2P seeding of downloaded tracks is enabled (default off). */
export async function getSeedEnabled(): Promise<boolean> {
  return invoke("get_seed_enabled");
}

/** Enable/disable P2P seeding of downloaded tracks (persisted). */
export async function setSeedEnabled(enabled: boolean): Promise<void> {
  await invoke("set_seed_enabled", { enabled });
}
