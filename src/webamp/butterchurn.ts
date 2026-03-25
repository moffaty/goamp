export function getButterchurnOptions() {
  return {
    importButterchurn: () => import("butterchurn"),
    getPresets: async () => {
      const presets = await import("butterchurn-presets");
      const presetMap = presets.default || presets;
      return Object.entries(presetMap).map(([name, preset]) => ({
        name,
        butterchurnPresetObject: preset,
      }));
    },
    butterchurnOpen: false,
  };
}
