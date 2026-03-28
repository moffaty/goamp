import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  featureFlagsList,
  featureFlagsSet,
  featureFlagGet,
  refreshFlagCache,
  isFeatureEnabled,
} from "./feature-flags-service";

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  mockInvoke.mockReset();
});

describe("featureFlagsList", () => {
  it("calls invoke with correct command", async () => {
    mockInvoke.mockResolvedValue([]);
    await featureFlagsList();
    expect(mockInvoke).toHaveBeenCalledWith("feature_flags_list");
  });

  it("returns flags array", async () => {
    const flags = [
      { key: "dark_mode", enabled: true, description: "Dark mode" },
      { key: "beta", enabled: false, description: "Beta features" },
    ];
    mockInvoke.mockResolvedValue(flags);
    const result = await featureFlagsList();
    expect(result).toHaveLength(2);
    expect(result[0].key).toBe("dark_mode");
  });
});

describe("featureFlagsSet", () => {
  it("calls invoke with key and enabled", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await featureFlagsSet("beta", true);
    expect(mockInvoke).toHaveBeenCalledWith("feature_flags_set", { key: "beta", enabled: true });
  });
});

describe("featureFlagGet", () => {
  it("calls invoke with key", async () => {
    mockInvoke.mockResolvedValue(true);
    const result = await featureFlagGet("beta");
    expect(mockInvoke).toHaveBeenCalledWith("feature_flag_get", { key: "beta" });
    expect(result).toBe(true);
  });
});

describe("flag cache", () => {
  it("refreshFlagCache populates cache from backend", async () => {
    mockInvoke.mockResolvedValue([
      { key: "feat_a", enabled: true, description: "" },
      { key: "feat_b", enabled: false, description: "" },
    ]);
    await refreshFlagCache();
    expect(isFeatureEnabled("feat_a")).toBe(true);
    expect(isFeatureEnabled("feat_b")).toBe(false);
  });

  it("isFeatureEnabled returns true for unknown keys (default)", () => {
    expect(isFeatureEnabled("nonexistent_flag")).toBe(true);
  });
});
