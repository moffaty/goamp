// Type for a butterchurn preset JSON object
export interface butterchurnPreset {
  baseVals: Record<string, number>;
  shapes?: unknown[];
  waves?: unknown[];
  init_eqs_str?: string;
  frame_eqs_str?: string;
  pixel_eqs_str?: string;
  warp?: string;
  comp?: string;
}
