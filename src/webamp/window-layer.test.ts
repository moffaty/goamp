import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  setAlwaysOnTop: vi.fn(() => Promise.resolve()),
  invoke: vi.fn(() => Promise.resolve()),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ setAlwaysOnTop: mocks.setAlwaysOnTop }),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

import { isOnTop, setOnTop, applyOnTop, sendToBack } from "./window-layer";

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe("On-Top toggle", () => {
  it("defaults to false", () => {
    expect(isOnTop()).toBe(false);
  });

  it("setOnTop(true) persists and calls setAlwaysOnTop(true)", () => {
    setOnTop(true);
    expect(localStorage.getItem("goamp_on_top")).toBe("1");
    expect(mocks.setAlwaysOnTop).toHaveBeenCalledWith(true);
    expect(isOnTop()).toBe(true);
  });

  it("setOnTop(false) persists and calls setAlwaysOnTop(false)", () => {
    setOnTop(true);
    setOnTop(false);
    expect(localStorage.getItem("goamp_on_top")).toBe("0");
    expect(mocks.setAlwaysOnTop).toHaveBeenLastCalledWith(false);
    expect(isOnTop()).toBe(false);
  });

  it("migrates the legacy goamp_always_on_top key", () => {
    localStorage.setItem("goamp_always_on_top", "1");
    expect(isOnTop()).toBe(true);
  });

  it("migrates the legacy goamp_window_layer=top key", () => {
    localStorage.setItem("goamp_window_layer", "top");
    expect(isOnTop()).toBe(true);
  });

  it("applyOnTop restores the saved state on startup", () => {
    localStorage.setItem("goamp_on_top", "1");
    applyOnTop();
    expect(mocks.setAlwaysOnTop).toHaveBeenCalledWith(true);
  });
});

describe("To-Bottom (one-shot)", () => {
  it("sendToBack invokes the native window_send_to_back command", async () => {
    await sendToBack();
    expect(mocks.invoke).toHaveBeenCalledWith("window_send_to_back");
  });

  it("sendToBack does NOT use the sticky always-on-bottom mode", async () => {
    await sendToBack();
    // Only the native one-shot command — never a persistent z-order flag.
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it("sendToBack persists nothing — it is an action, not a mode", async () => {
    await sendToBack();
    expect(localStorage.getItem("goamp_window_layer")).toBeNull();
    expect(isOnTop()).toBe(false);
  });

  it("sendToBack clears On-Top if it was active", async () => {
    setOnTop(true);
    expect(isOnTop()).toBe(true);
    await sendToBack();
    expect(isOnTop()).toBe(false);
    expect(mocks.setAlwaysOnTop).toHaveBeenLastCalledWith(false);
  });

  it("does not throw if the native command rejects", async () => {
    mocks.invoke.mockRejectedValueOnce(new Error("no hwnd"));
    await expect(sendToBack()).resolves.toBeUndefined();
  });
});
