export function getButterchurnOptions() {
  return {
    importButterchurn: async () => {
      const mod = await import("butterchurn");
      console.log("[GOAMP] butterchurn loaded:", Object.keys(mod));
      return mod;
    },
    getPresets: async () => {
      const mod = await import("butterchurn-presets");
      const presetMap = mod.default || mod;
      const entries = Object.entries(presetMap);
      console.log("[GOAMP] butterchurn presets loaded:", entries.length);
      return entries.map(([name, preset]) => ({
        name,
        butterchurnPresetObject: preset,
      }));
    },
    butterchurnOpen: false,
  };
}
