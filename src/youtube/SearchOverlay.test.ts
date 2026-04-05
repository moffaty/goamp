import { describe, it, expect, vi, afterEach } from "vitest";

// These tests verify SearchOverlay DOM creation and interaction.
// Since SearchOverlay uses module-level state (overlay variable),
// we use vi.resetModules() + dynamic import for isolation.

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((path: string) => `asset://${path}`),
}));
vi.mock("./youtube-service", () => ({
  searchYoutube: vi.fn().mockResolvedValue([]),
  extractAudio: vi.fn(),
  extractAudioUrl: vi.fn(),
}));
vi.mock("../lib/tauri-ipc", () => ({
  listPlaylists: vi.fn().mockResolvedValue([]),
  createPlaylist: vi.fn(),
  addTrackToPlaylist: vi.fn(),
}));
vi.mock("../lib/analytics", () => ({
  track: vi.fn(),
  trackError: vi.fn(),
}));
vi.mock("../lib/ui-utils", () => ({
  getSkinColors: vi.fn(() => ({
    bg: "#1d2439", fg: "#2a3555", text: "#00ff00", accent: "#ffcc00", textBg: "#0a0e1a",
  })),
  escapeHtml: vi.fn((s: string) => s),
  formatDuration: vi.fn((s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`),
}));

async function freshModule() {
  vi.resetModules();
  return await import("./SearchOverlay");
}

describe("SearchOverlay", () => {
  afterEach(() => {
    document.getElementById("yt-search-overlay")?.remove();
    document.getElementById("yt-search-styles")?.remove();
    localStorage.clear();
  });

  it("opens overlay with search input and source tabs", async () => {
    const { initSearchOverlay, toggleSearchOverlay } = await freshModule();
    initSearchOverlay({} as any);
    toggleSearchOverlay();

    const overlay = document.getElementById("yt-search-overlay");
    expect(overlay).not.toBeNull();

    const input = document.getElementById("yt-search-input") as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.tagName).toBe("INPUT");

    const tabs = document.querySelectorAll(".yt-source-tab");
    expect(tabs).toHaveLength(2);
    const tabLabels = Array.from(tabs).map((t) => t.textContent);
    expect(tabLabels).toContain("YouTube");
    expect(tabLabels).toContain("SoundCloud");
  });

  it("closes overlay on close button", async () => {
    const { initSearchOverlay, toggleSearchOverlay } = await freshModule();
    initSearchOverlay({} as any);
    toggleSearchOverlay();

    document.getElementById("yt-search-close")!.click();
    expect(document.getElementById("yt-search-overlay")?.classList.contains("yt-closing")).toBe(true);
  });

  it("toggle closes when already open", async () => {
    const { initSearchOverlay, toggleSearchOverlay } = await freshModule();
    initSearchOverlay({} as any);
    toggleSearchOverlay(); // open
    expect(document.getElementById("yt-search-overlay")).not.toBeNull();

    toggleSearchOverlay(); // close
    expect(document.getElementById("yt-search-overlay")?.classList.contains("yt-closing")).toBe(true);
  });

  it("search triggers on Enter and renders results", async () => {
    const mod = await freshModule();
    const { searchYoutube } = await import("./youtube-service");
    vi.mocked(searchYoutube).mockResolvedValue([
      { id: "v1", title: "Song A", channel: "Artist A", duration: 200, thumbnail: "t.jpg", source: "youtube", webpage_url: "", genre: "" },
      { id: "v2", title: "Song B", channel: "Artist B", duration: 300, thumbnail: "t2.jpg", source: "youtube", webpage_url: "", genre: "Rock" },
    ]);

    mod.initSearchOverlay({} as any);
    mod.toggleSearchOverlay();

    const input = document.getElementById("yt-search-input") as HTMLInputElement;
    input.value = "test query";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    await vi.waitFor(() => {
      expect(searchYoutube).toHaveBeenCalledWith("test query", 20, "youtube");
    });

    await vi.waitFor(() => {
      const rows = document.querySelectorAll(".yt-result-row");
      expect(rows.length).toBe(2);
    });
  });

  it("saves and restores query from localStorage", async () => {
    const { searchYoutube } = await import("./youtube-service");
    vi.mocked(searchYoutube).mockResolvedValue([]);

    // Search and save
    const mod1 = await freshModule();
    mod1.initSearchOverlay({} as any);
    mod1.toggleSearchOverlay();
    const input = document.getElementById("yt-search-input") as HTMLInputElement;
    input.value = "my search";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    await vi.waitFor(() => {
      expect(localStorage.getItem("goamp_yt_last_query")).toBe("my search");
    });

    // Close and reopen with fresh module
    document.getElementById("yt-search-overlay")?.remove();
    document.getElementById("yt-search-styles")?.remove();
    const mod2 = await freshModule();
    mod2.initSearchOverlay({} as any);
    mod2.toggleSearchOverlay();
    const input2 = document.getElementById("yt-search-input") as HTMLInputElement;
    expect(input2.value).toBe("my search");
  });

  it("saves selected source to localStorage", async () => {
    const { initSearchOverlay, toggleSearchOverlay } = await freshModule();
    initSearchOverlay({} as any);
    toggleSearchOverlay();

    const scTab = document.querySelector('.yt-source-tab[data-source="soundcloud"]') as HTMLElement;
    scTab.click();
    expect(localStorage.getItem("goamp_search_source")).toBe("soundcloud");
  });

  it("status shows initial hint", async () => {
    const { initSearchOverlay, toggleSearchOverlay } = await freshModule();
    initSearchOverlay({} as any);
    toggleSearchOverlay();

    const status = document.getElementById("yt-search-status");
    expect(status).not.toBeNull();
    expect(status!.textContent).toContain("Enter");
  });
});
