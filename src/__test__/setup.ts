import { vi } from "vitest";

// Mock Tauri API core
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((path: string) => `asset://localhost/${encodeURIComponent(path)}`),
}));

// Mock Tauri window API
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({
    setIgnoreCursorEvents: vi.fn(),
    destroy: vi.fn(),
  })),
}));

// Mock Tauri webview window API
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: vi.fn(() => ({
    listen: vi.fn(),
  })),
}));

// Mock Tauri dialog plugin
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

// Mock Tauri opener plugin
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

// Mock Tauri updater plugin
vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn(),
}));

// Mock analytics
vi.mock("../lib/analytics", () => ({
  initAnalytics: vi.fn(),
  track: vi.fn(),
  trackError: vi.fn(),
}));

// Provide localStorage mock (jsdom has it, but ensure it's clean)
beforeEach(() => {
  localStorage.clear();
});
