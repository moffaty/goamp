import { invoke } from "@tauri-apps/api/core";

export interface FeatureFlag {
  key: string;
  enabled: boolean;
  description: string;
}

export async function featureFlagsList(): Promise<FeatureFlag[]> {
  return invoke("feature_flags_list");
}

export async function featureFlagsSet(
  key: string,
  enabled: boolean,
): Promise<void> {
  return invoke("feature_flags_set", { key, enabled });
}

export async function featureFlagGet(key: string): Promise<boolean> {
  return invoke("feature_flag_get", { key });
}

// Cached flags for synchronous access (refreshed on panel open)
const cache: Map<string, boolean> = new Map();

export async function refreshFlagCache(): Promise<void> {
  const flags = await featureFlagsList();
  cache.clear();
  for (const f of flags) {
    cache.set(f.key, f.enabled);
  }
}

export function isFeatureEnabled(key: string): boolean {
  return cache.get(key) ?? true; // default: enabled
}
