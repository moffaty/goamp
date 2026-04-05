import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock all panel imports before importing the module
vi.mock("../youtube/SearchOverlay", () => ({
  toggleSearchOverlay: vi.fn(),
}));
vi.mock("../playlists/PlaylistPanel", () => ({
  togglePlaylistPanel: vi.fn(),
}));
vi.mock("../settings/AudioDevicePanel", () => ({
  toggleAudioDevicePanel: vi.fn(),
}));
vi.mock("../scrobble/ScrobbleSettings", () => ({
  toggleScrobbleSettings: vi.fn(),
}));
vi.mock("../settings/FeatureFlagsPanel", () => ({
  toggleFeatureFlagsPanel: vi.fn(),
}));
vi.mock("./VisualizerPanel", () => ({
  toggleVisualizerPanel: vi.fn(),
}));
vi.mock("./bridge", () => ({
  openFolder: vi.fn(),
  openFiles: vi.fn(),
  loadSkin: vi.fn(),
}));

import { initGoampMenu } from "./goamp-menu";
import { toggleSearchOverlay } from "../youtube/SearchOverlay";

describe("initGoampMenu", () => {
  let webampEl: HTMLDivElement;

  beforeEach(() => {
    // Create a minimal Webamp container
    webampEl = document.createElement("div");
    webampEl.id = "webamp";
    document.body.appendChild(webampEl);

    const inner = document.createElement("div");
    inner.className = "webamp-inner";
    webampEl.appendChild(inner);
  });

  afterEach(() => {
    webampEl.remove();
    document.getElementById("goamp-context-menu")?.remove();
  });

  it("creates context menu on right-click within webamp", () => {
    const fakeWebamp = { store: { getState: () => ({}) } } as any;
    initGoampMenu(fakeWebamp);

    const inner = webampEl.querySelector(".webamp-inner")!;
    const event = new MouseEvent("contextmenu", { bubbles: true, clientX: 100, clientY: 100 });
    inner.dispatchEvent(event);

    const menu = document.getElementById("goamp-context-menu");
    expect(menu).not.toBeNull();
  });

  it("menu contains expected items", () => {
    const fakeWebamp = { store: { getState: () => ({}) } } as any;
    initGoampMenu(fakeWebamp);

    const inner = webampEl.querySelector(".webamp-inner")!;
    inner.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 100, clientY: 100 }));

    const menu = document.getElementById("goamp-context-menu")!;
    const labels = Array.from(menu.querySelectorAll("div > span:first-child")).map((el) => el.textContent);

    expect(labels).toContain("Search");
    expect(labels).toContain("Playlists");
    expect(labels).toContain("Audio Devices");
    expect(labels).toContain("Scrobbling");
  });

  it("clicking menu item triggers action", () => {
    const fakeWebamp = { store: { getState: () => ({}) } } as any;
    initGoampMenu(fakeWebamp);

    const inner = webampEl.querySelector(".webamp-inner")!;
    inner.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 100, clientY: 100 }));

    const menu = document.getElementById("goamp-context-menu")!;
    const rows = menu.querySelectorAll("div[style*='cursor: pointer']");

    // Find "Search" row and click it
    for (const row of rows) {
      const label = row.querySelector("span");
      if (label?.textContent === "Search") {
        row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        break;
      }
    }

    expect(toggleSearchOverlay).toHaveBeenCalled();
  });

  it("closes menu on Escape key", () => {
    const fakeWebamp = { store: { getState: () => ({}) } } as any;
    initGoampMenu(fakeWebamp);

    const inner = webampEl.querySelector(".webamp-inner")!;
    inner.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 100, clientY: 100 }));
    expect(document.getElementById("goamp-context-menu")).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.getElementById("goamp-context-menu")).toBeNull();
  });

  it("does not show menu on right-click outside webamp", () => {
    const fakeWebamp = { store: { getState: () => ({}) } } as any;
    initGoampMenu(fakeWebamp);

    const outsideEl = document.createElement("div");
    document.body.appendChild(outsideEl);

    outsideEl.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 100, clientY: 100 }));

    const menu = document.getElementById("goamp-context-menu");
    expect(menu).toBeNull();

    outsideEl.remove();
  });
});
