import type { butterchurnPreset } from "./custom-presets";

export function getButterchurnOptions() {
  return {
    importButterchurn: async () => {
      const mod = await import("butterchurn");
      return mod;
    },
    getPresets: async () => {
      // butterchurn-presets exports packs as classes with static .getPresets()
      const [pack1, pack2, pack3, pack4, pack5] = await Promise.all([
        import("butterchurn-presets/lib/butterchurnPresets.min.js"),
        import("butterchurn-presets/lib/butterchurnPresetsExtra.min.js"),
        import("butterchurn-presets/lib/butterchurnPresetsExtra2.min.js"),
        import("butterchurn-presets/lib/butterchurnPresetsNonMinimal.min.js"),
        import("butterchurn-presets/lib/butterchurnPresetsMinimal.min.js"),
      ]);

      const allPresets: Record<string, unknown> = {};

      for (const mod of [pack1, pack2, pack3, pack4, pack5]) {
        const Pack = (mod as any).default || mod;
        if (typeof Pack?.getPresets === "function") {
          Object.assign(allPresets, Pack.getPresets());
        }
      }

      // Load user custom presets
      const customPresets = await loadCustomPresets();
      Object.assign(allPresets, customPresets);

      const entries = Object.entries(allPresets);
      console.log(`[GOAMP] Butterchurn presets loaded: ${entries.length} (${Object.keys(customPresets).length} custom)`);

      return entries.map(([name, preset]) => ({
        name,
        butterchurnPresetObject: preset,
      }));
    },
    butterchurnOpen: true,
  };
}

// ─── Custom preset storage ───

const CUSTOM_PRESETS_KEY = "goamp_custom_presets";

export type CustomPresetMap = Record<string, unknown>;

function loadCustomPresets(): CustomPresetMap {
  try {
    const raw = localStorage.getItem(CUSTOM_PRESETS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as CustomPresetMap;
  } catch {
    return {};
  }
}

function saveCustomPresets(presets: CustomPresetMap): void {
  localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(presets));
}

/** Add a preset from a JSON file. Returns preset name on success. */
export async function addCustomPresetFromFile(file: File): Promise<string> {
  const text = await file.text();
  let preset: unknown;
  try {
    preset = JSON.parse(text);
  } catch {
    throw new Error("Invalid JSON file");
  }

  if (!isValidPreset(preset)) {
    throw new Error("Not a valid Butterchurn preset JSON (missing baseVals)");
  }

  const name = file.name.replace(/\.json$/i, "");
  const existing = loadCustomPresets();
  existing[name] = preset;
  saveCustomPresets(existing);
  return name;
}

/** Remove a custom preset by name */
export function removeCustomPreset(name: string): void {
  const existing = loadCustomPresets();
  delete existing[name];
  saveCustomPresets(existing);
}

/** List all custom preset names */
export function listCustomPresets(): string[] {
  return Object.keys(loadCustomPresets());
}

function isValidPreset(obj: unknown): obj is butterchurnPreset {
  return typeof obj === "object" && obj !== null && "baseVals" in obj;
}

/** Apply a preset by name to the running visualizer */
export function applyPreset(webamp: any, name: string): void {
  const store = webamp?.store;
  if (!store) return;
  store.dispatch({ type: "SET_MILKDROP_PRESET", presetName: name });
}
