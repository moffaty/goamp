import { describe, it, expect } from "vitest";
import { luminance, ensureContrast, formatDuration, escapeHtml, getSkinColors } from "./ui-utils";

describe("luminance", () => {
  it("returns 0 for black", () => {
    expect(luminance("#000000")).toBe(0);
  });

  it("returns 1 for white", () => {
    expect(luminance("#ffffff")).toBeCloseTo(1, 4);
  });

  it("returns ~0.2126 for pure red", () => {
    expect(luminance("#ff0000")).toBeCloseTo(0.2126, 4);
  });

  it("handles hex without #", () => {
    expect(luminance("000000")).toBe(0);
  });
});

describe("ensureContrast", () => {
  it("returns original color when contrast is sufficient", () => {
    // White text on black bg — max contrast
    expect(ensureContrast("#ffffff", "#000000")).toBe("#ffffff");
  });

  it("flips to white on dark background when contrast is poor", () => {
    // Dark gray text on dark bg
    expect(ensureContrast("#222222", "#111111")).toBe("#ffffff");
  });

  it("flips to black on light background when contrast is poor", () => {
    // Light gray text on light bg
    expect(ensureContrast("#dddddd", "#eeeeee")).toBe("#000000");
  });

  it("keeps green on black (good contrast)", () => {
    expect(ensureContrast("#00ff00", "#000000")).toBe("#00ff00");
  });
});

describe("formatDuration", () => {
  it("formats 0 seconds", () => {
    expect(formatDuration(0)).toBe("0:00");
  });

  it("formats seconds only", () => {
    expect(formatDuration(5)).toBe("0:05");
  });

  it("formats minutes and seconds", () => {
    expect(formatDuration(65)).toBe("1:05");
  });

  it("formats 10+ minutes", () => {
    expect(formatDuration(600)).toBe("10:00");
  });

  it("pads single-digit seconds", () => {
    expect(formatDuration(61)).toBe("1:01");
  });

  it("handles fractional seconds", () => {
    expect(formatDuration(65.7)).toBe("1:05");
  });
});

describe("escapeHtml", () => {
  it("escapes angle brackets", () => {
    expect(escapeHtml("<script>alert('xss')</script>")).not.toContain("<script>");
  });

  it("escapes ampersands", () => {
    expect(escapeHtml("foo & bar")).toBe("foo &amp; bar");
  });

  it("passes plain text through", () => {
    expect(escapeHtml("hello world")).toBe("hello world");
  });

  it("preserves quotes (textContent/innerHTML does not escape them)", () => {
    const result = escapeHtml('"test"');
    expect(result).toBe('"test"');
  });
});

describe("getSkinColors", () => {
  it("returns default colors when webamp is null", () => {
    const colors = getSkinColors(null);
    expect(colors.bg).toBe("#1d2439");
    expect(colors.text).toBe("#00ff00");
    expect(colors.accent).toBe("#ffcc00");
  });

  it("returns default colors when store is unavailable", () => {
    const fakeWebamp = {} as any;
    const colors = getSkinColors(fakeWebamp);
    expect(colors.bg).toBe("#1d2439");
  });

  it("returns default colors when skinColors is empty", () => {
    const fakeWebamp = {
      store: {
        getState: () => ({ display: { skinColors: [] } }),
      },
    } as any;
    const colors = getSkinColors(fakeWebamp);
    expect(colors.bg).toBe("#1d2439");
  });

  it("extracts colors from Webamp store when available", () => {
    const skinColors = [
      "#00ff00", // 0 - text
      "#0a0e1a", // 1 - textBg
      "#ffcc00", // 2 - accent fallback
      "#1d2439", // 3 - bg
      "#2a3555", // 4 - fg
      "#000000", "#000000", "#000000", "#000000", "#000000",
      "#000000", "#000000", "#000000", "#000000", "#000000",
      "#000000", "#000000", "#000000",
      "#ff6600", // 18 - accent primary
    ];
    const fakeWebamp = {
      store: {
        getState: () => ({ display: { skinColors } }),
      },
    } as any;
    const colors = getSkinColors(fakeWebamp);
    expect(colors.bg).toBe("#1d2439");
    expect(colors.fg).toBe("#2a3555");
    expect(colors.textBg).toBe("#0a0e1a");
  });
});
