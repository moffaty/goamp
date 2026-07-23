import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("styles.css — transparent borderless window", () => {
  const css = readFileSync(resolve(__dirname, "styles.css"), "utf8");

  it("body is transparent so only Webamp's skin shape is visible", () => {
    // The OS window is transparent + borderless; a solid body would draw an
    // opaque box around the player.
    expect(/html,\s*body\s*\{[^}]*background:\s*transparent\b/m.test(css)).toBe(true);
  });

  it("#app is transparent so Webamp's skin defines the visible region", () => {
    expect(/#app\s*\{[^}]*background:\s*transparent/m.test(css)).toBe(true);
  });
});
