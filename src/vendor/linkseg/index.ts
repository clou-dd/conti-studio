// linkseg-web — in-browser LinkSeg music-structure analysis (onnxruntime-web, WebGPU/WASM).
//
// The LinkSeg MODEL/weights are the work of M. Buisson, B. McFee, S. Essid (ISMIR 2024) and are
// licensed CC-BY 4.0 — see LINKSEG_ATTRIBUTION and the README. This port code is MIT.

export {
  LinkSeg,
  computeMelWindows,
  decode,
  mapLabels,
  mergeRepeatedSections,
  mapAndMerge,
  DEFAULT_TAU,
  DEFAULT_PEAK_WINDOW_SECONDS,
  type LoadOptions,
  type AnalyzeOptions,
  type MelWindows,
  type Activations,
} from './linkseg';

// Composable low-level pieces (for callers that already did part of the work).
export {buildLinkSegWindows, type LinkSegWindows} from './windows';
export {
  melForWindows,
  melWindowInto,
  LINKSEG_SR,
  LINKSEG_N_FFT,
  LINKSEG_HOP,
  LINKSEG_N_MELS,
  LINKSEG_WIN_SAMPLES,
  LINKSEG_MEL_FRAMES,
} from './mel';
export {linksegDecode, LINKSEG_LABELS, type LinkSegDecode} from './decode';
export {resampleTo22050} from './resample';
export {getModelBytes, type ProgressEvent} from './model-cache';
export {LINKSEG_ATTRIBUTION} from './attribution';
export {
  LABEL_NAMES,
  toSections,
  type Backend,
  type Section,
  type LinkSegSections,
} from './types';

