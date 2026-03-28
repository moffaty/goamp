import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn(),
}));

async function freshModule() {
  vi.resetModules();
  return await import("./UpdateNotification");
}

describe("UpdateNotification", () => {
  afterEach(() => {
    document.getElementById("update-banner")?.remove();
  });

  it("does nothing when no update available", async () => {
    const { check } = await import("@tauri-apps/plugin-updater");
    vi.mocked(check).mockResolvedValue(null as any);

    const { checkForUpdates } = await freshModule();
    await checkForUpdates();
    expect(document.getElementById("update-banner")).toBeNull();
  });

  it("shows banner with version and buttons when update available", async () => {
    const { check } = await import("@tauri-apps/plugin-updater");
    vi.mocked(check).mockResolvedValue({
      version: "1.2.3",
      downloadAndInstall: vi.fn(),
    } as any);

    const { checkForUpdates } = await freshModule();
    await checkForUpdates();

    const banner = document.getElementById("update-banner");
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toContain("1.2.3");
    expect(document.getElementById("update-install")).not.toBeNull();
    expect(document.getElementById("update-dismiss")).not.toBeNull();
  });

  it("dismiss button removes banner", async () => {
    const { check } = await import("@tauri-apps/plugin-updater");
    vi.mocked(check).mockResolvedValue({
      version: "2.0.0",
      downloadAndInstall: vi.fn(),
    } as any);

    const { checkForUpdates } = await freshModule();
    await checkForUpdates();
    document.getElementById("update-dismiss")!.click();
    expect(document.getElementById("update-banner")).toBeNull();
  });

  it("install button triggers download", async () => {
    const mockDownload = vi.fn().mockResolvedValue(undefined);
    const { check } = await import("@tauri-apps/plugin-updater");
    vi.mocked(check).mockResolvedValue({
      version: "2.0.0",
      downloadAndInstall: mockDownload,
    } as any);

    const { checkForUpdates } = await freshModule();
    await checkForUpdates();
    document.getElementById("update-install")!.click();

    await vi.waitFor(() => {
      expect(mockDownload).toHaveBeenCalled();
    });
  });

  it("handles check failure gracefully", async () => {
    const { check } = await import("@tauri-apps/plugin-updater");
    vi.mocked(check).mockRejectedValue(new Error("Network error"));

    const { checkForUpdates } = await freshModule();
    await checkForUpdates();
    expect(document.getElementById("update-banner")).toBeNull();
  });
});
