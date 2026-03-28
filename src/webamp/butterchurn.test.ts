import { describe, it, expect, beforeEach } from "vitest";
import { removeCustomPreset, listCustomPresets } from "./butterchurn";

const CUSTOM_PRESETS_KEY = "goamp_custom_presets";

describe("custom presets storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("listCustomPresets returns empty array when no presets stored", () => {
    expect(listCustomPresets()).toEqual([]);
  });

  it("listCustomPresets returns stored preset names", () => {
    localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify({
      "Preset A": { baseVals: {} },
      "Preset B": { baseVals: {} },
    }));
    const names = listCustomPresets();
    expect(names).toContain("Preset A");
    expect(names).toContain("Preset B");
    expect(names).toHaveLength(2);
  });

  it("removeCustomPreset removes a preset by name", () => {
    localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify({
      "Keep": { baseVals: {} },
      "Remove": { baseVals: {} },
    }));
    removeCustomPreset("Remove");
    const names = listCustomPresets();
    expect(names).toEqual(["Keep"]);
  });

  it("removeCustomPreset does nothing for nonexistent preset", () => {
    localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify({
      "A": { baseVals: {} },
    }));
    removeCustomPreset("B");
    expect(listCustomPresets()).toEqual(["A"]);
  });

  it("handles corrupt localStorage gracefully", () => {
    localStorage.setItem(CUSTOM_PRESETS_KEY, "not-json{{{");
    expect(listCustomPresets()).toEqual([]);
  });
});
