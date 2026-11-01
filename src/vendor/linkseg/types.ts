// Public types for linkseg-web.

/** Execution provider preference for onnxruntime-web. `auto` = try WebGPU, fall back to WASM. */
export type Backend = 'webgpu' | 'wasm' | 'auto';

/**
 * A functional section of the song. `start`/`end` in seconds; `label` is one of the 7 LinkSeg
 * functional classes mapped to a product-facing name (see {@link LABEL_NAMES}).
 */
export interface Section {
  start: number;
  end: number;
  label: string;
}

/**
 * Segment-edge representation used internally by the decoder.
 * `times` has length S+1 (edges in seconds, including 0 and duration);
 * `labels` has length S (one label per segment).
 */
export interface LinkSegSections {
  times: number[];
  labels: string[];
}

/** Raw 7-class functional labels -> product-facing display names. */
export const LABEL_NAMES: Record<string, string> = {
  silence: 'Silence',
  verse: 'Verse',
  chorus: 'Chorus',
  intro: 'Intro',
  outro: 'Outro',
  inst: 'Instrumental',
  bridge: 'Bridge',
};

/** Convert the internal edge representation to an array of {start, end, label} sections. */
export function toSections(s: LinkSegSections): Section[] {
  const out: Section[] = [];
  for (let i = 0; i < s.labels.length; i++) {
    out.push({start: s.times[i], end: s.times[i + 1], label: s.labels[i]});
  }
  return out;
}

