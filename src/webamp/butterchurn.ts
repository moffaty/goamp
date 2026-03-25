export function getButterchurnOptions() {
  return {
    importButterchurn: async () => {
      const mod = await import("butterchurn");
      return mod.default || mod;
    },
    getPresets: async () => {
      const mod = await import("butterchurn-presets");
      const presetMap = mod.default || mod;
      return Object.entries(presetMap).map(([name, preset]) => ({
        name,
        butterchurnPresetObject: preset,
      }));
    },
    butterchurnOpen: false,
  };
}
