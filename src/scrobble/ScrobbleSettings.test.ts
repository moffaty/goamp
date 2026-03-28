import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));
vi.mock("./scrobble-service", () => ({
  lastfmSaveSettings: vi.fn().mockResolvedValue(undefined),
  lastfmGetAuthUrl: vi.fn().mockResolvedValue("https://last.fm/auth?api_key=test"),
  lastfmAuth: vi.fn().mockResolvedValue({ name: "testuser", key: "sesskey" }),
  lastfmGetStatus: vi.fn().mockResolvedValue(null),
  listenbrainzSaveToken: vi.fn().mockResolvedValue("lb_user"),
  listenbrainzGetStatus: vi.fn().mockResolvedValue(null),
  listenbrainzLogout: vi.fn().mockResolvedValue(undefined),
  scrobbleGetStatus: vi.fn().mockResolvedValue({ lastfm: false, listenbrainz: false, queue_count: 0 }),
  scrobbleFlushQueue: vi.fn().mockResolvedValue(0),
}));

async function freshModule() {
  vi.resetModules();
  return await import("./ScrobbleSettings");
}

describe("ScrobbleSettings panel", () => {
  afterEach(() => {
    document.getElementById("scrobble-settings-overlay")?.remove();
    localStorage.clear();
  });

  it("creates panel with all expected elements", async () => {
    const { initScrobbleSettings, toggleScrobbleSettings } = await freshModule();
    initScrobbleSettings();
    toggleScrobbleSettings();

    const panel = document.getElementById("scrobble-settings-overlay");
    expect(panel).not.toBeNull();
    expect(panel!.style.display).toBe("flex");

    // Check for key elements
    expect(document.getElementById("scrobble-api-key")).not.toBeNull();
    expect(document.getElementById("scrobble-secret")).not.toBeNull();
    expect(document.getElementById("lb-token")).not.toBeNull();
    expect(document.getElementById("scrobble-queue-text")).not.toBeNull();
    expect(document.getElementById("scrobble-close")).not.toBeNull();

    // Input types
    expect((document.getElementById("scrobble-api-key") as HTMLInputElement).type).toBe("text");
    expect((document.getElementById("scrobble-secret") as HTMLInputElement).type).toBe("password");
  });

  it("toggles visibility", async () => {
    const { initScrobbleSettings, toggleScrobbleSettings } = await freshModule();
    initScrobbleSettings();

    toggleScrobbleSettings(); // show
    const panel = document.getElementById("scrobble-settings-overlay")!;
    expect(panel.style.display).toBe("flex");

    toggleScrobbleSettings(); // hide
    expect(panel.style.display).toBe("none");

    toggleScrobbleSettings(); // show again
    expect(panel.style.display).toBe("flex");
  });

  it("save keys button calls lastfmSaveSettings", async () => {
    const { initScrobbleSettings, toggleScrobbleSettings } = await freshModule();
    const { lastfmSaveSettings } = await import("./scrobble-service");

    initScrobbleSettings();
    toggleScrobbleSettings();

    (document.getElementById("scrobble-api-key") as HTMLInputElement).value = "mykey";
    (document.getElementById("scrobble-secret") as HTMLInputElement).value = "mysecret";
    document.getElementById("scrobble-save-keys")!.click();

    await vi.waitFor(() => {
      expect(lastfmSaveSettings).toHaveBeenCalledWith("mykey", "mysecret");
    });
  });

  it("close button hides panel", async () => {
    const { initScrobbleSettings, toggleScrobbleSettings } = await freshModule();
    initScrobbleSettings();
    toggleScrobbleSettings();

    document.getElementById("scrobble-close")!.click();
    const panel = document.getElementById("scrobble-settings-overlay")!;
    expect(panel.style.display).toBe("none");
  });
});
