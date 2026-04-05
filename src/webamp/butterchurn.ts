import type { butterchurnPreset } from "./custom-presets";

export function getButterchurnOptions() {
  return {
    importButterchurn: async () => {
      const mod = await import("butterchurn");
      return mod;
    },
    getPresets: async () => {
      const packPaths = [
        "butterchurn-presets/lib/butterchurnPresets.min.js",
        "butterchurn-presets/lib/butterchurnPresetsExtra.min.js",
        "butterchurn-presets/lib/butterchurnPresetsExtra2.min.js",
        "butterchurn-presets/lib/butterchurnPresetsNonMinimal.min.js",
        "butterchurn-presets/lib/butterchurnPresetsMinimal.min.js",
      ];

      const allPresets: Record<string, unknown> = {};

      // Load each pack individually to survive partial failures
      // Static import strings required for Vite to bundle them
      const packs = await Promise.allSettled([
        import("butterchurn-presets/lib/butterchurnPresets.min.js"),
        import("butterchurn-presets/lib/butterchurnPresetsExtra.min.js"),
        import("butterchurn-presets/lib/butterchurnPresetsExtra2.min.js"),
        import("butterchurn-presets/lib/butterchurnPresetsNonMinimal.min.js"),
        import("butterchurn-presets/lib/butterchurnPresetsMinimal.min.js"),
      ]);

      for (let i = 0; i < packs.length; i++) {
        const result = packs[i];
        if (result.status === "rejected") {
          console.warn(`[GOAMP] Failed to load preset pack ${packPaths[i]}:`, result.reason);
          continue;
        }
        const mod = result.value;
        // UMD modules: Vite wraps CJS as { default: <export> }
        // Try multiple access patterns for robustness
        const Pack = (mod as any).default || mod;
        const getPresets =
          typeof Pack?.getPresets === "function"
            ? Pack.getPresets
            : typeof Pack === "function" && typeof (Pack as any).prototype?.getPresets === "function"
              ? () => new (Pack as any)().getPresets()
              : null;

        if (getPresets) {
          const presets = getPresets();
          const count = Object.keys(presets).length;
          console.log(`[GOAMP] Pack ${i}: ${count} presets from ${packPaths[i]}`);
          Object.assign(allPresets, presets);
        } else {
          console.warn(`[GOAMP] Pack ${i}: no getPresets() found`, {
            type: typeof Pack,
            keys: Pack ? Object.keys(Pack).slice(0, 10) : [],
            hasDefault: "default" in mod,
          });
        }
      }

      // Load user custom presets
      const customPresets = loadCustomPresets();
      Object.assign(allPresets, customPresets);

      const entries = Object.entries(allPresets);
      console.log(`[GOAMP] Butterchurn presets total: ${entries.length} (${Object.keys(customPresets).length} custom)`);

      return entries.map(([name, preset]) => ({
        name,
        butterchurnPresetObject: preset,
      }));
    },
    butterchurnOpen: false,
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
