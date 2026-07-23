import { describe, it, expect, afterEach } from "vitest";
import { isAppContent } from "./window-drag";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("isAppContent — click-through classification", () => {
  it("null → not content (cursor over nothing)", () => {
    expect(isAppContent(null)).toBe(false);
  });

  it("body → not content (transparent → click-through)", () => {
    expect(isAppContent(document.body)).toBe(false);
  });

  it("documentElement → not content (transparent → click-through)", () => {
    expect(isAppContent(document.documentElement)).toBe(false);
  });

  it("#app container → not content (fills window, transparent gap)", () => {
    const app = document.createElement("div");
    app.id = "app";
    document.body.appendChild(app);
    expect(isAppContent(app)).toBe(false);
  });

  it("#webamp positioning root → not content (transparent gap)", () => {
    const webamp = document.createElement("div");
    webamp.id = "webamp";
    document.body.appendChild(webamp);
    expect(isAppContent(webamp)).toBe(false);
  });

  it("a real Webamp window → content (captures clicks)", () => {
    const mainWindow = document.createElement("div");
    mainWindow.id = "main-window";
    document.body.appendChild(mainWindow);
    expect(isAppContent(mainWindow)).toBe(true);
  });

  it("an overlay element → content (captures clicks)", () => {
    const overlay = document.createElement("div");
    overlay.id = "yt-search-overlay";
    document.body.appendChild(overlay);
    expect(isAppContent(overlay)).toBe(true);
  });

  it("a generic child element → content (captures clicks)", () => {
    const div = document.createElement("div");
    document.body.appendChild(div);
    expect(isAppContent(div)).toBe(true);
  });
});
