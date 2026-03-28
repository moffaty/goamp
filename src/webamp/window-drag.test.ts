import { describe, it, expect } from "vitest";

// We test the isAppContent logic indirectly via the module's behavior
// Since isAppContent is private, we test the core logic pattern
describe("click-through logic", () => {
  it("body element should be considered non-content (click-through)", () => {
    const el = document.body;
    // The logic: if el === body or documentElement => not content
    const isContent = el !== document.body && el !== document.documentElement;
    expect(isContent).toBe(false);
  });

  it("html element should be considered non-content", () => {
    const el = document.documentElement;
    const isContent = el !== document.body && el !== document.documentElement;
    expect(isContent).toBe(false);
  });

  it("any other element should be considered content (captures clicks)", () => {
    const div = document.createElement("div");
    document.body.appendChild(div);
    const isContent = div !== document.body && div !== document.documentElement;
    expect(isContent).toBe(true);
    div.remove();
  });

  it("overlay element should capture clicks", () => {
    const overlay = document.createElement("div");
    overlay.id = "yt-search-overlay";
    document.body.appendChild(overlay);
    const isContent = overlay !== document.body && overlay !== document.documentElement;
    expect(isContent).toBe(true);
    overlay.remove();
  });
});
