import type Webamp from "webamp";

/** Relative luminance (WCAG 2.1) */
export function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const rgb = [
    parseInt(h.slice(0, 2), 16) || 0,
    parseInt(h.slice(2, 4), 16) || 0,
    parseInt(h.slice(4, 6), 16) || 0,
  ].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

/** Ensure text is readable on background — flip to white/black if contrast < 4.5:1 */
export function ensureContrast(textColor: string, bgColor: string): string {
  const lText = luminance(textColor);
  const lBg = luminance(bgColor);
  const ratio = (Math.max(lText, lBg) + 0.05) / (Math.min(lText, lBg) + 0.05);
  if (ratio >= 4.5) return textColor;
  return lBg > 0.4 ? "#000000" : "#ffffff";
}

export interface SkinColors {
  bg: string;
  fg: string;
  text: string;
  accent: string;
  textBg: string;
}

const DEFAULT_COLORS: SkinColors = {
  bg: "#1d2439",
  fg: "#2a3555",
  text: "#00ff00",
  accent: "#ffcc00",
  textBg: "#0a0e1a",
};

/** Read skin colors from Webamp Redux store */
export function getSkinColors(webamp: Webamp | null): SkinColors {
  if (!webamp) return DEFAULT_COLORS;
  try {
    const state = (webamp as any).store?.getState();
    const colors: string[] = state?.display?.skinColors || [];
    if (colors.length >= 5) {
      const bg = colors[3] || DEFAULT_COLORS.bg;
      const rawText = colors[0] || DEFAULT_COLORS.text;
      const rawAccent = colors[18] || colors[2] || DEFAULT_COLORS.accent;
      return {
        bg,
        fg: colors[4] || DEFAULT_COLORS.fg,
        text: ensureContrast(rawText, bg),
        accent: ensureContrast(rawAccent, bg),
        textBg: colors[1] || DEFAULT_COLORS.textBg,
      };
    }
  } catch {}
  return DEFAULT_COLORS;
}

/** HTML-escape a string */
export function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

/** Format seconds as m:ss */
export function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
