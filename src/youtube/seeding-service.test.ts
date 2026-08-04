import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { getSeedEnabled, setSeedEnabled } from "./seeding-service";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mockInvoke = vi.mocked(invoke);

beforeEach(() => mockInvoke.mockReset());

describe("seeding-service", () => {
  it("getSeedEnabled invokes get_seed_enabled", async () => {
    mockInvoke.mockResolvedValue(true);
    expect(await getSeedEnabled()).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith("get_seed_enabled");
  });

  it("setSeedEnabled invokes set_seed_enabled with the flag", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await setSeedEnabled(true);
    expect(mockInvoke).toHaveBeenCalledWith("set_seed_enabled", { enabled: true });
  });
});
