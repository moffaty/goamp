import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { MoodService } from "./mood-service";

describe("MoodService", () => {
  let svc: MoodService;

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    svc = new MoodService();
  });

  it("starts with no active mood", () => {
    expect(svc.activeMood).toBeNull();
  });

  it("setMood persists to localStorage", () => {
    svc.setMood("calm");
    expect(svc.activeMood).toBe("calm");
    expect(localStorage.getItem("goamp_active_mood")).toBe("calm");
  });

  it("setMood(null) clears mood", () => {
    svc.setMood("calm");
    svc.setMood(null);
    expect(svc.activeMood).toBeNull();
    expect(localStorage.getItem("goamp_active_mood")).toBeNull();
  });

  it("restores activeMood from localStorage on construction", () => {
    localStorage.setItem("goamp_active_mood", "focus");
    const svc2 = new MoodService();
    expect(svc2.activeMood).toBe("focus");
  });

  it("generateQueue calls invoke with mood_id", async () => {
    vi.mocked(invoke).mockResolvedValue([]);
    await svc.generateQueue("calm", 20);
    expect(invoke).toHaveBeenCalledWith("generate_mood_queue", { moodId: "calm", limit: 20 });
  });

  it("recordPlay calls invoke with correct args", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await svc.recordPlay("hash_abc", "calm", 0.85, false);
    expect(invoke).toHaveBeenCalledWith("record_mood_play", {
      moodId: "calm",
      canonicalId: "hash_abc",
      completionRate: 0.85,
      skipped: false,
    });
  });

  it("recordSignal calls invoke with scope", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await svc.recordSignal("hash_abc", 1, "global");
    expect(invoke).toHaveBeenCalledWith("record_track_signal", {
      canonicalId: "hash_abc",
      signal: 1,
      scope: "global",
    });
  });
});
