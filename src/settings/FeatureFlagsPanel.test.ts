import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("./feature-flags-service", () => ({
  featureFlagsList: vi.fn().mockResolvedValue([
    { key: "auto_scrobble", enabled: true, description: "Auto-scrobble tracks" },
    { key: "lastfm_scrobble", enabled: false, description: "Last.fm scrobbling" },
  ]),
  featureFlagsSet: vi.fn().mockResolvedValue(undefined),
  refreshFlagCache: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lib/ui-utils", () => ({
  escapeHtml: vi.fn((s: string) => s),
}));

async function freshModule() {
  vi.resetModules();
  return await import("./FeatureFlagsPanel");
}

describe("FeatureFlagsPanel", () => {
  afterEach(() => {
    document.getElementById("feature-flags-overlay")?.remove();
  });

  it("creates panel and toggles visibility", async () => {
    const { toggleFeatureFlagsPanel } = await freshModule();

    toggleFeatureFlagsPanel(); // show
    const panel = document.getElementById("feature-flags-overlay");
    expect(panel).not.toBeNull();
    expect(panel!.style.display).toBe("flex");

    toggleFeatureFlagsPanel(); // hide
    expect(panel!.style.display).toBe("none");
  });

  it("loads and renders flag toggles", async () => {
    const { toggleFeatureFlagsPanel } = await freshModule();
    toggleFeatureFlagsPanel();

    await vi.waitFor(() => {
      const toggles = document.querySelectorAll(".ff-toggle");
      expect(toggles.length).toBe(2);
    });

    // Check initial state
    const toggles = document.querySelectorAll(".ff-toggle") as NodeListOf<HTMLInputElement>;
    const autoScrobble = Array.from(toggles).find((t) => t.dataset.key === "auto_scrobble");
    const lastfm = Array.from(toggles).find((t) => t.dataset.key === "lastfm_scrobble");
    expect(autoScrobble?.checked).toBe(true);
    expect(lastfm?.checked).toBe(false);
  });

  it("clicking toggle calls featureFlagsSet", async () => {
    const { toggleFeatureFlagsPanel } = await freshModule();
    const { featureFlagsSet } = await import("./feature-flags-service");

    toggleFeatureFlagsPanel();

    await vi.waitFor(() => {
      expect(document.querySelectorAll(".ff-toggle").length).toBe(2);
    });

    const toggle = document.querySelector('.ff-toggle[data-key="lastfm_scrobble"]') as HTMLInputElement;
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));

    await vi.waitFor(() => {
      expect(featureFlagsSet).toHaveBeenCalledWith("lastfm_scrobble", true);
    });
  });

  it("close button hides panel", async () => {
    const { toggleFeatureFlagsPanel } = await freshModule();
    toggleFeatureFlagsPanel();

    document.getElementById("ff-close")!.click();
    expect(document.getElementById("feature-flags-overlay")!.style.display).toBe("none");
  });
});
