import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../recommendations/mood-service", () => ({
  moodService: { activeMood: "calm" },
}));

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

import { initGoampMenu, buildSignalMenuItems, buildDynamicMenuItems } from "./goamp-menu";
import { toggleSearchOverlay } from "../youtube/SearchOverlay";
import { UIRegistry } from "../core/UIRegistry";


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
    initGoampMenu({} as any);

    const inner = webampEl.querySelector(".webamp-inner")!;
    const event = new MouseEvent("contextmenu", { bubbles: true, clientX: 100, clientY: 100 });
    inner.dispatchEvent(event);

    const menu = document.getElementById("goamp-context-menu");
    expect(menu).not.toBeNull();
  });

  it("menu contains expected items", () => {
    initGoampMenu({} as any);

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
    initGoampMenu({} as any);

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
    initGoampMenu({} as any);

    const inner = webampEl.querySelector(".webamp-inner")!;
    inner.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 100, clientY: 100 }));
    expect(document.getElementById("goamp-context-menu")).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.getElementById("goamp-context-menu")).toBeNull();
  });

  it("does not show menu on right-click outside webamp", () => {
    initGoampMenu({} as any);

    const outsideEl = document.createElement("div");
    document.body.appendChild(outsideEl);

    outsideEl.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 100, clientY: 100 }));

    const menu = document.getElementById("goamp-context-menu");
    expect(menu).toBeNull();

    outsideEl.remove();
  });
});

describe("buildSignalMenuItems", () => {
  it("returns boost and block items", () => {
    const items = buildSignalMenuItems("hash_abc", "Rick Astley", "Never Gonna Give You Up");
    const labels = items.map((i) => i.label);
    expect(labels).toContain("↑ Recommend similar");
    expect(labels).toContain("✕ Don't recommend");
  });
});

describe("buildDynamicMenuItems", () => {
  it("returns [] for a null registry", () => {
    expect(buildDynamicMenuItems(null)).toEqual([]);
  });

  it("returns [] when no items are registered", () => {
    expect(buildDynamicMenuItems(new UIRegistry())).toEqual([]);
  });

  it("maps registered items to MenuItem objects with a leading separator", () => {
    const r = new UIRegistry();
    r.registerMenuItem("Peers", () => {});
    r.registerMenuItem("Debug", () => {});

    const items = buildDynamicMenuItems(r);

    expect(items[0].separator).toBe(true);
    expect(items.slice(1).map((i) => i.label)).toEqual(["Peers", "Debug"]);
  });

  it("the returned action invokes the original handler", () => {
    const r = new UIRegistry();
    const handler = vi.fn();
    r.registerMenuItem("Peers", handler);

    buildDynamicMenuItems(r)[1].action();

    expect(handler).toHaveBeenCalledOnce();
  });

  it("reads live — items registered after a first call appear on the next", () => {
    const r = new UIRegistry();
    r.registerMenuItem("A", () => {});
    expect(buildDynamicMenuItems(r).slice(1)).toHaveLength(1);

    r.registerMenuItem("B", () => {});
    expect(buildDynamicMenuItems(r).slice(1)).toHaveLength(2);
  });

  it("a registered item shows up in the live context menu", () => {
    const registry = new UIRegistry();
    const handler = vi.fn();
    registry.registerMenuItem("Peers", handler);

    const webampEl = document.createElement("div");
    webampEl.id = "webamp";
    document.body.appendChild(webampEl);

    initGoampMenu({} as any, registry);
    webampEl.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, clientX: 50, clientY: 50 })
    );

    const menu = document.getElementById("goamp-context-menu")!;
    const labels = Array.from(menu.querySelectorAll("div > span:first-child")).map(
      (el) => el.textContent
    );
    expect(labels).toContain("Peers");

    document.getElementById("goamp-context-menu")?.remove();
    webampEl.remove();
  });
});
