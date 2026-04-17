import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../recommendations/mood-service", () => ({
  moodService: {
    activeMood: null,
    setMood: vi.fn(),
    listMoods: vi.fn().mockResolvedValue([
      { id: "calm", name: "Calm", is_preset: true, seed_tags: [] },
      { id: "energetic", name: "Energetic", is_preset: true, seed_tags: [] },
    ]),
    onMoodChange: vi.fn().mockReturnValue(() => {}),
  },
}));

import { renderMoodTabs } from "./bridge";

describe("renderMoodTabs", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="webamp"><div id="main-window"></div></div>';
  });

  it("injects mood-tabs div into the DOM", async () => {
    await renderMoodTabs();
    expect(document.getElementById("mood-tabs")).not.toBeNull();
  });

  it("renders a tab for each mood", async () => {
    await renderMoodTabs();
    const tabs = document.querySelectorAll(".mood-tab");
    expect(tabs.length).toBe(2);
  });

  it("renders add-mood button", async () => {
    await renderMoodTabs();
    expect(document.getElementById("mood-tab-add")).not.toBeNull();
  });
});
